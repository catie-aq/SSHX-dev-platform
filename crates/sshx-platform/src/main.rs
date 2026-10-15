//! Entry point of the sshx platform server.

use anyhow::Result;
use clap::Parser;
use sshx_platform::config::Config;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sqlx=warn".into()))
        .init();
    sshx_platform::serve(Config::parse()).await
}
