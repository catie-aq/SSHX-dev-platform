//! API used by the web app, authenticated by the session cookie.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{self, CurrentUser};
use crate::config::AuthMode;
use crate::error::{ApiError, ApiResult};
use crate::events::{self, Event};
use crate::models::{MachineView, PrefView, SessionView, TerminalView, UserView, SESSION_COLUMNS};
use crate::state::AppState;
use crate::util::{clean_label, is_safe_id, is_sealed, now_ms, random_secret, sha256_hex};
use crate::{agent_api, oidc, proxy};

/// Routes under `/api`.
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .nest("/agent/v1", agent_api::routes())
        .route("/config", get(config))
        .route("/auth/dev/login", post(auth::dev_login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/oidc/login", get(oidc::login))
        .route("/auth/oidc/callback", get(oidc::callback))
        .route("/me", get(me))
        .route("/me/vault", put(create_vault).delete(reset_vault))
        .route("/workspace", get(workspace))
        .route("/events", get(events::stream))
        .route("/users", get(users))
        .route("/machines", post(create_machine))
        .route("/machines/{id}", put(update_machine).delete(delete_machine))
        .route("/machines/{id}/token", post(rotate_token))
        .route("/machines/{id}/members/{user_id}", put(add_member).delete(remove_member))
        .route("/prefs/{session}/{sid}", put(update_prefs))
        .route("/sessions/{name}", delete(forget_session))
        .route("/admin/overview", get(admin_overview))
        // Same path as sshx, so sshx's frontend libraries work unchanged.
        .route("/s/{name}", get(proxy::session_ws))
}

async fn config(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "authMode": match state.config.auth { AuthMode::Dev => "dev", AuthMode::Oidc => "oidc" },
        "version": env!("CARGO_PKG_VERSION"),
        "publicUrl": state.config.public_url.as_deref().map(|u| u.trim_end_matches('/')),
        "sshxServer": state.config.machine_sshx_server(),
    }))
}

// ---------------------------------------------------------------------------
// Current user and vault
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultView {
    salt: String,
    kdf: String,
    verifier: String,
    public_key: String,
    private_key_enc: String,
}

