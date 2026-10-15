//! OpenID Connect login (authorization code flow with PKCE).
//!
//! Written for Microsoft Entra ID with a single tenant, but only relies on
//! standard discovery, so any compliant provider works. Configure with
//! `--auth oidc --oidc-issuer https://login.microsoftonline.com/<tenant>/v2.0
//! --oidc-client-id <app id> --oidc-client-secret <secret>`, and register
//! `<public-url>/api/auth/oidc/callback` as a Web redirect URI in Entra.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use axum::extract::{Query, State};
use axum::http::header::{LOCATION, SET_COOKIE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tracing::warn;

use crate::auth::{start_session, upsert_user};
use crate::config::Config;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::util::random_secret;

/// Pending logins expire after this long.
const PENDING_TTL: Duration = Duration::from_secs(600);
/// Signing keys are refreshed at most this often.
const JWKS_TTL: Duration = Duration::from_secs(3600);

#[derive(Deserialize, Clone)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
}

struct Pending {
    nonce: String,
    verifier: String,
    created: Instant,
}

/// OIDC client state.
pub struct Oidc {
    issuer: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    http: reqwest::Client,
    discovery: Mutex<Option<Discovery>>,
    jwks: Mutex<Option<(JwkSet, Instant)>>,
    pending: Mutex<HashMap<String, Pending>>,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    #[serde(default)]
    oid: Option<String>,
    #[serde(default)]
    nonce: Option<String>,
    #[serde(default)]
    preferred_username: Option<String>,
    #[serde(default)]
    upn: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

impl Oidc {
    /// Build the client from the configuration, if OIDC is configured.
    pub fn from_config(config: &Config) -> Result<Self> {
        let issuer = config.oidc_issuer.clone().context("--oidc-issuer is required")?;
        let client_id = config.oidc_client_id.clone().context("--oidc-client-id is required")?;
        let client_secret = config
            .oidc_client_secret
            .clone()
            .context("--oidc-client-secret is required")?;
        let public_url = config
            .public_url
            .clone()
            .context("--public-url is required for OIDC redirects")?;
        Ok(Self {
            issuer: issuer.trim_end_matches('/').to_string(),
            client_id,
            client_secret,
            redirect_uri: format!("{}/api/auth/oidc/callback", public_url.trim_end_matches('/')),
            http: reqwest::Client::builder().timeout(Duration::from_secs(15)).build()?,
            discovery: Mutex::new(None),
            jwks: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
        })
    }

    async fn discovery(&self) -> Result<Discovery> {
        let mut guard = self.discovery.lock().await;
        if let Some(d) = guard.as_ref() {
            return Ok(d.clone());
        }
        let url = format!("{}/.well-known/openid-configuration", self.issuer);
        let d: Discovery = self.http.get(&url).send().await?.error_for_status()?.json().await?;
        *guard = Some(d.clone());
        Ok(d)
    }

    async fn jwks(&self, uri: &str, force: bool) -> Result<JwkSet> {
        let mut guard = self.jwks.lock().await;
        if let Some((set, at)) = guard.as_ref() {
            if !force && at.elapsed() < JWKS_TTL {
                return Ok(set.clone());
            }
        }
        let set: JwkSet = self.http.get(uri).send().await?.error_for_status()?.json().await?;
        *guard = Some((set.clone(), Instant::now()));
        Ok(set)
    }

    /// Start a login: returns the provider URL to redirect to.
    async fn authorize_url(&self) -> Result<String> {
        let d = self.discovery().await?;
        let state = random_secret(24);
        let nonce = random_secret(24);
        let verifier = random_secret(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        {
            let mut pending = self.pending.lock().await;
            pending.retain(|_, p| p.created.elapsed() < PENDING_TTL);
            pending.insert(state.clone(), Pending { nonce: nonce.clone(), verifier, created: Instant::now() });
        }
        let url = url::Url::parse_with_params(
            &d.authorization_endpoint,
            &[
                ("response_type", "code"),
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("scope", "openid profile email"),
                ("response_mode", "query"),
                ("state", state.as_str()),
                ("nonce", nonce.as_str()),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "S256"),
            ],
        )?;
        Ok(url.to_string())
    }

