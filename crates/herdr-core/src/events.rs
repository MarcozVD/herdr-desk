use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::error::HerdrError;
use crate::model::EventEnvelope;

/// The 24 global subscription types accepted by herdr 0.8.0-preview (protocol 19),
/// verified against the running server. The 3 pane-scoped types
/// (`pane.output_matched`, `pane.agent_status_changed`, `pane.scroll_changed`)
/// require `pane_id` and are handled separately.
pub const GLOBAL_EVENT_TYPES: [&str; 24] = [
    "workspace.created",
    "workspace.updated",
    "workspace.metadata_updated",
    "workspace.renamed",
    "workspace.moved",
    "workspace.reordered",
    "workspace.closed",
    "workspace.focused",
    "worktree.created",
    "worktree.opened",
    "worktree.removed",
    "tab.created",
    "tab.closed",
    "tab.focused",
    "tab.renamed",
    "tab.moved",
    "pane.created",
    "pane.closed",
    "pane.updated",
    "pane.focused",
    "pane.moved",
    "pane.exited",
    "pane.agent_detected",
    "layout.updated",
];

pub type EventTx = mpsc::Sender<EventEnvelope>;

/// Conexión S: suscripción pane-scoped (`pane.agent_status_changed`) para un conjunto
/// de panes. El caller hace make-before-break: abre la nueva con `open_pane_subscription`
/// y cierra la vieja con `PaneSubscription::close`.
pub struct PaneSubscription {
    pub rx: mpsc::UnboundedReceiver<EventEnvelope>,
    pub close: tokio::sync::oneshot::Sender<()>,
}

impl PaneSubscription {
    pub fn close(self) {
        let _ = self.close.send(());
    }
}

pub async fn open_pane_subscription(
    pipe: String,
    panes: Vec<String>,
) -> Result<PaneSubscription, HerdrError> {
    let subs: Vec<Value> = panes
        .iter()
        .map(|p| json!({"type": "pane.agent_status_changed", "pane_id": p}))
        .collect();
    open_subscription(pipe, subs).await
}

/// T4.5 — Suscripción temporal a tipos globales elegidos (24 disponibles). La usa
/// el visor de eventos de la consola API; se cierra al soltar el `close`/`rx`.
pub async fn open_event_subscription(
    pipe: String,
    types: Vec<String>,
) -> Result<PaneSubscription, HerdrError> {
    let subs: Vec<Value> = types.iter().map(|t| json!({"type": t})).collect();
    open_subscription(pipe, subs).await
}

async fn open_subscription(pipe: String, subs: Vec<Value>) -> Result<PaneSubscription, HerdrError> {
    let stream = crate::transport::open(&pipe).await?;
    let mut writer = stream;

    let request = json!({"id": "hd-pane-events", "method": "events.subscribe", "params": {"subscriptions": subs}});
    let mut line = serde_json::to_string(&request).map_err(|e| HerdrError::Parse(e.to_string()))?;
    line.push('\n');
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await?;

    let mut reader = BufReader::new(writer);
    let mut first = String::new();
    reader.read_line(&mut first).await?;
    if first.contains("\"error\"") {
        return Err(HerdrError::Api {
            code: "invalid_request".to_string(),
            message: first.trim().to_string(),
        });
    }

    let (tx, rx) = mpsc::unbounded_channel();
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let mut buf = String::new();
        loop {
            tokio::select! {
                read = reader.read_line(&mut buf) => {
                    match read {
                        Ok(0) | Err(_) => return,
                        Ok(_) => {}
                    }
                    if buf.contains("events_lost") {
                        return;
                    }
                    if let Ok(mut ev) =
                        serde_json::from_str::<EventEnvelope>(buf.trim_end())
                    {
                        ev.event = normalize_event_type(&ev.event);
                        buf.clear();
                        if tx.send(ev).is_err() {
                            return;
                        }
                        continue;
                    }
                    buf.clear();
                }
                _ = &mut close_rx => {
                    return;
                }
            }
        }
    });

    Ok(PaneSubscription {
        rx,
        close: close_tx,
    })
}

/// herdr accepts dotted types when subscribing (`workspace.created`) but emits
/// snake_case on the wire (`workspace_created`). Normalize to the dotted form
/// used across herdr-desk.
pub fn normalize_event_type(event: &str) -> String {
    match event.split_once('_') {
        Some((head, tail))
            if matches!(head, "workspace" | "worktree" | "tab" | "pane" | "layout") =>
        {
            format!("{head}.{tail}")
        }
        _ => event.to_string(),
    }
}

/// Resubscribes forever with backoff (250 ms → 5 s). Kicks the store after every
/// resubscription so the snapshot reconciles.
pub async fn run(pipe: String, tx: EventTx, kick: Arc<tokio::sync::Notify>) {
    let connect = move || {
        let pipe = pipe.clone();
        async move {
            crate::transport::open(&pipe)
                .await
                .map_err(|e| std::io::Error::other(e.to_string()))
        }
    };
    run_with(connect, tx, kick, Duration::from_millis(250)).await;
}

