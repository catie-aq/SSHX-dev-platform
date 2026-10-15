//! WebSocket proxy from browsers to the sshx server.
//!
//! Browsers keep using sshx's own protocol (CBOR messages, end-to-end
//! encrypted terminal data); this server only checks that the logged-in user
//! may reach the session, then pipes frames both ways. The sshx server still
//! requires proof of the session key (`encrypted_zeros`) on top of that.

use std::sync::Arc;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame as UpCloseFrame;
use tokio_tungstenite::tungstenite::Message as UpMessage;
use tracing::{debug, warn};

use crate::api::session_machine_for_user;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::util::is_safe_id;

/// `GET /api/s/{name}`: upgrade and proxy to the sshx server.
pub async fn session_ws(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(name): Path<String>,
    ws: WebSocketUpgrade,
) -> ApiResult<Response> {
    if !is_safe_id(&name) {
        return Err(ApiError::bad_request("invalid session name"));
    }
    session_machine_for_user(&state, &user.id, &name).await?;
    let url = format!("{}/api/s/{name}", state.config.sshx_ws_base());
    debug!(user = %user.username, %name, "proxying session WebSocket");
    Ok(ws.on_upgrade(move |socket| pump(socket, url)))
}

async fn pump(mut client: WebSocket, url: String) {
    let upstream = match tokio_tungstenite::connect_async(&url).await {
        Ok((stream, _)) => stream,
        Err(err) => {
            warn!(%url, %err, "cannot reach the sshx server");
            let frame = CloseFrame { code: 4500, reason: "sshx server unreachable".into() };
            client.send(Message::Close(Some(frame))).await.ok();
            return;
        }
    };
    let (mut up_tx, mut up_rx) = upstream.split();
    let (mut cl_tx, mut cl_rx) = client.split();
    loop {
        tokio::select! {
            msg = cl_rx.next() => {
                let up = match msg {
                    Some(Ok(Message::Binary(b))) => UpMessage::Binary(b),
                    Some(Ok(Message::Text(t))) => UpMessage::Text(t.as_str().into()),
                    Some(Ok(Message::Close(frame))) => {
                        let frame = frame.map(|f| UpCloseFrame { code: CloseCode::from(f.code), reason: f.reason.as_str().into() });
                        up_tx.send(UpMessage::Close(frame)).await.ok();
                        break;
                    }
                    Some(Ok(_)) => continue, // pings are answered locally
                    _ => {
                        up_tx.send(UpMessage::Close(None)).await.ok();
                        break;
                    }
                };
                if up_tx.send(up).await.is_err() {
                    break;
                }
            }
            msg = up_rx.next() => {
                let down = match msg {
                    Some(Ok(UpMessage::Binary(b))) => Message::Binary(b),
                    Some(Ok(UpMessage::Text(t))) => Message::Text(t.as_str().into()),
                    Some(Ok(UpMessage::Close(frame))) => {
                        // Forward sshx close codes (4404 not found, 4500 error).
                        let frame = frame.map(|f| CloseFrame { code: f.code.into(), reason: f.reason.as_str().into() });
                        cl_tx.send(Message::Close(frame)).await.ok();
                        break;
                    }
                    Some(Ok(_)) => continue,
                    _ => {
                        let frame = CloseFrame { code: 4500, reason: "sshx server connection lost".into() };
                        cl_tx.send(Message::Close(Some(frame))).await.ok();
                        break;
                    }
                };
                if cl_tx.send(down).await.is_err() {
                    break;
                }
            }
        }
    }
}