    /// Finish a login: exchange the code and verify the ID token.
    async fn finish(&self, code: &str, state: &str) -> Result<Claims> {
        let pending = self
            .pending
            .lock()
            .await
            .remove(state)
            .filter(|p| p.created.elapsed() < PENDING_TTL)
            .context("unknown or expired login state")?;
        let d = self.discovery().await?;
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("redirect_uri", &self.redirect_uri)
            .append_pair("client_id", &self.client_id)
            .append_pair("client_secret", &self.client_secret)
            .append_pair("code_verifier", &pending.verifier)
            .finish();
        #[derive(Deserialize)]
        struct TokenResponse {
            id_token: String,
        }
        let resp = self
            .http
            .post(&d.token_endpoint)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            bail!("token endpoint returned {status}: {}", text.chars().take(300).collect::<String>());
        }
        let tokens: TokenResponse = resp.json().await?;

        let header = decode_header(&tokens.id_token)?;
        let kid = header.kid.context("ID token has no key ID")?;
        let mut jwks = self.jwks(&d.jwks_uri, false).await?;
        if jwks.find(&kid).is_none() {
            jwks = self.jwks(&d.jwks_uri, true).await?; // key rotation
        }
        let jwk = jwks.find(&kid).context("unknown ID token signing key")?;
        let key = DecodingKey::from_jwk(jwk)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[&self.client_id]);
        validation.set_issuer(&[&d.issuer]);
        let claims = decode::<Claims>(&tokens.id_token, &key, &validation)?.claims;
        if claims.nonce.as_deref() != Some(pending.nonce.as_str()) {
            bail!("ID token nonce mismatch");
        }
        Ok(claims)
    }
}

/// `GET /api/auth/oidc/login`: redirect to the identity provider.
pub async fn login(State(state): State<Arc<AppState>>) -> ApiResult<Response> {
    let oidc = state.oidc.as_ref().ok_or_else(|| ApiError::not_found("OIDC is not configured"))?;
    let url = oidc.authorize_url().await?;
    Ok((StatusCode::FOUND, [(LOCATION, url)]).into_response())
}

#[derive(Deserialize)]
pub struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// `GET /api/auth/oidc/callback`: complete the login and open a session.
pub async fn callback(State(state): State<Arc<AppState>>, Query(q): Query<Callback>) -> ApiResult<Response> {
    let oidc = state.oidc.as_ref().ok_or_else(|| ApiError::not_found("OIDC is not configured"))?;
    if let Some(err) = q.error {
        warn!(%err, desc = ?q.error_description, "OIDC provider returned an error");
        return Ok((StatusCode::FOUND, [(LOCATION, "/login?error=provider".to_string())]).into_response());
    }
    let (Some(code), Some(login_state)) = (q.code, q.state) else {
        return Err(ApiError::bad_request("missing code or state"));
    };
    let claims = match oidc.finish(&code, &login_state).await {
        Ok(c) => c,
        Err(err) => {
            warn!("OIDC login failed: {err:#}");
            return Ok((StatusCode::FOUND, [(LOCATION, "/login?error=oidc".to_string())]).into_response());
        }
    };
    let username = claims
        .preferred_username
        .or(claims.upn)
        .or(claims.email)
        .unwrap_or_else(|| claims.sub.clone())
        .to_lowercase();
    let display_name = claims.name.unwrap_or_else(|| username.clone());
    let subject = claims.oid.unwrap_or(claims.sub);
    let user_id = upsert_user(&state, &username, &display_name, Some(&subject)).await?;
    let cookie = start_session(&state, &user_id).await?;
    Ok((StatusCode::FOUND, [(LOCATION, axum::http::HeaderValue::from_static("/")), (SET_COOKIE, cookie)]).into_response())
}