async fn me(State(state): State<Arc<AppState>>, user: CurrentUser) -> ApiResult<Json<Value>> {
    let vault: Option<VaultView> =
        sqlx::query_as("SELECT salt, kdf, verifier, public_key, private_key_enc FROM vaults WHERE user_id = ?")
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await?;
    Ok(Json(json!({
        "user": {
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
            "isAdmin": user.is_admin,
        },
        "vault": vault,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultBody {
    salt: String,
    kdf: Value,
    verifier: String,
    public_key: Value,
    private_key_enc: String,
}

async fn create_vault(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Json(body): Json<VaultBody>,
) -> ApiResult<Json<Value>> {
    let kdf = body.kdf.to_string();
    let public_key = body.public_key.to_string();
    if body.salt.len() > 64 || kdf.len() > 512 || public_key.len() > 1024 {
        return Err(ApiError::bad_request("vault fields too large"));
    }
    if !is_sealed(&body.verifier, 512) || !is_sealed(&body.private_key_enc, 4096) {
        return Err(ApiError::bad_request("invalid sealed values"));
    }
    let res = sqlx::query(
        "INSERT INTO vaults (user_id, salt, kdf, verifier, public_key, private_key_enc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&user.id)
    .bind(&body.salt)
    .bind(&kdf)
    .bind(&body.verifier)
    .bind(&public_key)
    .bind(&body.private_key_enc)
    .bind(now_ms())
    .execute(&state.db)
    .await;
    match res {
        Ok(_) => Ok(Json(json!({ "ok": true }))),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() || e.is_foreign_key_violation() => {
            Err(ApiError::conflict("the vault already exists"))
        }
        Err(e) => Err(e.into()),
    }
}

/// Forgotten passphrase: drop the vault, every key wrapped for this user and
/// the machines they own (which must be enrolled again).
async fn reset_vault(State(state): State<Arc<AppState>>, user: CurrentUser) -> ApiResult<Json<Value>> {
    let affected: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT k.user_id FROM machine_keys k JOIN machines m ON m.id = k.machine_id WHERE m.owner_id = ?",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM machines WHERE owner_id = ?").bind(&user.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM machine_keys WHERE user_id = ?").bind(&user.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM terminal_prefs WHERE user_id = ?").bind(&user.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM vaults WHERE user_id = ?").bind(&user.id).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut users: Vec<String> = affected.into_iter().map(|(u,)| u).collect();
    users.push(user.id);
    state.emit(Event::Resync { users });
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

async fn load_machines(state: &AppState, user_id: &str) -> ApiResult<Vec<MachineView>> {
    let mut machines: Vec<MachineView> = sqlx::query_as(
        "SELECT m.id, m.name, m.kind, m.project, m.owner_id, u.username AS owner_name, m.token_hint,
                m.created_at, m.last_seen_at, k.key_enc, k.scheme
         FROM machine_keys k
         JOIN machines m ON m.id = k.machine_id
         JOIN users u ON u.id = m.owner_id
         WHERE k.user_id = ?
         ORDER BY m.name",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    for m in machines.iter_mut().filter(|m| m.owner_id == user_id) {
        m.members = sqlx::query_as(
            "SELECT k.user_id, u.username, u.display_name, k.scheme
             FROM machine_keys k JOIN users u ON u.id = k.user_id
             WHERE k.machine_id = ? ORDER BY u.username",
        )
        .bind(&m.id)
        .fetch_all(&state.db)
        .await?;
    }
    Ok(machines)
}

async fn workspace(State(state): State<Arc<AppState>>, user: CurrentUser) -> ApiResult<Json<Value>> {
    let now = now_ms();
    let machines = load_machines(&state, &user.id).await?;
    let sessions: Vec<SessionView> = sqlx::query_as(&format!(
        "SELECT {SESSION_COLUMNS} FROM sessions
         WHERE machine_id IN (SELECT machine_id FROM machine_keys WHERE user_id = ?)
         ORDER BY started_at"
    ))
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    let sessions: Vec<SessionView> = sessions.into_iter().map(|s| s.with_online(now)).collect();
    let terminals: Vec<TerminalView> = sqlx::query_as(
        "SELECT t.session_name, t.sid, t.state, t.agent, t.state_since, t.meta_enc, t.created_at, t.updated_at
         FROM terminals t JOIN sessions s ON s.name = t.session_name
         WHERE s.machine_id IN (SELECT machine_id FROM machine_keys WHERE user_id = ?)
         ORDER BY t.created_at",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    let prefs: Vec<PrefView> = sqlx::query_as(
        "SELECT session_name, sid, name_enc, sort_key, pinned, bell FROM terminal_prefs WHERE user_id = ?",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "machines": machines,
        "sessions": sessions,
        "terminals": terminals,
        "prefs": prefs,
        "now": now,
    })))
}

/// Return the machine ID of a session if the user can access it.
pub async fn session_machine_for_user(state: &AppState, user_id: &str, session: &str) -> ApiResult<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT s.machine_id FROM sessions s
         JOIN machine_keys k ON k.machine_id = s.machine_id AND k.user_id = ?
         WHERE s.name = ?",
    )
    .bind(user_id)
    .bind(session)
    .fetch_optional(&state.db)
    .await?;
    row.map(|(m,)| m).ok_or_else(|| ApiError::not_found("unknown session"))
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

fn new_machine_token() -> (String, String, String) {
    let token = format!("smt_{}", random_secret(32));
    let hint = token.chars().take(10).collect();
    let hash = sha256_hex(&token);
    (token, hash, hint)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachineBody {
    id: String,
    name: String,
    kind: String,
    #[serde(default)]
    project: Option<String>,
    key_enc: String,
}

fn validate_kind(kind: &str) -> ApiResult<()> {
    if kind == "personal" || kind == "project" {
        Ok(())
    } else {
        Err(ApiError::bad_request("kind must be personal or project"))
    }
}

fn clean_project(project: Option<String>) -> Option<String> {
    project.map(|p| clean_label(&p, 64)).filter(|p| !p.is_empty())
}

async fn create_machine(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Json(body): Json<MachineBody>,
) -> ApiResult<Json<Value>> {
    if !is_safe_id(&body.id) {
        return Err(ApiError::bad_request("invalid machine id"));
    }
    validate_kind(&body.kind)?;
    if !is_sealed(&body.key_enc, 1024) {
        return Err(ApiError::bad_request("invalid keyEnc"));
    }
    let name = clean_label(&body.name, 64);
    if name.is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let has_vault: Option<(String,)> = sqlx::query_as("SELECT user_id FROM vaults WHERE user_id = ?")
        .bind(&user.id)
        .fetch_optional(&state.db)
        .await?;
    if has_vault.is_none() {
        return Err(ApiError::conflict("set up the encryption passphrase first"));
    }
    let (token, hash, hint) = new_machine_token();
    let now = now_ms();
    let mut tx = state.db.begin().await?;
    let res = sqlx::query(
        "INSERT INTO machines (id, owner_id, name, kind, project, token_hash, token_hint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&body.id)
    .bind(&user.id)
    .bind(&name)
    .bind(&body.kind)
    .bind(clean_project(body.project))
    .bind(&hash)
    .bind(&hint)
    .bind(now)
    .execute(&mut *tx)
    .await;
    if let Err(sqlx::Error::Database(e)) = &res {
        if e.is_unique_violation() {
            return Err(ApiError::conflict("machine id already exists"));
        }
    }
    res?;
    sqlx::query(
        "INSERT INTO machine_keys (machine_id, user_id, scheme, key_enc, granted_by, created_at)
         VALUES (?, ?, 'vault', ?, ?, ?)",
    )
    .bind(&body.id)
    .bind(&user.id)
    .bind(&body.key_enc)
    .bind(&user.id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    state.emit(Event::Resync { users: vec![user.id] });
    Ok(Json(json!({ "id": body.id, "token": token })))
}

async fn owned_machine_members(state: &AppState, user: &CurrentUser, id: &str) -> ApiResult<Vec<String>> {
    let owner: Option<(String,)> = sqlx::query_as("SELECT owner_id FROM machines WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    match owner {
        Some((owner,)) if owner == user.id => {}
        Some(_) => return Err(ApiError::forbidden("only the owner can change this machine")),
        None => return Err(ApiError::not_found("unknown machine")),
    }
    let members: Vec<(String,)> = sqlx::query_as("SELECT user_id FROM machine_keys WHERE machine_id = ?")
        .bind(id)
        .fetch_all(&state.db)
        .await?;
    Ok(members.into_iter().map(|(u,)| u).collect())
}

#[derive(Deserialize)]
struct MachineUpdate {
    name: String,
    kind: String,
    #[serde(default)]
    project: Option<String>,
}

async fn update_machine(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(body): Json<MachineUpdate>,
) -> ApiResult<Json<Value>> {
    let members = owned_machine_members(&state, &user, &id).await?;
    validate_kind(&body.kind)?;
    let name = clean_label(&body.name, 64);
    if name.is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    sqlx::query("UPDATE machines SET name = ?, kind = ?, project = ? WHERE id = ?")
        .bind(&name)
        .bind(&body.kind)
        .bind(clean_project(body.project))
        .bind(&id)
        .execute(&state.db)
        .await?;
    state.emit(Event::Resync { users: members });
    Ok(Json(json!({ "ok": true })))
}

async fn delete_machine(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let members = owned_machine_members(&state, &user, &id).await?;
    sqlx::query("DELETE FROM machines WHERE id = ?").bind(&id).execute(&state.db).await?;
    state.emit(Event::Resync { users: members });
    Ok(Json(json!({ "ok": true })))
}

async fn rotate_token(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let members = owned_machine_members(&state, &user, &id).await?;
    let (token, hash, hint) = new_machine_token();
    sqlx::query("UPDATE machines SET token_hash = ?, token_hint = ? WHERE id = ?")
        .bind(&hash)
        .bind(&hint)
        .bind(&id)
        .execute(&state.db)
        .await?;
    state.emit(Event::Resync { users: members });
    Ok(Json(json!({ "token": token })))
}

async fn users(State(state): State<Arc<AppState>>, _user: CurrentUser) -> ApiResult<Json<Vec<UserView>>> {
    let users: Vec<UserView> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, v.public_key
         FROM users u LEFT JOIN vaults v ON v.user_id = u.id ORDER BY u.username",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(users))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemberBody {
    /// `{"epk": <JWK>, "ct": "v1.…"}`: machine key sealed for the member.
    key_enc: Value,
}

async fn add_member(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path((id, member)): Path<(String, String)>,
    Json(body): Json<MemberBody>,
) -> ApiResult<Json<Value>> {
    let mut members = owned_machine_members(&state, &user, &id).await?;
    if member == user.id {
        return Err(ApiError::bad_request("the owner already has access"));
    }
    let ct_ok = body.key_enc.get("ct").and_then(|c| c.as_str()).is_some_and(|c| is_sealed(c, 1024));
    let key_enc = body.key_enc.to_string();
    if !ct_ok || body.key_enc.get("epk").is_none() || key_enc.len() > 2048 {
        return Err(ApiError::bad_request("invalid keyEnc"));
    }
    let has_vault: Option<(String,)> = sqlx::query_as("SELECT user_id FROM vaults WHERE user_id = ?")
        .bind(&member)
        .fetch_optional(&state.db)
        .await?;
    if has_vault.is_none() {
        return Err(ApiError::conflict("this user has not set up encryption yet"));
    }
    sqlx::query(
        "INSERT INTO machine_keys (machine_id, user_id, scheme, key_enc, granted_by, created_at)
         VALUES (?, ?, 'ecdh', ?, ?, ?)
         ON CONFLICT(machine_id, user_id) DO UPDATE SET key_enc = excluded.key_enc, scheme = 'ecdh'",
    )
    .bind(&id)
    .bind(&member)
    .bind(&key_enc)
    .bind(&user.id)
    .bind(now_ms())
    .execute(&state.db)
    .await?;
    members.push(member);
    state.emit(Event::Resync { users: members });
    Ok(Json(json!({ "ok": true })))
}

async fn remove_member(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path((id, member)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let members = owned_machine_members(&state, &user, &id).await?;
    if member == user.id {
        return Err(ApiError::bad_request("the owner cannot be removed"));
    }
    sqlx::query("DELETE FROM machine_keys WHERE machine_id = ? AND user_id = ?")
        .bind(&id)
        .bind(&member)
        .execute(&state.db)
        .await?;
    state.emit(Event::Resync { users: members });
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Terminal preferences and sessions
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrefsBody {
    /// Absent: unchanged. `null`: cleared. String: sealed name.
    #[serde(default, deserialize_with = "present")]
    name_enc: Option<Value>,
    /// Absent: unchanged. `null`: cleared. Number: sort key.
    #[serde(default, deserialize_with = "present")]
    sort_key: Option<Value>,
    #[serde(default)]
    pinned: Option<bool>,
    #[serde(default)]
    bell: Option<bool>,
}

/// Deserialize a present field, `null` included, as `Some`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

async fn update_prefs(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path((session, sid)): Path<(String, u32)>,
    Json(body): Json<PrefsBody>,
) -> ApiResult<Json<PrefView>> {
    session_machine_for_user(&state, &user.id, &session).await?;
    let now = now_ms();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO terminal_prefs (user_id, session_name, sid, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, session_name, sid) DO UPDATE SET updated_at = excluded.updated_at",
    )
    .bind(&user.id)
    .bind(&session)
    .bind(sid as i64)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let key = |q: &str| format!("UPDATE terminal_prefs SET {q} WHERE user_id = ? AND session_name = ? AND sid = ?");
    if let Some(v) = body.name_enc {
        let name = match v {
            Value::Null => None,
            Value::String(s) if is_sealed(&s, 2048) => Some(s),
            _ => return Err(ApiError::bad_request("invalid nameEnc")),
        };
        sqlx::query(&key("name_enc = ?"))
            .bind(name)
            .bind(&user.id)
            .bind(&session)
            .bind(sid as i64)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.sort_key {
        let sort = match v {
            Value::Null => None,
            Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
            _ => return Err(ApiError::bad_request("invalid sortKey")),
        };
        sqlx::query(&key("sort_key = ?"))
            .bind(sort)
            .bind(&user.id)
            .bind(&session)
            .bind(sid as i64)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(pinned) = body.pinned {
        sqlx::query(&key("pinned = ?"))
            .bind(pinned)
            .bind(&user.id)
            .bind(&session)
            .bind(sid as i64)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(bell) = body.bell {
        sqlx::query(&key("bell = ?"))
            .bind(bell)
            .bind(&user.id)
            .bind(&session)
            .bind(sid as i64)
            .execute(&mut *tx)
            .await?;
    }
    let pref: PrefView = sqlx::query_as(
        "SELECT session_name, sid, name_enc, sort_key, pinned, bell FROM terminal_prefs
         WHERE user_id = ? AND session_name = ? AND sid = ?",
    )
    .bind(&user.id)
    .bind(&session)
    .bind(sid as i64)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(pref))
}

/// Forget an offline session and its terminals.
async fn forget_session(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(name): Path<String>,
) -> ApiResult<Json<Value>> {
    let machine_id = session_machine_for_user(&state, &user.id, &name).await?;
    let session: SessionView = sqlx::query_as(&format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE name = ?"))
        .bind(&name)
        .fetch_one(&state.db)
        .await?;
    if session.with_online(now_ms()).online {
        return Err(ApiError::conflict("the session is still online"));
    }
    sqlx::query("DELETE FROM sessions WHERE name = ?").bind(&name).execute(&state.db).await?;
    sqlx::query("DELETE FROM terminal_prefs WHERE session_name = ?").bind(&name).execute(&state.db).await?;
    state.emit(Event::SessionRemoved { machine_id, name });
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Administration (metadata only)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUser {
    id: String,
    username: String,
    display_name: String,
    is_admin: bool,
    created_at: i64,
    last_login_at: Option<i64>,
    has_vault: bool,
}

#[derive(sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminMachine {
    id: String,
    name: String,
    kind: String,
    project: Option<String>,
    owner: String,
    last_seen_at: Option<i64>,
    members: i64,
}

async fn admin_overview(State(state): State<Arc<AppState>>, user: CurrentUser) -> ApiResult<Json<Value>> {
    if !user.is_admin {
        return Err(ApiError::forbidden("admin only"));
    }
    let now = now_ms();
    let users: Vec<AdminUser> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.is_admin, u.created_at, u.last_login_at,
                EXISTS(SELECT 1 FROM vaults v WHERE v.user_id = u.id) AS has_vault
         FROM users u ORDER BY u.username",
    )
    .fetch_all(&state.db)
    .await?;
    let machines: Vec<AdminMachine> = sqlx::query_as(
        "SELECT m.id, m.name, m.kind, m.project, u.username AS owner, m.last_seen_at,
                (SELECT COUNT(*) FROM machine_keys k WHERE k.machine_id = m.id) AS members
         FROM machines m JOIN users u ON u.id = m.owner_id ORDER BY m.name",
    )
    .fetch_all(&state.db)
    .await?;
    let sessions: Vec<SessionView> = sqlx::query_as(&format!("SELECT {SESSION_COLUMNS} FROM sessions ORDER BY started_at"))
        .fetch_all(&state.db)
        .await?;
    let states: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT session_name, state, COUNT(*) FROM terminals GROUP BY session_name, state")
            .fetch_all(&state.db)
            .await?;
    let mut by_session: HashMap<String, serde_json::Map<String, Value>> = HashMap::new();
    for (session, st, n) in states {
        by_session.entry(session).or_default().insert(st, json!(n));
    }
    Ok(Json(json!({
        "users": users,
        "machines": machines,
        "sessions": sessions.into_iter().map(|s| {
            let s = s.with_online(now);
            json!({
                "name": s.name, "machineId": s.machine_id, "hostname": s.hostname, "displayName": s.display_name,
                "online": s.online, "startedAt": s.started_at, "lastSeenAt": s.last_seen_at,
                "version": s.version, "terminals": by_session.remove(&s.name).unwrap_or_default(),
            })
        }).collect::<Vec<_>>(),
    })))
}
