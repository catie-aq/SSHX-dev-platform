//! Human authentication: cookie sessions, dev login, CSRF guard.
//!
//! Two modes (see [`crate::config::AuthMode`]):
//! - `dev`: anyone picks a username, no password, every user is admin. This
//!   is the temporary "simple admin access without security" mode, meant for
//!   setup on a private tailnet until the Entra application exists.
//! - `oidc`: login through Microsoft Entra ID (see [`crate::oidc`]).

use std::sync::Arc;

use axum::extract::{FromRequestParts, Request, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::config::AuthMode;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::util::{now_ms, random_id, random_secret, sha256_hex};

/// Name of the session cookie.
pub const COOKIE_NAME: &str = "sxp_session";

/// Lifetime of a login session.
const SESSION_TTL_MS: i64 = 30 * 24 * 3600 * 1000;

/// Header required on state-changing requests (CSRF protection: cross-site
/// forms cannot set custom headers, and the cookie is `SameSite=Lax`).
pub const CSRF_HEADER: &str = "x-sshx-platform";

/// The authenticated user of a request.
#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub is_admin: bool,
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

impl FromRequestParts<Arc<AppState>> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> Result<Self, Self::Rejection> {
        let token = cookie_value(&parts.headers, COOKIE_NAME).ok_or_else(ApiError::unauthorized)?;
        let row: Option<(String, String, String, bool)> = sqlx::query_as(
            "SELECT u.id, u.username, u.display_name, u.is_admin
             FROM web_sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > ?",
        )
        .bind(sha256_hex(&token))
        .bind(now_ms())
        .fetch_optional(&state.db)
        .await?;
        let (id, username, display_name, is_admin) = row.ok_or_else(ApiError::unauthorized)?;
        Ok(CurrentUser {
            id,
            username,
            display_name,
            is_admin: is_admin || state.config.auth == AuthMode::Dev,
        })
    }
}

/// Reject state-changing browser requests that lack the CSRF header.
pub async fn csrf_guard(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let safe = matches!(*request.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    let browser_api = path.starts_with("/api/") && !path.starts_with("/api/agent/");
    if !safe && browser_api && request.headers().get(CSRF_HEADER).is_none() {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "missing CSRF header" }))).into_response();
    }
    next.run(request).await
}

/// Build the `Set-Cookie` header value for a login session.
fn session_cookie(state: &AppState, token: &str, max_age_secs: i64) -> HeaderValue {
    let secure = if state.config.secure_cookies() { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_secs}{secure}"
    ))
    .expect("cookie is ASCII")
}

/// Create a login session and return the `Set-Cookie` header.
pub async fn start_session(state: &AppState, user_id: &str) -> ApiResult<HeaderValue> {
    let token = random_secret(32);
    let now = now_ms();
    sqlx::query("INSERT INTO web_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(sha256_hex(&token))
        .bind(user_id)
        .bind(now)
        .bind(now + SESSION_TTL_MS)
        .execute(&state.db)
        .await?;
    sqlx::query("UPDATE users SET last_login_at = ? WHERE id = ?")
        .bind(now)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    // Opportunistic cleanup of expired sessions.
    sqlx::query("DELETE FROM web_sessions WHERE expires_at < ?")
        .bind(now)
        .execute(&state.db)
        .await?;
    Ok(session_cookie(state, &token, SESSION_TTL_MS / 1000))
}

/// Find or create a user by username (dev mode) or OIDC subject.
pub async fn upsert_user(
    state: &AppState,
    username: &str,
    display_name: &str,
    oidc_subject: Option<&str>,
) -> ApiResult<String> {
    let is_admin = state.config.is_admin(username);
    let existing: Option<(String,)> = match oidc_subject {
        Some(sub) => sqlx::query_as("SELECT id FROM users WHERE oidc_subject = ?")
            .bind(sub)
            .fetch_optional(&state.db)
            .await?,
        None => sqlx::query_as("SELECT id FROM users WHERE username = ? AND oidc_subject IS NULL")
            .bind(username)
            .fetch_optional(&state.db)
            .await?,
    };
    if let Some((id,)) = existing {
        sqlx::query("UPDATE users SET username = ?, display_name = ?, is_admin = ? WHERE id = ?")
            .bind(username)
            .bind(display_name)
            .bind(is_admin)
            .bind(&id)
            .execute(&state.db)
            .await?;
        return Ok(id);
    }
    let id = random_id();
    let res = sqlx::query(
        "INSERT INTO users (id, username, display_name, oidc_subject, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(username)
    .bind(display_name)
    .bind(oidc_subject)
    .bind(is_admin)
    .bind(now_ms())
    .execute(&state.db)
    .await;
    match res {
        Ok(_) => Ok(id),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            Err(ApiError::conflict("this username is already taken by another account"))
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(Deserialize)]
pub struct DevLogin {
    username: String,
}

fn normalize_username(raw: &str) -> Option<String> {
    let name = raw.trim().to_lowercase();
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '@'));
    ok.then_some(name)
}

/// `POST /api/auth/dev/login`: log in as any username (dev mode only).
pub async fn dev_login(State(state): State<Arc<AppState>>, Json(body): Json<DevLogin>) -> ApiResult<Response> {
    if state.config.auth != AuthMode::Dev {
        return Err(ApiError::forbidden("dev login is disabled"));
    }
    let username = normalize_username(&body.username)
        .ok_or_else(|| ApiError::bad_request("username: 1-64 chars among a-z 0-9 . _ - @"))?;
    let id = upsert_user(&state, &username, &username, None).await?;
    let cookie = start_session(&state, &id).await?;
    Ok(([(SET_COOKIE, cookie)], Json(json!({ "ok": true }))).into_response())
}

/// `POST /api/auth/logout`: end the current login session.
pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(token) = cookie_value(&headers, COOKIE_NAME) {
        sqlx::query("DELETE FROM web_sessions WHERE token_hash = ?")
            .bind(sha256_hex(&token))
            .execute(&state.db)
            .await?;
    }
    Ok(([(SET_COOKIE, session_cookie(&state, "", 0))], Json(json!({ "ok": true }))).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames() {
        assert_eq!(normalize_username(" Alice@Catie.fr ").as_deref(), Some("alice@catie.fr"));
        assert!(normalize_username("a b").is_none());
        assert!(normalize_username("").is_none());
    }

    #[test]
    fn cookie_parsing() {
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_static("a=1; sxp_session=tok; b=2"));
        assert_eq!(cookie_value(&headers, COOKIE_NAME).as_deref(), Some("tok"));
    }
}
