//! Small helpers shared by the handlers.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Current time as UNIX milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Random secret of `bytes` bytes, base64url without padding.
pub fn random_secret(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// Random identifier (16 bytes, hex).
pub fn random_id() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-256 of a string, hex encoded. Used to store bearer secrets.
pub fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Whether `s` is a plausible identifier: 1–64 chars of `[A-Za-z0-9_-]`.
pub fn is_safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Whether `s` looks like a sealed value (`v1.` + base64url), bounded in size.
pub fn is_sealed(s: &str, max_len: usize) -> bool {
    s.len() <= max_len
        && s.strip_prefix("v1.").is_some_and(|rest| {
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
}

/// Trim and bound a free-form label.
pub fn clean_label(s: &str, max_chars: usize) -> String {
    s.trim().chars().filter(|c| !c.is_control()).take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validators() {
        assert!(is_safe_id("abc-DEF_09"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id(""));
        assert!(is_sealed("v1.AbC-_9", 100));
        assert!(!is_sealed("v2.AbC", 100));
        assert!(!is_sealed("v1.a+b", 100));
        assert_eq!(clean_label("  hé\nllo  ", 3), "hél");
    }
}
