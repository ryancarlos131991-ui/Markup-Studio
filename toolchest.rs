//! Tool Chest persistence. Tool chests belong to the user profile, not to a drawing,
//! so they live in the OS app-config directory (e.g. %APPDATA%/com.markupstudio.desktop).

use crate::error::{AppError, AppResult};
use crate::fsutil::{atomic_write, io_err, run_blocking};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const TOOLCHEST_FORMAT: &str = "bpx-toolchest";
pub const TOOLCHEST_VERSION: u64 = 1;

fn tool_chest_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Path(e.to_string()))?;
    Ok(dir.join("tool-chests.json"))
}

pub fn validate_tool_chests(doc: &Value) -> AppResult<()> {
    let invalid = |reason: &str| AppError::InvalidDocument {
        kind: "tool chest",
        reason: reason.to_string(),
    };
    let obj = doc.as_object().ok_or_else(|| invalid("root is not an object"))?;
    if obj.get("format").and_then(Value::as_str) != Some(TOOLCHEST_FORMAT) {
        return Err(invalid("missing or wrong \"format\""));
    }
    let version = obj
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("\"version\" must be a positive integer"))?;
    if version == 0 || version > TOOLCHEST_VERSION {
        return Err(AppError::UnsupportedVersion {
            kind: "tool chest",
            found: version,
            supported: TOOLCHEST_VERSION,
        });
    }
    if !obj.get("sets").map(Value::is_array).unwrap_or(false) {
        return Err(invalid("\"sets\" must be an array"));
    }
    Ok(())
}

#[tauri::command]
pub async fn load_tool_chests(app: AppHandle) -> AppResult<Option<Value>> {
    let path = tool_chest_path(&app)?;
    run_blocking(move || {
        if !path.is_file() {
            return Ok(None);
        }
        let text = fs::read_to_string(&path).map_err(io_err(&path))?;
        let doc: Value = serde_json::from_str(&text)?;
        validate_tool_chests(&doc)?;
        Ok(Some(doc))
    })
    .await
}

#[tauri::command]
pub async fn save_tool_chests(app: AppHandle, document: Value) -> AppResult<()> {
    let path = tool_chest_path(&app)?;
    run_blocking(move || {
        validate_tool_chests(&document)?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(io_err(dir))?;
        }
        let bytes = serde_json::to_vec_pretty(&document)?;
        atomic_write(&path, &bytes)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_envelope() {
        let ok = json!({ "format": TOOLCHEST_FORMAT, "version": 1, "sets": [] });
        validate_tool_chests(&ok).unwrap();
        let bad = json!({ "format": TOOLCHEST_FORMAT, "version": 1 });
        assert!(validate_tool_chests(&bad).is_err());
    }
}
