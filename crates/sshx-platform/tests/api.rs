//! End-to-end test of the HTTP APIs: dev login, vault, machine token, agent
//! registration and reports, workspace, preferences, sharing, CSRF.

use std::sync::Arc;

use reqwest::header::{AUTHORIZATION, COOKIE, SET_COOKIE};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use sshx_platform::config::{AuthMode, Config};

struct Harness {
    base: String,
    http: Client,
    _dir: tempfile::TempDir,
}

async fn start() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        database: format!("sqlite://{}", dir.path().join("t.db").display()),
        public_url: None,
        sshx_server: "http://127.0.0.1:9".into(),
        sshx_public_url: Some("https://sshx.example/".into()),
        static_dir: dir.path().into(),
        auth: AuthMode::Dev,
        oidc_issuer: None,
        oidc_client_id: None,
        oidc_client_secret: None,
        admins: vec![],
    };
    let state: Arc<_> = sshx_platform::build_state(config).await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, sshx_platform::app(state)).await.unwrap() });
    Harness { base, http: Client::new(), _dir: dir }
}

impl Harness {
    async fn login(&self, username: &str) -> String {
        let resp = self
            .http
            .post(format!("{}/api/auth/dev/login", self.base))
            .header("x-sshx-platform", "1")
            .json(&json!({ "username": username }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let cookie = resp.headers()[SET_COOKIE].to_str().unwrap();
        cookie.split(';').next().unwrap().to_string()
    }

    async fn req(&self, method: &str, path: &str, cookie: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut rb = self
            .http
            .request(method.parse().unwrap(), format!("{}{path}", self.base))
            .header(COOKIE, cookie)
            .header("x-sshx-platform", "1");
        if let Some(body) = body {
            rb = rb.json(&body);
        }
        let resp = rb.send().await.unwrap();
        let status = resp.status();
        (status, resp.json().await.unwrap_or(Value::Null))
    }

    async fn agent(&self, method: &str, path: &str, token: &str, body: Option<Value>) -> StatusCode {
        let mut rb = self
            .http
            .request(method.parse().unwrap(), format!("{}/api/agent/v1{path}", self.base))
            .header(AUTHORIZATION, format!("Bearer {token}"));
        if let Some(body) = body {
            rb = rb.json(&body);
        }
        rb.send().await.unwrap().status()
    }

    async fn agent_json(&self, path: &str, token: &str) -> Value {
        self.http
            .get(format!("{}/api/agent/v1{path}", self.base))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }
}

fn vault() -> Value {
    json!({
        "salt": "c2FsdA",
        "kdf": { "alg": "argon2id", "m": 65536, "t": 3, "p": 1 },
        "verifier": "v1.dmVyaWZpZXI",
        "publicKey": { "kty": "EC", "crv": "P-256", "x": "x", "y": "y" },
        "privateKeyEnc": "v1.cHJpdmF0ZQ",
    })
}

#[tokio::test]
async fn full_flow() {
    let h = start().await;
    let alice = h.login("alice").await;
    let bob = h.login("Bob").await;

    // Unauthenticated and CSRF-less requests are rejected.
    let resp = h.http.get(format!("{}/api/me", h.base)).send().await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let resp = h
        .http
        .post(format!("{}/api/machines", h.base))
        .header(COOKIE, &alice)
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // A vault is required before creating machines.
    let machine = json!({ "id": "m1", "name": "gpu-1", "kind": "project", "project": "traduction", "keyEnc": "v1.a2V5" });
    let (status, _) = h.req("POST", "/api/machines", &alice, Some(machine.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(h.req("PUT", "/api/me/vault", &alice, Some(vault())).await.0, StatusCode::OK);
    assert_eq!(h.req("PUT", "/api/me/vault", &alice, Some(vault())).await.0, StatusCode::CONFLICT);

    let (status, created) = h.req("POST", "/api/machines", &alice, Some(machine)).await;
    assert_eq!(status, StatusCode::OK);
    let token = created["token"].as_str().unwrap().to_string();
    assert!(token.starts_with("smt_"));

    // The machine identifies itself and registers a session.
    assert_eq!(h.agent("GET", "/whoami", "smt_wrong", None).await, StatusCode::UNAUTHORIZED);
    assert_eq!(h.agent("GET", "/whoami", &token, None).await, StatusCode::OK);
    let reg = json!({
        "name": "abc123", "url": "https://sshx.example/s/abc123", "sshxServer": "https://sshx.example",
        "displayName": "alice@gpu-1", "keyEnc": "v1.c2Vzc2lvbg", "hostname": "gpu-1", "os": "linux",
    });
    let who = h.agent_json("/whoami", &token).await;
    assert_eq!(who["sessionsOnline"], 0);
    assert_eq!(who["sshxServer"], "https://sshx.example", "public sshx URL announced to machines");
    assert_eq!(h.agent("POST", "/sessions", &token, Some(reg)).await, StatusCode::OK);
    assert_eq!(h.agent_json("/whoami", &token).await["sessionsOnline"], 1);
    let report = json!({ "terminals": [
        { "sid": 1, "state": "working", "since": 5, "agent": "claude", "metaEnc": "v1.bWV0YQ" },
        { "sid": 2, "state": "none", "metaEnc": "v1.bWV0YTI" },
    ]});
    assert_eq!(h.agent("PUT", "/sessions/abc123/state", &token, Some(report)).await, StatusCode::OK);
    let bad = json!({ "terminals": [{ "sid": 1, "state": "dancing" }] });
    assert_eq!(h.agent("PUT", "/sessions/abc123/state", &token, Some(bad)).await, StatusCode::BAD_REQUEST);
    assert_eq!(h.agent("PUT", "/sessions/nope/state", &token, Some(json!({"terminals": []}))).await, StatusCode::NOT_FOUND);

    // Alice sees her machine, session and terminals; Bob sees nothing.
    let (_, ws) = h.req("GET", "/api/workspace", &alice, None).await;
    assert_eq!(ws["machines"].as_array().unwrap().len(), 1);
    assert_eq!(ws["sessions"][0]["online"], true);
    assert_eq!(ws["terminals"].as_array().unwrap().len(), 2);
    assert_eq!(ws["terminals"][0]["state"], "working");
    let (_, ws_bob) = h.req("GET", "/api/workspace", &bob, None).await;
    assert!(ws_bob["sessions"].as_array().unwrap().is_empty());
    let (status, _) = h.req("PUT", "/api/prefs/abc123/1", &bob, Some(json!({ "bell": true }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Closing a terminal removes it.
    let report = json!({ "terminals": [{ "sid": 1, "state": "done", "since": 9, "agent": "claude", "metaEnc": "v1.bWV0YQ" }] });
    assert_eq!(h.agent("PUT", "/sessions/abc123/state", &token, Some(report)).await, StatusCode::OK);
    let (_, ws) = h.req("GET", "/api/workspace", &alice, None).await;
    assert_eq!(ws["terminals"].as_array().unwrap().len(), 1);
    assert_eq!(ws["terminals"][0]["state"], "done");

    // Preferences: partial updates.
    let (status, pref) = h
        .req("PUT", "/api/prefs/abc123/1", &alice, Some(json!({ "nameEnc": "v1.bmFtZQ", "bell": true })))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pref["bell"], true);
    let (_, pref) = h.req("PUT", "/api/prefs/abc123/1", &alice, Some(json!({ "pinned": true, "sortKey": 2.5 }))).await;
    assert_eq!(pref["nameEnc"], "v1.bmFtZQ");
    assert_eq!(pref["pinned"], true);
    assert_eq!(pref["sortKey"], 2.5);
    let (_, pref) = h.req("PUT", "/api/prefs/abc123/1", &alice, Some(json!({ "nameEnc": null }))).await;
    assert_eq!(pref["nameEnc"], Value::Null);

    // Online sessions cannot be forgotten.
    assert_eq!(h.req("DELETE", "/api/sessions/abc123", &alice, None).await.0, StatusCode::CONFLICT);

    // Sharing with Bob requires his vault, then grants access.
    let (_, users) = h.req("GET", "/api/users", &alice, None).await;
    let bob_id = users.as_array().unwrap().iter().find(|u| u["username"] == "bob").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let share = json!({ "keyEnc": { "epk": { "kty": "EC" }, "ct": "v1.c2hhcmU" } });
    let path = format!("/api/machines/m1/members/{bob_id}");
    assert_eq!(h.req("PUT", &path, &alice, Some(share.clone())).await.0, StatusCode::CONFLICT);
    assert_eq!(h.req("PUT", "/api/me/vault", &bob, Some(vault())).await.0, StatusCode::OK);
    assert_eq!(h.req("PUT", &path, &bob, Some(share.clone())).await.0, StatusCode::FORBIDDEN);
    assert_eq!(h.req("PUT", &path, &alice, Some(share)).await.0, StatusCode::OK);
    let (_, ws_bob) = h.req("GET", "/api/workspace", &bob, None).await;
    assert_eq!(ws_bob["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(ws_bob["machines"][0]["scheme"], "ecdh");
    assert!(ws_bob["machines"][0]["members"].as_array().unwrap().is_empty());

    // Closing the session keeps it listed as offline; then it can be forgotten.
    assert_eq!(h.agent("POST", "/sessions/abc123/close", &token, None).await, StatusCode::OK);
    let (_, ws) = h.req("GET", "/api/workspace", &alice, None).await;
    assert_eq!(ws["sessions"][0]["online"], false);
    assert_eq!(ws["terminals"].as_array().unwrap().len(), 1);
    assert_eq!(h.agent("PUT", "/sessions/abc123/state", &token, Some(json!({"terminals": []}))).await, StatusCode::NOT_FOUND);
    assert_eq!(h.req("DELETE", "/api/sessions/abc123", &alice, None).await.0, StatusCode::OK);

    // Rotating the token revokes the old one.
    let (_, rotated) = h.req("POST", "/api/machines/m1/token", &alice, None).await;
    assert_eq!(h.agent("GET", "/whoami", &token, None).await, StatusCode::UNAUTHORIZED);
    assert_eq!(h.agent("GET", "/whoami", rotated["token"].as_str().unwrap(), None).await, StatusCode::OK);

    // Admin overview (dev mode: everyone is admin) shows metadata.
    let (status, overview) = h.req("GET", "/api/admin/overview", &bob, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(overview["users"].as_array().unwrap().len(), 2);

    // Logout invalidates the cookie.
    assert_eq!(h.req("POST", "/api/auth/logout", &alice, None).await.0, StatusCode::OK);
    assert_eq!(h.req("GET", "/api/me", &alice, None).await.0, StatusCode::UNAUTHORIZED);
}
