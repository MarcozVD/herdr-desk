use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::time::timeout;

use crate::error::HerdrError;
use crate::transport;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
const METHODS_WITH_WAIT: &[&str] = &[
    "agent.wait",
    "agent.prompt",
    "pane.wait_for_output",
    "events.wait",
];

pub struct RpcClient {
    pipe: String,
    next_id: AtomicU64,
}

impl RpcClient {
    pub fn new(pipe: String) -> Self {
        Self {
            pipe,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn pipe(&self) -> &str {
        &self.pipe
    }

    pub async fn call(&self, method: &str, params: &Value) -> Result<Value, HerdrError> {
        let id = format!("hd-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let request = json!({"id": id, "method": method, "params": params});
        let mut line =
            serde_json::to_string(&request).map_err(|e| HerdrError::Parse(e.to_string()))?;
        line.push('\n');

        let dur = timeout_for(method, params);
        let response = timeout(dur, transport::roundtrip(&self.pipe, line.as_bytes()))
            .await
            .map_err(|_| HerdrError::Timeout {
                method: method.to_string(),
            })??;
        parse_response(&response)
    }

    /// session.snapshot with the raw JSON of the snapshot field, never re-serialized.
    pub async fn snapshot_raw(&self) -> Result<Arc<str>, HerdrError> {
        let id = format!("hd-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let request = json!({"id": id, "method": "session.snapshot", "params": {}});
        let mut line =
            serde_json::to_string(&request).map_err(|e| HerdrError::Parse(e.to_string()))?;
        line.push('\n');

        let response = timeout(
            DEFAULT_TIMEOUT,
            transport::roundtrip(&self.pipe, line.as_bytes()),
        )
        .await
        .map_err(|_| HerdrError::Timeout {
            method: "session.snapshot".to_string(),
        })??;

        let v: Value =
            serde_json::from_str(&response).map_err(|e| HerdrError::Parse(e.to_string()))?;
        if let Some(err) = v.get("error") {
            return Err(HerdrError::Api {
                code: err
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
                message: err
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            });
        }

        #[derive(serde::Deserialize)]
        struct SnapResult<'a> {
            #[serde(borrow)]
            snapshot: &'a serde_json::value::RawValue,
        }
        #[derive(serde::Deserialize)]
        struct SnapResp<'a> {
            #[serde(borrow)]
            result: SnapResult<'a>,
        }

        let parsed: SnapResp =
            serde_json::from_str(&response).map_err(|e| HerdrError::Parse(e.to_string()))?;
        Ok(Arc::<str>::from(parsed.result.snapshot.get()))
    }
}

impl crate::store::SnapshotSource for Arc<RpcClient> {
    fn fetch(&self) -> crate::store::BoxFut<Result<Arc<str>, HerdrError>> {
        let this = self.clone();
        Box::pin(async move { this.snapshot_raw().await })
    }
}

fn timeout_for(method: &str, params: &Value) -> Duration {
    if METHODS_WITH_WAIT.contains(&method) {
        let ms = params
            .get("timeout_ms")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        Duration::from_millis(ms) + Duration::from_secs(2)
    } else {
        DEFAULT_TIMEOUT
    }
}

fn parse_response(response: &str) -> Result<Value, HerdrError> {
    let v: Value = serde_json::from_str(response).map_err(|e| HerdrError::Parse(e.to_string()))?;
    if let Some(err) = v.get("error") {
        return Err(HerdrError::Api {
            code: err
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            message: err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        });
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| HerdrError::Parse("respuesta sin result".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ok_response() {
        let line = r#"{"id":"hd-1","result":{"type":"pong","protocol":19}}"#;
        let v = parse_response(line).expect("ok");
        assert_eq!(v["type"], "pong");
        assert_eq!(v["protocol"], 19);
    }

    #[test]
    fn parse_error_response() {
        let line = r#"{"id":"","error":{"code":"invalid_request","message":"boom"}}"#;
        let err = parse_response(line).expect_err("error");
        match err {
            HerdrError::Api { code, message } => {
                assert_eq!(code, "invalid_request");
                assert_eq!(message, "boom");
            }
            other => panic!("esperaba Api, obtuve {other:?}"),
        }
    }

    #[test]
    fn parse_empty_id_error() {
        let line = r#"{"id":"hd-9","error":{"code":"not_found","message":"x"}}"#;
        let err = parse_response(line).expect_err("error");
        assert_eq!(err.code(), "not_found");
    }
}
