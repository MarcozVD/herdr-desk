use crate::error::HerdrError;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};

const ERROR_PIPE_BUSY: i32 = 231;

pub async fn open(pipe: &str) -> Result<NamedPipeClient, HerdrError> {
    let mut delay = std::time::Duration::from_millis(2);
    for _ in 0..8 {
        match ClientOptions::new().open(pipe) {
            Ok(client) => return Ok(client),
            Err(err) if err.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                tokio::time::sleep(delay).await;
                delay *= 2;
            }
            Err(err) => return Err(HerdrError::Transport(err)),
        }
    }
    Err(HerdrError::Busy)
}

/// One request per connection: write one line, read one line, drop.
pub async fn roundtrip(pipe: &str, line: &[u8]) -> Result<String, HerdrError> {
    let client = open(pipe).await?;
    let (read_half, mut write_half) = tokio::io::split(client);
    write_half.write_all(line).await?;
    write_half.flush().await?;
    let mut reader = BufReader::new(read_half);
    let mut response = String::new();
    reader.read_line(&mut response).await?;
    if response.is_empty() {
        return Err(HerdrError::ClosedWithoutResponse);
    }
    Ok(response)
}
