//! Rows and JSON views shared by the web and agent APIs.

use serde::Serialize;
use sqlx::FromRow;

/// A session is considered offline after this long without a report.
pub const OFFLINE_AFTER_MS: i64 = 45_000;

/// Agent states reported by machines.
pub const AGENT_STATES: &[&str] = &["none", "idle", "working", "question", "permission", "done"];

/// An sshx session as seen by browsers.
#[derive(Serialize, FromRow, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub name: String,
    pub machine_id: String,
    pub url: String,
    pub sshx_server: String,
    pub display_name: String,
    pub key_enc: String,
    pub hostname: String,
    pub username: String,
    pub os: String,
    pub arch: String,
    pub version: String,
    pub started_at: i64,
    pub last_seen_at: i64,
    pub closed_at: Option<i64>,
    #[sqlx(skip)]
    pub online: bool,
}

impl SessionView {
    /// Compute the `online` flag at time `now`.
    pub fn with_online(mut self, now: i64) -> Self {
        self.online = self.closed_at.is_none() && now - self.last_seen_at < OFFLINE_AFTER_MS;
        self
    }
}

/// Columns selected for [`SessionView`].
pub const SESSION_COLUMNS: &str = "name, machine_id, url, sshx_server, display_name, key_enc, \
    hostname, username, os, arch, version, started_at, last_seen_at, closed_at";

/// A terminal of a session.
#[derive(Serialize, FromRow, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalView {
    #[serde(rename = "session")]
    pub session_name: String,
    pub sid: i64,
    pub state: String,
    pub agent: Option<String>,
    pub state_since: Option<i64>,
    pub meta_enc: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Per-user preferences of a terminal.
#[derive(Serialize, FromRow, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrefView {
    #[serde(rename = "session")]
    pub session_name: String,
    pub sid: i64,
    pub name_enc: Option<String>,
    pub sort_key: Option<f64>,
    pub pinned: bool,
    pub bell: bool,
}

/// A machine the current user can access.
#[derive(Serialize, FromRow, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MachineView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub project: Option<String>,
    pub owner_id: String,
    pub owner_name: String,
    pub token_hint: String,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
    /// Machine key wrapped for the current user.
    pub key_enc: String,
    /// `vault` or `ecdh`.
    pub scheme: String,
    #[sqlx(skip)]
    pub members: Vec<MemberView>,
}

/// A user with access to a machine.
#[derive(Serialize, FromRow, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemberView {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub scheme: String,
}

/// Public information about a user, for sharing.
#[derive(Serialize, FromRow, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UserView {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub public_key: Option<String>,
}
