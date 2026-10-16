//! API used by `sshx` on machines, authenticated by a machine token.
//!
//! The token's bearer part (`smt_…`) is stored hashed. The machine key that
//! follows the dot in the full token never reaches this server.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{FromRequestParts, Path, State};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::events::Event;
use crate::models::{SessionView, TerminalView, AGENT_STATES, OFFLINE_AFTER_MS, SESSION_COLUMNS};
use crate::state::AppState;
use crate::util::{clean_label, is_safe_id, is_sealed, now_ms, sha256_hex};

/// Maximum number of terminals in one report.
const MAX_TERMINALS: usize = 256;

/// A machine authenticated by its token.
pub struct Machine {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub project: Option<String>,
    pub owner: String,
}

impl FromRequestParts<Arc<AppState>> for Machine {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| t.starts_with("smt_"))
            .ok_or_else(ApiError::unauthorized)?;
        let row: Option<(String, String, String, Option<String>, String)> = sqlx::query_as(
            "SELECT m.id, m.name, m.kind, m.project, u.username
             FROM machines m JOIN users u ON u.id = m.owner_id
             WHERE m.token_hash = ?",
        )
        .bind(sha256_hex(token.trim()))
        .fetch_optional(&state.db)
        .await?;
        let (id, name, kind, project, owner) = row.ok_or_else(ApiError::unauthorized)?;
        Ok(Machine { id, name, kind, project, owner })
    }
}

/// Routes under `/api/agent/v1`.
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/whoami", get(whoami))
        .route("/sessions", post(register))
        .route("/sessions/{name}/state", put(report))
        .route("/sessions/{name}/close", post(close))
}

