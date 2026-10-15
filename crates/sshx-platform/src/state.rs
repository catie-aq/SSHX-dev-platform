//! Shared application state.

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::events::Event;
use crate::oidc::Oidc;

/// State shared by every request handler.
pub struct AppState {
    pub db: SqlitePool,
    pub config: Config,
    pub events: broadcast::Sender<Event>,
    pub oidc: Option<Oidc>,
}

impl AppState {
    /// Broadcast an event to connected browsers (ignores the no-listener case).
    pub fn emit(&self, event: Event) {
        self.events.send(event).ok();
    }
}
