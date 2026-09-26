use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

pub type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send>>;
pub type SnapshotRaw = Arc<str>;

pub trait SnapshotSource: Send + Sync + 'static {
    fn fetch(&self) -> BoxFut<Result<SnapshotRaw, crate::error::HerdrError>>;
}

pub struct Store {
    tx: tokio::sync::watch::Sender<SnapshotRaw>,
    rx: tokio::sync::watch::Receiver<SnapshotRaw>,
    kick: std::sync::Arc<tokio::sync::Notify>,
    closed: Arc<AtomicBool>,
    close_notify: Arc<tokio::sync::Notify>,
}

impl Default for Store {
    fn default() -> Self {
        Self::new()
    }
}

impl Store {
    /// Creates the store without spawning anything, for hosts that manage their own runtime.
    pub fn new() -> Self {
        let (tx, rx) = tokio::sync::watch::channel(SnapshotRaw::from("{}"));
        Self {
            tx,
            rx,
            kick: Arc::new(tokio::sync::Notify::new()),
            closed: Arc::new(AtomicBool::new(false)),
            close_notify: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Spawns the refresher task: at most one in-flight refresh; extra kicks coalesce.
    pub fn spawn<S: SnapshotSource>(source: S) -> Self {
        let store = Self::new();
        let task = store.refresher_task(source);
        tokio::spawn(task);
        store
    }

    /// The refresher future, for hosts that spawn tasks themselves (e.g. tauri).
    pub fn refresher_task<S: SnapshotSource>(
        &self,
        source: S,
    ) -> impl Future<Output = ()> + Send + 'static {
        refresher(
            source,
            self.tx.clone(),
            self.kick.clone(),
            self.closed.clone(),
            self.close_notify.clone(),
        )
    }

    /// Cierra el store: el refresher termina y deja de publicar (usado al cambiar
    /// de sesion para que el store viejo no haga IO ni pise snapshots nuevos).
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.close_notify.notify_waiters();
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    pub fn snapshot(&self) -> SnapshotRaw {
        self.rx.borrow().clone()
    }

    pub fn watch(&self) -> tokio::sync::watch::Receiver<SnapshotRaw> {
        self.rx.clone()
    }

    pub fn kick(&self) {
        self.kick.notify_one();
    }

    pub fn kick_handle(&self) -> std::sync::Arc<tokio::sync::Notify> {
        self.kick.clone()
    }
}

async fn refresher<S: SnapshotSource>(
    source: S,
    tx: tokio::sync::watch::Sender<SnapshotRaw>,
    kick: std::sync::Arc<tokio::sync::Notify>,
    closed: Arc<AtomicBool>,
    close_notify: Arc<tokio::sync::Notify>,
) {
    loop {
        if closed.load(Ordering::SeqCst) {
            return;
        }
        // bootstrap: primer refresh sin esperar kicks (sin eventos no habria snapshot)
        let fetched = tokio::select! {
            result = source.fetch() => result,
            _ = close_notify.notified() => return,
        };
        if closed.load(Ordering::SeqCst) {
            return;
        }
        match fetched {
            Ok(raw) => {
                let current = tx.borrow().clone();
                if raw != current {
                    let _ = tx.send(raw);
                }
            }
            Err(err) => {
                tracing::warn!("snapshot refresh fallo: {err}");
            }
        }
        tokio::select! {
            _ = kick.notified() => {}
            _ = close_notify.notified() => return,
        }
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        drain(&kick).await;
    }
}

async fn drain(kick: &tokio::sync::Notify) {
    loop {
        let mut fut = std::pin::pin!(kick.notified());
        let got = std::future::poll_fn(|cx| match fut.as_mut().poll(cx) {
            std::task::Poll::Ready(()) => std::task::Poll::Ready(true),
            std::task::Poll::Pending => std::task::Poll::Ready(false),
        })
        .await;
        if !got {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeSource {
        calls: std::sync::Arc<AtomicUsize>,
    }

    impl SnapshotSource for FakeSource {
        fn fetch(&self) -> BoxFut<Result<SnapshotRaw, crate::error::HerdrError>> {
            let calls = self.calls.clone();
            Box::pin(async move {
                let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                Ok(SnapshotRaw::from(format!("snap-{n}").as_str()))
            })
        }
    }

    #[tokio::test]
    async fn store_coalesces_burst() {
        let calls = std::sync::Arc::new(AtomicUsize::new(0));
        let store = Store::spawn(FakeSource {
            calls: calls.clone(),
        });
        for _ in 0..100 {
            store.kick();
            tokio::task::yield_now().await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let n = calls.load(Ordering::SeqCst);
        assert!(
            (1..=3).contains(&n),
            "100 kicks deberian coalescer a <=3 refrescos, hubo {n}"
        );
        store.kick();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let snap = store.snapshot();
        let expected = calls.load(Ordering::SeqCst);
        assert_eq!(&*snap, format!("snap-{expected}").as_str());
    }

    #[tokio::test]
    async fn store_publishes_initial_snapshot_without_kicks() {
        let store = Store::spawn(FakeSource {
            calls: std::sync::Arc::new(AtomicUsize::new(0)),
        });
        let mut rx = store.watch();
        tokio::time::timeout(std::time::Duration::from_millis(500), rx.changed())
            .await
            .expect("sin refresh inicial")
            .expect("watch cerrado");
        let snap = store.snapshot();
        assert!(
            snap.starts_with("snap-"),
            "el snapshot inicial no se publico: {snap}"
        );
    }
}
