//! Command-line and environment configuration.

use std::net::SocketAddr;
use std::path::PathBuf;

use clap::{Parser, ValueEnum};

/// How humans authenticate.
#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMode {
    /// Pick any username, no password. For setup and development only.
    Dev,
    /// OpenID Connect (Microsoft Entra ID or any compliant provider).
    Oidc,
}

/// SSHX Platform: multi-user web platform for persistent sshx terminals and AI agents.
#[derive(Parser, Debug, Clone)]
#[clap(version, about)]
pub struct Config {
    /// Address to listen on.
    #[clap(long, env = "PLATFORM_LISTEN", default_value = "127.0.0.1:8060")]
    pub listen: SocketAddr,

    /// SQLite database URL.
    #[clap(long, env = "PLATFORM_DATABASE", default_value = "sqlite://platform.db")]
    pub database: String,

    /// Public URL of the platform (used for OIDC redirects and secure cookies).
    #[clap(long, env = "PLATFORM_PUBLIC_URL")]
    pub public_url: Option<String>,

    /// sshx server that relays terminals, as reached from this server.
    /// Browsers connect to it through this server's WebSocket proxy.
    #[clap(long, env = "PLATFORM_SSHX_SERVER", default_value = "http://127.0.0.1:8051")]
    pub sshx_server: String,

    /// sshx server as reached from the machines, announced to them at
    /// enrollment. Defaults to --sshx-server.
    #[clap(long, env = "PLATFORM_SSHX_PUBLIC_URL")]
    pub sshx_public_url: Option<String>,

    /// Directory of the compiled web app.
    #[clap(long, env = "PLATFORM_STATIC_DIR", default_value = "build")]
    pub static_dir: PathBuf,

    /// Authentication mode.
    #[clap(long, value_enum, env = "PLATFORM_AUTH", default_value = "dev")]
    pub auth: AuthMode,

    /// OIDC issuer, e.g. https://login.microsoftonline.com/<tenant-id>/v2.0
    #[clap(long, env = "PLATFORM_OIDC_ISSUER")]
    pub oidc_issuer: Option<String>,

    /// OIDC client (application) ID.
    #[clap(long, env = "PLATFORM_OIDC_CLIENT_ID")]
    pub oidc_client_id: Option<String>,

    /// OIDC client secret.
    #[clap(long, env = "PLATFORM_OIDC_CLIENT_SECRET", hide_env_values = true)]
    pub oidc_client_secret: Option<String>,

    /// Usernames (UPN / email) granted the admin role, comma-separated.
    #[clap(long, env = "PLATFORM_ADMINS", value_delimiter = ',')]
    pub admins: Vec<String>,
}

impl Config {
    /// Whether cookies must carry the `Secure` flag.
    pub fn secure_cookies(&self) -> bool {
        self.public_url
            .as_deref()
            .is_some_and(|u| u.starts_with("https://"))
    }

    /// WebSocket base URL of the sshx server.
    pub fn sshx_ws_base(&self) -> String {
        let base = self.sshx_server.trim_end_matches('/');
        if let Some(rest) = base.strip_prefix("https://") {
            format!("wss://{rest}")
        } else if let Some(rest) = base.strip_prefix("http://") {
            format!("ws://{rest}")
        } else {
            base.to_string()
        }
    }

    /// sshx server URL that machines should use.
    pub fn machine_sshx_server(&self) -> &str {
        self.sshx_public_url
            .as_deref()
            .unwrap_or(&self.sshx_server)
            .trim_end_matches('/')
    }

    /// Whether `username` is listed as an admin.
    pub fn is_admin(&self, username: &str) -> bool {
        self.admins
            .iter()
            .any(|a| a.trim().eq_ignore_ascii_case(username))
    }
}