async fn whoami(State(state): State<Arc<AppState>>, machine: Machine) -> ApiResult<Json<Value>> {
    let now = now_ms();
    let (online,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sessions WHERE machine_id = ? AND closed_at IS NULL AND last_seen_at > ?",
    )
    .bind(&machine.id)
    .bind(now - OFFLINE_AFTER_MS)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({
        "id": machine.id,
        "name": machine.name,
        "kind": machine.kind,
        "project": machine.project,
        "owner": machine.owner,
        "sshxServer": state.config.machine_sshx_server(),
        "sessionsOnline": online,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody {
    name: String,
    url: String,
    sshx_server: String,
    display_name: String,
    key_enc: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    os: String,
    #[serde(default)]
    arch: String,
    #[serde(default)]
    version: String,
}

async fn load_session(state: &AppState, name: &str) -> ApiResult<Option<SessionView>> {
    let row: Option<SessionView> = sqlx::query_as(&format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE name = ?"))
        .bind(name)
        .fetch_optional(&state.db)
        .await?;
    Ok(row.map(|s| s.with_online(now_ms())))
}

async fn touch_machine(state: &AppState, machine_id: &str, now: i64) -> ApiResult<()> {
    sqlx::query("UPDATE machines SET last_seen_at = ? WHERE id = ?")
        .bind(now)
        .bind(machine_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

/// `POST /sessions`: a machine announces a new sshx session.
async fn register(
    State(state): State<Arc<AppState>>,
    machine: Machine,
    Json(body): Json<RegisterBody>,
) -> ApiResult<Json<Value>> {
    if !is_safe_id(&body.name) {
        return Err(ApiError::bad_request("invalid session name"));
    }
    if !is_sealed(&body.key_enc, 4096) {
        return Err(ApiError::bad_request("invalid keyEnc"));
    }
    if body.url.len() > 512 || !(body.url.starts_with("http://") || body.url.starts_with("https://")) {
        return Err(ApiError::bad_request("invalid url"));
    }
    let now = now_ms();

    if let Some(existing) = load_session(&state, &body.name).await? {
        if existing.machine_id != machine.id {
            if existing.online {
                return Err(ApiError::conflict("session name in use by another machine"));
            }
            // A stale session of another machine: forget it.
            sqlx::query("DELETE FROM sessions WHERE name = ?")
                .bind(&body.name)
                .execute(&state.db)
                .await?;
            state.emit(Event::SessionRemoved { machine_id: existing.machine_id, name: body.name.clone() });
        }
    }

    sqlx::query(
        "INSERT INTO sessions (name, machine_id, url, sshx_server, display_name, key_enc, hostname,
                               username, os, arch, version, started_at, last_seen_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(name) DO UPDATE SET
            machine_id = excluded.machine_id, url = excluded.url, sshx_server = excluded.sshx_server,
            display_name = excluded.display_name, key_enc = excluded.key_enc,
            hostname = excluded.hostname, username = excluded.username, os = excluded.os,
            arch = excluded.arch, version = excluded.version,
            started_at = CASE WHEN sessions.closed_at IS NULL THEN sessions.started_at ELSE excluded.started_at END,
            last_seen_at = excluded.last_seen_at, closed_at = NULL",
    )
    .bind(&body.name)
    .bind(&machine.id)
    .bind(&body.url)
    .bind(clean_label(&body.sshx_server, 256))
    .bind(clean_label(&body.display_name, 128))
    .bind(&body.key_enc)
    .bind(clean_label(&body.hostname, 128))
    .bind(clean_label(&body.username, 64))
    .bind(clean_label(&body.os, 32))
    .bind(clean_label(&body.arch, 32))
    .bind(clean_label(&body.version, 32))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    touch_machine(&state, &machine.id, now).await?;

    if let Some(session) = load_session(&state, &body.name).await? {
        state.emit(Event::Session { machine_id: machine.id.clone(), session });
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalReport {
    sid: u32,
    state: String,
    #[serde(default)]
    since: Option<i64>,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    meta_enc: Option<String>,
}

#[derive(Deserialize)]
struct ReportBody {
    terminals: Vec<TerminalReport>,
}

/// `PUT /sessions/{name}/state`: heartbeat with the full terminal list.
async fn report(
    State(state): State<Arc<AppState>>,
    machine: Machine,
    Path(name): Path<String>,
    Json(body): Json<ReportBody>,
) -> ApiResult<Json<Value>> {
    let Some(session) = load_session(&state, &name).await? else {
        return Err(ApiError::not_found("unknown session"));
    };
    if session.machine_id != machine.id || session.closed_at.is_some() {
        return Err(ApiError::not_found("unknown session"));
    }
    if body.terminals.len() > MAX_TERMINALS {
        return Err(ApiError::bad_request("too many terminals"));
    }
    for t in &body.terminals {
        if !AGENT_STATES.contains(&t.state.as_str()) {
            return Err(ApiError::bad_request(format!("invalid state {}", t.state)));
        }
        if t.agent.as_ref().is_some_and(|a| !is_safe_id(a)) {
            return Err(ApiError::bad_request("invalid agent"));
        }
        if t.meta_enc.as_ref().is_some_and(|m| !is_sealed(m, 64 * 1024)) {
            return Err(ApiError::bad_request("invalid metaEnc"));
        }
    }

    let now = now_ms();
    let existing: Vec<TerminalView> = sqlx::query_as(
        "SELECT session_name, sid, state, agent, state_since, meta_enc, created_at, updated_at
         FROM terminals WHERE session_name = ?",
    )
    .bind(&name)
    .fetch_all(&state.db)
    .await?;
    let mut existing: HashMap<i64, TerminalView> = existing.into_iter().map(|t| (t.sid, t)).collect();

    let mut changed = Vec::new();
    let mut tx = state.db.begin().await?;
    for t in body.terminals {
        let sid = t.sid as i64;
        let prev = existing.remove(&sid);
        let same = prev.as_ref().is_some_and(|p| {
            p.state == t.state && p.agent == t.agent && p.state_since == t.since && p.meta_enc == t.meta_enc
        });
        if same {
            continue;
        }
        let created_at = prev.as_ref().map(|p| p.created_at).unwrap_or(now);
        sqlx::query(
            "INSERT INTO terminals (session_name, sid, state, agent, state_since, meta_enc, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_name, sid) DO UPDATE SET
                state = excluded.state, agent = excluded.agent, state_since = excluded.state_since,
                meta_enc = excluded.meta_enc, updated_at = excluded.updated_at",
        )
        .bind(&name)
        .bind(sid)
        .bind(&t.state)
        .bind(&t.agent)
        .bind(t.since)
        .bind(&t.meta_enc)
        .bind(created_at)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        changed.push(TerminalView {
            session_name: name.clone(),
            sid,
            state: t.state,
            agent: t.agent,
            state_since: t.since,
            meta_enc: t.meta_enc,
            created_at,
            updated_at: now,
        });
    }
    // Terminals missing from the report were closed.
    let removed: Vec<i64> = existing.into_keys().collect();
    for sid in &removed {
        sqlx::query("DELETE FROM terminals WHERE session_name = ? AND sid = ?")
            .bind(&name)
            .bind(sid)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE sessions SET last_seen_at = ? WHERE name = ?")
        .bind(now)
        .bind(&name)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    touch_machine(&state, &machine.id, now).await?;

    if !session.online {
        if let Some(session) = load_session(&state, &name).await? {
            state.emit(Event::Session { machine_id: machine.id.clone(), session });
        }
    }
    for terminal in changed {
        state.emit(Event::Terminal { machine_id: machine.id.clone(), terminal });
    }
    for sid in removed {
        state.emit(Event::TerminalRemoved { machine_id: machine.id.clone(), session: name.clone(), sid });
    }
    Ok(Json(json!({ "ok": true })))
}

/// `POST /sessions/{name}/close`: the sshx process is exiting.
async fn close(
    State(state): State<Arc<AppState>>,
    machine: Machine,
    Path(name): Path<String>,
) -> ApiResult<Json<Value>> {
    let Some(session) = load_session(&state, &name).await? else {
        return Err(ApiError::not_found("unknown session"));
    };
    if session.machine_id != machine.id {
        return Err(ApiError::not_found("unknown session"));
    }
    sqlx::query("UPDATE sessions SET closed_at = ? WHERE name = ?")
        .bind(now_ms())
        .bind(&name)
        .execute(&state.db)
        .await?;
    if let Some(session) = load_session(&state, &name).await? {
        state.emit(Event::Session { machine_id: machine.id, session });
    }
    Ok(Json(json!({ "ok": true })))
}
