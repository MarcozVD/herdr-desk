#![cfg(feature = "sandbox")]

use std::os::windows::process::CommandExt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use herdr_core::events;
use herdr_core::model::SessionSnapshot;
use herdr_core::terminal::spawn_bridge;
use serde_json::json;

mod common;

use common::Sandbox;

/// R5: costo por bridge — primer frame y RAM incremental por proceso, con 1, 4 y 8 panes.
#[tokio::test]
async fn r5_bridge_cost() {
    let sb = Sandbox::start();
    common::wait_session_running(&sb.name).await;
    let client = Arc::new(sb.ensure_pane().await);

    // 8 panes via splits
    let raw = client.snapshot_raw().await.expect("snapshot");
    let mut snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let mut pane = snap.focused_pane_id.clone().expect("focused pane");
    while snap.panes.len() < 8 {
        client
            .call(
                "pane.split",
                &json!({"direction": "down", "target_pane_id": pane}),
            )
            .await
            .expect("split");
        let r = client.snapshot_raw().await.expect("snapshot");
        snap = serde_json::from_str(&r).expect("parse");
        pane = snap
            .focused_pane_id
            .clone()
            .unwrap_or_else(|| snap.panes[0].pane_id.clone());
    }
    let panes: Vec<String> = snap.panes.iter().map(|p| p.pane_id.clone()).collect();
    assert!(panes.len() >= 8, "no se llego a 8 panes");

    // pids de procesos herdr PREVIOS a los bridges (el server sandbox)
    let server_pids = herdr_pids();
    assert!(!server_pids.is_empty(), "no encontre el server herdr");

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let mut bridges: Vec<herdr_core::terminal::Bridge> = Vec::new();
    let mut report: Vec<String> = Vec::new();

    for target in [1usize, 4, 8] {
        let mut first_frames: Vec<f64> = Vec::new();
        while bridges.len() < target {
            let p = panes[bridges.len()].clone();
            let t0 = Instant::now();
            let (bridge, mut events) =
                spawn_bridge(&exe, Some(&sb.name), &p, 100, 30).expect("bridge");
            loop {
                let ev = tokio::time::timeout(Duration::from_secs(10), events.recv())
                    .await
                    .expect("frame")
                    .expect("canal");
                if matches!(
                    ev,
                    herdr_core::terminal::BridgeEvent::Frame { full: true, .. }
                ) {
                    break;
                }
            }
            first_frames.push(t0.elapsed().as_millis() as f64);
            bridges.push(bridge);
        }
        std::thread::sleep(Duration::from_millis(600));
        let ram_total = ram_of(herdr_pids());
        let ram_server = ram_of(server_pids.clone());
        let ram_bridges = (ram_total - ram_server).max(0.0) / bridges.len() as f64;
        let avg_first = first_frames.iter().sum::<f64>() / first_frames.len() as f64;
        report.push(format!(
            "{} bridges: primer_frame_avg={avg_first:.0}ms ram/bridge={ram_bridges:.1}MB",
            bridges.len()
        ));
    }

    for r in &report {
        println!("R5: {r}");
    }
    for b in &bridges {
        b.release();
    }

    assert!(true);
}

fn herdr_pids() -> Vec<u32> {
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-Process herdr -ErrorAction SilentlyContinue).Id",
        ])
        .creation_flags(common::CREATE_NO_WINDOW)
        .output()
        .expect("powershell");
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .filter_map(|s| s.parse::<u32>().ok())
        .collect()
}

fn ram_of(pids: Vec<u32>) -> f64 {
    if pids.is_empty() {
        return 0.0;
    }
    let list = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-Process -Id {list} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum"),
        ])
        .creation_flags(common::CREATE_NO_WINDOW)
        .output()
        .expect("powershell");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .replace(",", "")
        .parse::<f64>()
        .map(|b| b / 1_048_576.0)
        .unwrap_or(0.0)
}

async fn first_full_frame(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<herdr_core::terminal::BridgeEvent>,
) {
    let deadline = Instant::now() + common::MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "sin frame inicial");
        let ev = tokio::time::timeout(common::MAX_WAIT, events.recv())
            .await
            .expect("esperando frame")
            .expect("canal vivo");
        if matches!(
            ev,
            herdr_core::terminal::BridgeEvent::Frame { full: true, .. }
        ) {
            return;
        }
    }
}

/// Extrae el par (columns, lines) del output de `mode con` (formato español e inglés,
/// cualquier orden de campos; toma el último match — el del intento más reciente).
fn console_sizes(acc: &str) -> Vec<(u32, u32)> {
    let plain = strip_ansi(acc);
    let col = ["Columnas:", "Columns:", "Columns="]
        .iter()
        .find_map(|l| number_after(l, &plain));
    let line = ["Líneas:", "Lineas:", "Lines:", "Lines="]
        .iter()
        .find_map(|l| number_after(l, &plain));
    match (col, line) {
        (Some(c), Some(l)) => vec![(c, l)],
        _ => vec![],
    }
}

