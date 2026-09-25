#![cfg(feature = "sandbox")]

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use std::os::windows::process::CommandExt;

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const DETACHED_PROCESS: u32 = 0x0000_0008;
pub const MAX_WAIT: Duration = Duration::from_secs(10);

static TEST_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub struct Sandbox {
    pub name: String,
}

impl Sandbox {
    pub fn start() -> Self {
        let name = format!(
            "hd-test-{}-{}",
            std::process::id(),
            TEST_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        );
        let _ = Command::new("herdr")
            .args(["session", "stop", &name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("herdr")
            .args(["session", "delete", &name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        Command::new("herdr")
            .args(["--session", &name, "server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS)
            .spawn()
            .expect("spawn herdr server");

        let deadline = Instant::now() + MAX_WAIT;
        loop {
            if Instant::now() > deadline {
                panic!("sandbox {name} no arranco en {MAX_WAIT:?}");
            }
            let list = herdr_core::cli::session_list().expect("session list");
            if list.sessions.iter().any(|s| s.name == name && s.running) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Self { name }
    }

    pub fn pipe(&self) -> String {
        let socket = herdr_core::paths::session_socket(&self.name);
        herdr_core::paths::pipe_name(&socket)
    }

    pub fn client(&self) -> herdr_core::RpcClient {
        herdr_core::RpcClient::new(self.pipe())
    }

    pub async fn ensure_pane(&self) -> herdr_core::RpcClient {
        let client = self.client();
        let _ = client
            .call(
                "workspace.create",
                &serde_json::json!({"cwd": env!("CARGO_MANIFEST_DIR"), "label": "hd-test", "focus": true}),
            )
            .await
            .expect("workspace.create");
        client
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = Command::new("herdr")
            .args(["session", "stop", &self.name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("herdr")
            .args(["session", "delete", &self.name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

pub async fn wait_session_running(name: &str) {
    let deadline = Instant::now() + MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "server de {name} no quedo listo");
        match herdr_core::cli::session_list() {
            Ok(list) if list.sessions.iter().any(|s| s.name == name && s.running) => return,
            _ => tokio::time::sleep(Duration::from_millis(200)).await,
        }
    }
}
