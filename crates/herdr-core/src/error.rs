use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum HerdrError {
    #[error("error de transporte: {0}")]
    Transport(#[from] std::io::Error),
    #[error("pipe ocupado (ERROR_PIPE_BUSY)")]
    Busy,
    #[error("el server cerro la conexion sin responder")]
    ClosedWithoutResponse,
    #[error("timeout esperando respuesta de {method}")]
    Timeout { method: String },
    #[error("error de api herdr [{code}]: {message}")]
    Api { code: String, message: String },
    #[error("respuesta malformada: {0}")]
    Parse(String),
}

impl HerdrError {
    pub fn code(&self) -> String {
        match self {
            HerdrError::Transport(_) | HerdrError::Busy | HerdrError::ClosedWithoutResponse => {
                "transport".to_string()
            }
            HerdrError::Timeout { .. } => "timeout".to_string(),
            HerdrError::Api { code, .. } => code.clone(),
            HerdrError::Parse(_) => "parse".to_string(),
        }
    }

    pub fn message(&self) -> String {
        match self {
            HerdrError::Api { message, .. } => message.clone(),
            other => other.to_string(),
        }
    }

    pub fn api(&self) -> ApiError {
        ApiError {
            code: self.code(),
            message: self.message(),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}