fn number_after(label: &str, plain: &str) -> Option<u32> {
    let i = plain.rfind(label)?;
    let rest = &plain[i + label.len()..];
    let digits: String = rest
        .trim_start_matches(|c: char| c == ':' || c == '=' || c == ' ' || c == '\t')
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<u32>().ok()
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    for c2 in chars.by_ref() {
                        if c2.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    let mut prev = '\0';
                    for c2 in chars.by_ref() {
                        if c2 == '\x07' || (prev == '\x1b' && c2 == '\\') {
                            break;
                        }
                        prev = c2;
                    }
                }
                _ => {}
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// R1: terminal.resize debe redimensionar el PTY real.
#[tokio::test]
async fn r1_resize_semantics() {
    let sb = Sandbox::start();
    common::wait_session_running(&sb.name).await;
    let client = sb.ensure_pane().await;
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (bridge, mut events) = spawn_bridge(&exe, Some(&sb.name), &pane, 80, 25).expect("bridge");
    first_full_frame(&mut events).await;

    // actividad: eco de marcador (con reintento: inputs tempranos pueden perderse)
    let mut echoed = false;
    for _ in 0..3 {
        bridge.input_text("zqxj");
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_secs(2), events.recv()).await {
                Ok(Some(herdr_core::terminal::BridgeEvent::Frame { bytes, .. })) => {
                    if String::from_utf8_lossy(&bytes).contains("zqxj") {
                        echoed = true;
                        break;
                    }
                }
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => break,
            }
        }
        if echoed {
            break;
        }
    }
    assert!(echoed, "el shell no ecoeo el marcador");

    // el resize del controller debe reflejarse en el frame (90x20): eso prueba
    // que herdr redimensiona el PTY real. El shell idle puede no redibujar:
    // cada timeout mandamos otro marcador para forzar el redraw.
    bridge.resize(90, 20);
    let mut resized_frame = false;
    let deadline = Instant::now() + common::MAX_WAIT;
    let mut last_kick = Instant::now();
    while Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), events.recv()).await {
            Ok(Some(herdr_core::terminal::BridgeEvent::Frame { width, height, .. })) => {
                if width == 90 && height == 20 {
                    resized_frame = true;
                    break;
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => {}
        }
        if last_kick.elapsed() > Duration::from_secs(2) {
            bridge.input_text(" ");
            last_kick = Instant::now();
        }
    }
    assert!(resized_frame, "el PTY no se redimensiono a 90x20");

    // confirmación del lado del shell: pedimos el tamaño y esperamos el output
    // (reintentos: el server preview a veces descarta el primer input tras un idle)
    let mut acc = String::new();
    let mut seen_after: Vec<(u32, u32)> = Vec::new();
    for _ in 0..3 {
        bridge.input_text("mode con\r");
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut got = false;
        while Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_secs(3), events.recv()).await {
                Ok(Some(herdr_core::terminal::BridgeEvent::Frame { bytes, .. })) => {
                    acc.push_str(&String::from_utf8_lossy(&bytes));
                    seen_after = console_sizes(&acc);
                    if seen_after.last() == Some(&(90, 20)) {
                        got = true;
                        break;
                    }
                }
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => break,
            }
        }
        if got {
            break;
        }
    }
    println!("R1: tamaños vistos post-resize: {seen_after:?}");
    println!(
        "R1: texto plano (tail): {:?}",
        strip_ansi(&acc)
            .lines()
            .filter(|l| !l.trim().is_empty())
            .rev()
            .take(10)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        seen_after.last(),
        Some(&(90, 20)),
        "el shell no confirmo el resize"
    );
    println!(
        "R1: PTY resize OK (80x25 -> 90x20 confirmado por frames del server y shell). Convivencia con TUI: requiere confirmacion humana."
    );
    bridge.release();
}

