//! Live updates pushed to browsers with Server-Sent Events.

use std::collections::HashSet;
use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::State;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use futures_util::Stream;
use serde::Serialize;
use tokio::sync::broadcast::error::RecvError;

use crate::auth::CurrentUser;
use crate::error::ApiResult;
use crate::models::{SessionView, TerminalView};
use crate::state::AppState;

/// An event broadcast to every connected browser, filtered per user.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    /// A session was registered or changed (including online status).
    Session {
        #[serde(skip)]
        machine_id: String,
        session: SessionView,
    },
    /// A terminal was created or changed.
    Terminal {
        #[serde(skip)]
        machine_id: String,
        terminal: TerminalView,
    },
    /// A terminal was closed.
    TerminalRemoved {
        #[serde(skip)]
        machine_id: String,
        session: String,
        sid: i64,
    },
    /// A session was forgotten.
    SessionRemoved {
        #[serde(skip)]
        machine_id: String,
        name: String,
    },
    /// Machines or memberships changed for these users: refetch everything.
    Resync {
        #[serde(skip)]
        users: Vec<String>,
    },
}

impl Event {
    fn machine_id(&self) -> Option<&str> {
        match self {
            Event::Session { machine_id, .. }
            | Event::Terminal { machine_id, .. }
            | Event::TerminalRemoved { machine_id, .. }
            | Event::SessionRemoved { machine_id, .. } => Some(machine_id),
            Event::Resync { .. } => None,
        }
    }
}

/// Machine IDs a user can access.
pub async fn accessible_machines(db: &sqlx::SqlitePool, user_id: &str) -> sqlx::Result<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT machine_id FROM machine_keys WHERE user_id = ?")
        .bind(user_id)
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

fn to_sse(event: &Event) -> SseEvent {
    SseEvent::default().data(serde_json::to_string(event).unwrap_or_default())
}

/// `GET /api/events`: stream of [`Event`]s for the current user.
pub async fn stream(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
) -> ApiResult<Sse<impl Stream<Item = Result<SseEvent, Infallible>>>> {
    let mut rx = state.events.subscribe();
    let mut access = accessible_machines(&state.db, &user.id).await?;
    let db = state.db.clone();
    let stream = async_stream::stream! {
        yield Ok(SseEvent::default().event("ready").data("{}"));
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Event::Resync { users } = &event {
                        if users.contains(&user.id) {
                            if let Ok(a) = accessible_machines(&db, &user.id).await {
                                access = a;
                            }
                            yield Ok(to_sse(&event));
                        }
                        continue;
                    }
                    if event.machine_id().is_some_and(|m| access.contains(m)) {
                        yield Ok(to_sse(&event));
                    }
                }
                Err(RecvError::Lagged(_)) => {
                    if let Ok(a) = accessible_machines(&db, &user.id).await {
                        access = a;
                    }
                    yield Ok(to_sse(&Event::Resync { users: vec![] }));
                }
                Err(RecvError::Closed) => break,
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