/// Generic event loop so tests can inject a fake transport.
pub async fn run_with<C, Fut, S>(
    connect: C,
    tx: EventTx,
    kick: Arc<tokio::sync::Notify>,
    base_backoff: Duration,
) where
    C: Fn() -> Fut,
    Fut: std::future::Future<Output = std::io::Result<S>>,
    S: AsyncRead + AsyncWrite + Unpin + Send,
{
    let mut backoff = base_backoff;
    loop {
        match connect().await {
            Ok(stream) => {
                let saw_event = match subscribe_once(stream, &tx, &kick).await {
                    Ok(saw) => saw,
                    Err(err) => {
                        tracing::warn!("suscripcion de eventos fallo: {err}");
                        false
                    }
                };
                // resubscripcion: el snapshot debe reconciliar de inmediato
                kick.notify_one();
                if saw_event {
                    backoff = base_backoff;
                }
            }
            Err(err) => {
                tracing::warn!("no se pudo abrir conexion de eventos: {err}");
                kick.notify_one();
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(5));
    }
}

/// Sends the subscription request, then forwards events until EOF or `events_lost`.
/// Kicks the store refresher por cada evento reenviado: el snapshot vivo depende de
/// esto (sin kick por evento la UI se congela mientras la conexion L este viva).
/// El store coalescela (30 ms + drain), asi que una rafaga N no genera N refrescos.
/// Returns true if at least one real event was seen.
async fn subscribe_once<S>(
    stream: S,
    tx: &EventTx,
    kick: &tokio::sync::Notify,
) -> Result<bool, HerdrError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut writer = stream;
    let subs: Vec<Value> = GLOBAL_EVENT_TYPES
        .iter()
        .map(|t| json!({"type": t}))
        .collect();
    let request =
        json!({"id": "hd-events", "method": "events.subscribe", "params": {"subscriptions": subs}});
    let mut line = serde_json::to_string(&request).map_err(|e| HerdrError::Parse(e.to_string()))?;
    line.push('\n');
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await?;

    let mut reader = BufReader::new(writer);
    let mut first = String::new();
    reader.read_line(&mut first).await?;
    if first.contains("\"error\"") {
        return Err(HerdrError::Api {
            code: "invalid_request".to_string(),
            message: first.trim().to_string(),
        });
    }

    let mut saw_event = false;
    let mut buf = String::new();
    loop {
        buf.clear();
        let n = reader.read_line(&mut buf).await?;
        if n == 0 {
            return Ok(saw_event);
        }
        if buf.contains("events_lost") {
            tracing::warn!("events_lost en L: resuscribiendo");
            return Ok(saw_event);
        }
        match serde_json::from_str::<EventEnvelope>(buf.trim_end()) {
            Ok(mut ev) => {
                ev.event = normalize_event_type(&ev.event);
                saw_event = true;
                if tx.send(ev).await.is_err() {
                    return Ok(saw_event);
                }
                // cada evento invalida el snapshot: el store coalescela
                kick.notify_one();
            }
            Err(err) => {
                tracing::debug!("linea no-parseable en L: {err}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{BoxFut, SnapshotRaw, SnapshotSource};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::duplex;

    /// Snapshot source fake: cuenta refrescos y refleja el ultimo evento recibido.
    struct CountingSource {
        calls: Arc<AtomicUsize>,
        latest: Arc<AtomicUsize>,
    }

    impl SnapshotSource for CountingSource {
        fn fetch(&self) -> BoxFut<Result<SnapshotRaw, HerdrError>> {
            let calls = self.calls.clone();
            let latest = self.latest.clone();
            Box::pin(async move {
                let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                let last = latest.load(Ordering::SeqCst);
                let raw = format!("{{\"pane_id\":\"p{last}\",\"n\":{n}}}");
                Ok(SnapshotRaw::from(raw.as_str()))
            })
        }
    }

    /// Transport fake: envia `count` eventos y deja la conexion viva.
    fn feed_events(
        count: usize,
        latest: Arc<AtomicUsize>,
        pause: Duration,
    ) -> impl Fn() -> std::pin::Pin<
        Box<dyn std::future::Future<Output = std::io::Result<tokio::io::DuplexStream>> + Send>,
    > {
        move || {
            let latest = latest.clone();
            Box::pin(async move {
                let (client, mut server) = duplex(64 * 1024);
                tokio::spawn(async move {
                    let _ = server
                        .write_all(
                            b"{\"id\":\"hd-events\",\"result\":{\"type\":\"subscription_started\"}}\n",
                        )
                        .await;
                    for n in 1..=count {
                        if pause > Duration::ZERO {
                            tokio::time::sleep(pause).await;
                        }
                        latest.store(n, Ordering::SeqCst);
                        let line = format!(
                            "{{\"event\":\"pane.created\",\"data\":{{\"pane_id\":\"p{n}\"}}}}\n"
                        );
                        if server.write_all(line.as_bytes()).await.is_err() {
                            return;
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(5)).await;
                });
                Ok(client)
            })
        }
    }

    async fn wait_for_snapshot(store: &crate::store::Store, needle: &str, what: &str) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if store.snapshot().contains(needle) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!(
                "{what}: el store no se refresco (snapshot={})",
                store.snapshot()
            )
        });
    }

    #[tokio::test]
    async fn events_lost_triggers_resubscribe() {
        let (tx, mut rx) = mpsc::channel::<EventEnvelope>(64);
        let kick = Arc::new(tokio::sync::Notify::new());
        let connections = Arc::new(AtomicUsize::new(0));

        let conns = connections.clone();
        let connect = move || {
            let conns = conns.clone();
            async move {
                let n = conns.fetch_add(1, Ordering::SeqCst) + 1;
                let (client, mut server) = duplex(64 * 1024);
                tokio::spawn(async move {
                    if n == 1 {
                        let _ = server
                            .write_all(
                                b"{\"id\":\"hd-events\",\"result\":{\"type\":\"subscription_started\"}}\n",
                            )
                            .await;
                        let _ = server
                            .write_all(b"{\"event\":\"events_lost\",\"data\":{}}\n")
                            .await;
                    } else {
                        let _ = server
                            .write_all(
                                b"{\"id\":\"hd-events\",\"result\":{\"type\":\"subscription_started\"}}\n",
                            )
                            .await;
                        let _ = server
                            .write_all(
                                b"{\"event\":\"pane.created\",\"data\":{\"pane_id\":\"p2\"}}\n",
                            )
                            .await;
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                });
                Ok(client)
            }
        };

        tokio::spawn(run_with(connect, tx, kick, Duration::from_millis(20)));

        let ev = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("evento tras resubscribir")
            .expect("canal vivo");
        assert_eq!(ev.event, "pane.created");
        assert_eq!(ev.data["pane_id"], "p2");
        let n = connections.load(Ordering::SeqCst);
        assert!(n >= 2, "debio resuscribir tras events_lost, conexiones={n}");
    }

    /// Regresion del congelamiento de la UI: sin kick por evento el store solo
    /// refresca en el bootstrap y el snapshot nunca refleja lo que llega por L.
    #[tokio::test]
    async fn cada_evento_refresca_el_snapshot() {
        let (tx, mut rx) = mpsc::channel::<EventEnvelope>(64);
        let latest = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(AtomicUsize::new(0));
        let store = crate::store::Store::spawn(CountingSource {
            calls: calls.clone(),
            latest: latest.clone(),
        });
        // el lazo de eventos debe patear el mismo Notify que consume el refresher
        let kick = store.kick_handle();

        let connect = feed_events(3, latest.clone(), Duration::from_millis(5));
        tokio::spawn(run_with(connect, tx, kick, Duration::from_millis(20)));

        let mut last = None;
        for _ in 0..3 {
            let ev = tokio::time::timeout(Duration::from_secs(3), rx.recv())
                .await
                .expect("evento antes de 3s")
                .expect("canal vivo");
            assert_eq!(ev.event, "pane.created");
            last = Some(ev);
        }
        assert_eq!(last.expect("evento").data["pane_id"], "p3");

        wait_for_snapshot(&store, "p3", "cada evento actualiza el snapshot").await;
        let refreshes = calls.load(Ordering::SeqCst);
        assert!(
            refreshes >= 2,
            "con 3 eventos debe refrescar mas alla del bootstrap, hubo {refreshes}"
        );
        store.close();
    }

    /// La rafaga no puede generar un refresco por evento: la coalescencia del
    /// store (30 ms + drain) la absorbe.
    #[tokio::test]
    async fn rafaga_de_50_eventos_coalesce_en_pocos_refrescos() {
        let (tx, mut rx) = mpsc::channel::<EventEnvelope>(128);
        let latest = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(AtomicUsize::new(0));
        let store = crate::store::Store::spawn(CountingSource {
            calls: calls.clone(),
            latest: latest.clone(),
        });
        let kick = store.kick_handle();

        let connect = feed_events(50, latest.clone(), Duration::ZERO);
        tokio::spawn(run_with(connect, tx, kick, Duration::from_millis(20)));

        for i in 1..=50 {
            let ev = tokio::time::timeout(Duration::from_secs(5), rx.recv())
                .await
                .unwrap_or_else(|_| panic!("evento {i} no llego"))
                .expect("canal vivo");
            assert_eq!(ev.data["pane_id"], format!("p{i}"));
        }

        wait_for_snapshot(&store, "p50", "la rafaga alcanza el snapshot final").await;
        tokio::time::sleep(Duration::from_millis(150)).await;
        let refreshes = calls.load(Ordering::SeqCst);
        eprintln!("rafaga de 50 eventos -> {refreshes} refrescos del store");
        assert!(
            refreshes <= 5,
            "50 eventos no deben generar 50 refrescos, hubo {refreshes}"
        );
        assert!(refreshes >= 2, "debe haber refresco, hubo {refreshes}");
        store.close();
    }
}
