use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("I/O error on {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Expected a .{expected} file, got: {path}")]
    InvalidFileType { path: String, expected: &'static str },
    #[error("Not a PDF file (missing %PDF- header): {0}")]
    NotPdf(String),
    #[error("Invalid {kind} document: {reason}")]
    InvalidDocument { kind: &'static str, reason: String },
    #[error("Unsupported {kind} version {found}; this build supports versions 1 to {supported}")]
    UnsupportedVersion {
        kind: &'static str,
        found: u64,
        supported: u64,
    },
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Path error: {0}")]
    Path(String),
    #[error("Background task failed: {0}")]
    Task(String),
}

/// Errors cross the IPC boundary as plain strings; the frontend shows them in the command log.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
