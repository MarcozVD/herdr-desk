use std::pin::Pin;
use std::sync::Arc;

pub type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send>>;
pub type SnapshotRaw = Arc<str>;

pub trait SnapshotSource: Send + Sync + 'static {
    fn fetch(&self) -> BoxFut<Result<SnapshotRaw, crate::error::HerdrError>>;
}

pub struct Store {
    rx: tokio::sync::watch::Receiver<SnapshotRaw>,
    kick: std::sync::Arc<tokio::sync::Notify>,
}

impl Store {
    /// Spawns the refresher task: at most one in-flight refresh; extra kicks coalesce.
    pub fn spawn<S: SnapshotSource>(source: S) -> Self {
        let (tx, rx) = tokio::sync::watch::channel(SnapshotRaw::from("{}"));
        let kick = std::sync::Arc::new(tokio::sync::Notify::new());
        tokio::spawn(refresher(source, tx, kick.clone()));
        Self { rx, kick }
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
) {
    loop {
        kick.notified().await;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        drain(&kick).await;
        match source.fetch().await {
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
}
