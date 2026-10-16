//! sshx platform: multi-user web app for persistent sshx terminals and AI agents.
//!
//! See `docs/architecture.md` for the design, notably the key hierarchy that
//! keeps terminals end-to-end encrypted.

use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::Router;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tokio::sync::broadcast;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

pub mod agent_api;
pub mod api;
pub mod auth;
pub mod config;
pub mod error;
pub mod events;
pub mod models;
pub mod oidc;
pub mod proxy;
pub mod state;
pub mod util;

use config::{AuthMode, Config};

use events::Event;
use models::{SessionView, SESSION_COLUMNS};
use state::AppState;

/// Open the database and apply migrations.
pub async fn open_db(url: &str) -> Result<sqlx::SqlitePool> {
    let options = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new().max_connections(8).connect_with(options).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

/// Build the HTTP application.
pub fn app(state: Arc<AppState>) -> Router {
    let static_dir = state.config.static_dir.clone();
    let spa = ServeFile::new(static_dir.join("index.html"));
    let files = ServeDir::new(&static_dir).precompressed_gzip().fallback(spa);
    Router::new()
        .nest("/api", api::routes())
        .fallback_service(files)
        .layer(axum::middleware::from_fn(auth::csrf_guard))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Emit `Session` events when sessions go offline without closing.
pub async fn presence_sweeper(state: Arc<AppState>) {
    let mut online: HashSet<String> = HashSet::new();
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let now = util::now_ms();
        let sessions: Vec<SessionView> = match sqlx::query_as(&format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE closed_at IS NULL"
        ))
        .fetch_all(&state.db)
        .await
        {
            Ok(s) => s,
            Err(err) => {
                warn!(?err, "presence sweep failed");
                continue;
            }
        };
        let mut next = HashSet::new();
        for session in sessions {
            let session = session.with_online(now);
            if session.online {
                next.insert(session.name.clone());
            } else if online.contains(&session.name) {
                state.emit(Event::Session { machine_id: session.machine_id.clone(), session });
            }
        }
        online = next;
    }
}

/// Build the shared state from a configuration.
pub async fn build_state(config: Config) -> Result<Arc<AppState>> {
    let oidc = match config.auth {
        AuthMode::Oidc => Some(oidc::Oidc::from_config(&config).context("invalid OIDC configuration")?),
        AuthMode::Dev => {
            warn!("dev authentication: anyone reaching this server can log in as any user");
            None
        }
    };
    let db = open_db(&config.database).await?;
    let (events, _) = broadcast::channel(1024);
    Ok(Arc::new(AppState { db, config, events, oidc }))
}

/// Run the server until it fails.
pub async fn serve(config: Config) -> Result<()> {
    let state = build_state(config.clone()).await?;
    tokio::spawn(presence_sweeper(state.clone()));
    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    info!(listen = %listener.local_addr()?, sshx = %config.sshx_server, "SSHX Platform listening");
    axum::serve(listener, app(state)).await?;
    Ok(())
}