/// R7: flood 1..200000 | % { $_ } — frames/s, sin events_lost.
#[tokio::test]
async fn r7_flood() {
    let sb = Sandbox::start();
    common::wait_session_running(&sb.name).await;
    let client = Arc::new(sb.ensure_pane().await);
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(1024);
    let kick = Arc::new(tokio::sync::Notify::new());
    tokio::spawn(events::run(sb.pipe(), ev_tx, kick));

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (bridge, mut events) = spawn_bridge(&exe, Some(&sb.name), &pane, 120, 40).expect("bridge");
    first_full_frame(&mut events).await;

    bridge.input_text("1..200000 | % { $_ }\r");

    let window = Duration::from_secs(8);
    let start = Instant::now();
    let mut frame_count: u64 = 0;
    let mut bytes_total: u64 = 0;
    let mut events_received: u64 = 0;
    let mut events_lost_seen = false;
    while start.elapsed() < window {
        match tokio::time::timeout(Duration::from_millis(200), events.recv()).await {
            Ok(Some(herdr_core::terminal::BridgeEvent::Frame { bytes, .. })) => {
                frame_count += 1;
                bytes_total += bytes.len() as u64;
            }
            Ok(Some(herdr_core::terminal::BridgeEvent::Closed(reason))) => {
                panic!("bridge cerro durante flood: {reason}");
            }
            Ok(None) => panic!("canal de frames cerro"),
            Err(_) => {}
        }
        loop {
            match ev_rx.try_recv() {
                Ok(ev) => {
                    events_received += 1;
                    if ev.event == "events.lost" {
                        events_lost_seen = true;
                    }
                }
                Err(_) => break,
            }
        }
    }
    let fps = frame_count as f64 / window.as_secs_f64();
    bridge.release();

    let ping_ok = client.call("ping", &json!({})).await.is_ok();

    println!(
        "R7: frames/s={fps:.1} total_frames={frame_count} bytes={bytes_total} eventos_L={events_received} events_lost={events_lost_seen} ping_post_flood={ping_ok}"
    );
    assert!(fps > 0.0, "sin frames durante el flood");
    assert!(!events_lost_seen, "llego events_lost durante el flood");
    assert!(ping_ok, "el server no responde tras el flood");
}

/// R10: takeover doble — el primer bridge recibe terminal.closed.
#[tokio::test]
async fn r10_double_takeover() {
    let sb = Sandbox::start();
    common::wait_session_running(&sb.name).await;
    let client = sb.ensure_pane().await;
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (bridge_a, mut events_a) =
        spawn_bridge(&exe, Some(&sb.name), &pane, 80, 25).expect("bridge A");
    first_full_frame(&mut events_a).await;

    let (_bridge_b, mut events_b) =
        spawn_bridge(&exe, Some(&sb.name), &pane, 80, 25).expect("bridge B");

    let mut a_closed: Option<String> = None;
    let deadline = Instant::now() + common::MAX_WAIT;
    while a_closed.is_none() {
        assert!(
            Instant::now() < deadline,
            "A no recibio closed tras el takeover"
        );
        let ev = tokio::time::timeout(Duration::from_secs(5), events_a.recv())
            .await
            .expect("esperando closed en A")
            .expect("canal vivo");
        if let herdr_core::terminal::BridgeEvent::Closed(reason) = ev {
            a_closed = Some(reason);
        }
    }

    // B sigue vivo: eco
    _bridge_b.input_text("echo listo\r");
    let mut b_alive = false;
    let deadline = Instant::now() + Duration::from_secs(5);
    while !b_alive && Instant::now() < deadline {
        let ev = tokio::time::timeout(Duration::from_secs(2), events_b.recv()).await;
        if let Ok(Some(herdr_core::terminal::BridgeEvent::Frame { bytes, .. })) = ev {
            if String::from_utf8_lossy(&bytes).contains("listo") {
                b_alive = true;
            }
        }
    }
    bridge_a.release();
    println!(
        "R10: takeover doble OK. bridge A cerrado con reason={a_closed:?}; bridge B sigue operativo={b_alive}"
    );
    assert!(b_alive, "el bridge ganador no recibe input");
}

/// R12: pane.report_agent state=working — que evento llega por L?
#[tokio::test]
async fn r12_agent_status_events() {
    let sb = Sandbox::start();
    common::wait_session_running(&sb.name).await;
    let client = Arc::new(sb.ensure_pane().await);
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(256);
    let kick = Arc::new(tokio::sync::Notify::new());
    tokio::spawn(events::run(sb.pipe(), ev_tx, kick));

    client
        .call(
            "pane.report_agent",
            &json!({"pane_id": pane, "source": "custom:hd-test", "agent": "hd-bot", "state": "working"}),
        )
        .await
        .expect("report_agent working");

    let mut seen: Vec<String> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(300), ev_rx.recv()).await {
            Ok(Some(ev)) => {
                if !seen.contains(&ev.event) {
                    seen.push(ev.event.clone());
                }
                if ev.event == "pane.agent_status_changed" {
                    break;
                }
            }
            _ => break,
        }
    }
    println!("R12 (working): eventos por L = {seen:?}");

    client
        .call(
            "pane.release_agent",
            &json!({"pane_id": pane, "agent": "hd-bot", "source": "custom:hd-test"}),
        )
        .await
        .expect("release_agent");

    let mut seen_after: Vec<String> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(300), ev_rx.recv()).await {
            Ok(Some(ev)) => {
                if !seen_after.contains(&ev.event) {
                    seen_after.push(ev.event.clone());
                }
            }
            _ => break,
        }
    }
    println!("R12 (release): eventos por L = {seen_after:?}");
    assert!(
        !seen.is_empty() || !seen_after.is_empty(),
        "report_agent/release_agent no genero ningun evento por L"
    );
}
