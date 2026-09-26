use std::path::Path;
use std::process::Stdio;

use base64::Engine;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq)]
pub enum BridgeEvent {
    Frame {
        seq: u64,
        width: u16,
        height: u16,
        full: bool,
        bytes: Vec<u8>,
    },
    Closed(String),
}

#[derive(Debug)]
pub enum ScrollDir {
    Up,
    Down,
}

enum BridgeCommand {
    InputText(String),
    InputBytes(Vec<u8>),
    Resize(u16, u16),
    Scroll(ScrollDir, u16),
    Release,
}

#[derive(Clone)]
pub struct Bridge {
    input_tx: mpsc::UnboundedSender<BridgeCommand>,
}

pub fn spawn_bridge(
    exe: &Path,
    session: Option<&str>,
    pane_id: &str,
    cols: u16,
    rows: u16,
) -> std::io::Result<(Bridge, mpsc::UnboundedReceiver<BridgeEvent>)> {
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<BridgeCommand>();

    let mut cmd = tokio::process::Command::new(exe);
    if let Some(name) = session {
        cmd.args(["--session", name]);
    }
    cmd.args([
        "terminal",
        "session",
        "control",
        pane_id,
        "--takeover",
        "--cols",
        &cols.to_string(),
        "--rows",
        &rows.to_string(),
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true)
    .creation_flags(CREATE_NO_WINDOW);
    for (key, _) in std::env::vars() {
        if key.starts_with("HERDR_") {
            cmd.env_remove(key);
        }
    }

    let mut child = cmd.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("bridge sin stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("bridge sin stderr"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("bridge sin stdin"))?;

    // stdout → BridgeEvent
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut saw_closed = false;
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            match parse_frame_line(line.trim_end()) {
                Some(event) => {
                    if matches!(event, BridgeEvent::Closed(_)) {
                        saw_closed = true;
                    }
                    if event_tx.send(event).is_err() {
                        return;
                    }
                }
                None => {
                    tracing::debug!("bridge stdout no-parseable: {}", truncate(line.trim_end()));
                }
            }
        }
        if !saw_closed {
            let _ = event_tx.send(BridgeEvent::Closed("bridge_exit".to_string()));
        }
    });

    // stderr → log
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => return,
                Ok(_) => {
                    tracing::warn!("bridge stderr: {}", line.trim_end());
                }
            }
        }
    });

    // input loop
    tokio::spawn(async move {
        loop {
            let Some(command) = input_rx.recv().await else {
                break;
            };
            let is_release = matches!(command, BridgeCommand::Release);
            let json_line = match command {
                BridgeCommand::InputText(text) => {
                    serde_json::json!({"type": "terminal.input", "text": text}).to_string()
                }
                BridgeCommand::InputBytes(bytes) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                    serde_json::json!({"type": "terminal.input", "bytes": b64}).to_string()
                }
                BridgeCommand::Resize(cols, rows) => {
                    serde_json::json!({"type": "terminal.resize", "cols": cols, "rows": rows})
                        .to_string()
                }
                BridgeCommand::Scroll(dir, lines) => {
                    let direction = match dir {
                        ScrollDir::Up => "up",
                        ScrollDir::Down => "down",
                    };
                    serde_json::json!({"type": "terminal.scroll", "direction": direction, "lines": lines})
                        .to_string()
                }
                BridgeCommand::Release => {
                    serde_json::json!({"type": "terminal.release"}).to_string()
                }
            };
            let mut payload = json_line;
            payload.push('\n');
            if stdin.write_all(payload.as_bytes()).await.is_err() {
                break;
            }
            if stdin.flush().await.is_err() {
                break;
            }
            if is_release {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                let _ = child.kill().await;
                break;
            }
        }
    });

    Ok((Bridge { input_tx }, event_rx))
}

impl Bridge {
    pub fn input_text(&self, text: &str) {
        let _ = self
            .input_tx
            .send(BridgeCommand::InputText(text.to_string()));
    }

    pub fn input_bytes(&self, bytes: &[u8]) {
        let _ = self
            .input_tx
            .send(BridgeCommand::InputBytes(bytes.to_vec()));
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.input_tx.send(BridgeCommand::Resize(cols, rows));
    }

    pub fn scroll(&self, dir: ScrollDir, lines: u16) {
        let _ = self.input_tx.send(BridgeCommand::Scroll(dir, lines));
    }

    pub fn release(&self) {
        let _ = self.input_tx.send(BridgeCommand::Release);
    }
}

pub fn parse_frame_line(line: &str) -> Option<BridgeEvent> {
    let v: Value = serde_json::from_str(line).ok()?;
    match v.get("type").and_then(Value::as_str)? {
        "terminal.frame" => {
            let bytes_b64 = v.get("bytes").and_then(Value::as_str)?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64)
                .ok()?;
            Some(BridgeEvent::Frame {
                seq: v.get("seq").and_then(Value::as_u64).unwrap_or(0),
                width: v.get("width").and_then(Value::as_u64).unwrap_or(0) as u16,
                height: v.get("height").and_then(Value::as_u64).unwrap_or(0) as u16,
                full: v.get("full").and_then(Value::as_bool).unwrap_or(false),
                bytes,
            })
        }
        "terminal.closed" => Some(BridgeEvent::Closed(
            v.get("reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
        )),
        _ => None,
    }
}

fn truncate(s: &str) -> &str {
    &s[..s.len().min(200)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frame_line_from_fixture() {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let path =
            std::path::Path::new(manifest).join("../../schema/fixtures/terminal_frame.ndjson");
        let raw = std::fs::read_to_string(path).expect("fixture");
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match parse_frame_line(line) {
                Some(BridgeEvent::Frame {
                    seq,
                    width,
                    height,
                    full,
                    bytes,
                }) => {
                    assert!(seq > 0);
                    assert_eq!(width, 80);
                    assert_eq!(height, 25);
                    assert!(full);
                    assert!(!bytes.is_empty());
                }
                Some(BridgeEvent::Closed(reason)) => {
                    assert_eq!(reason, "detached");
                }
                None => panic!("linea de fixture no-parseable"),
            }
        }
    }
}
