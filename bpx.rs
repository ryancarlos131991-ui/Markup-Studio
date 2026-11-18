//! `.bpx` sidecar persistence.
//!
//! A drawing `Level 2.pdf` gets its markups in `Level 2.bpx` next to it. The PDF is
//! never mutated while editing; markups are only flattened into a PDF on export.
//! Rust validates the envelope (format, version, top-level shape) so a corrupt or
//! foreign JSON file can never be loaded or written. Entity-level validation is done
//! in TypeScript (`src/core/validate.ts`), which owns the schema.

use crate::error::{AppError, AppResult};
use crate::fsutil::{atomic_write, has_extension, io_err, run_blocking};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const BPX_FORMAT: &str = "bpx";
pub const BPX_VERSION: u64 = 1;
/// The PDF spec allows junk before the header; Acrobat accepts it within the first 1 KiB.
const PDF_HEADER_WINDOW: usize = 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFileInfo {
    pub path: String,
    pub file_name: String,
    pub byte_length: u64,
    pub modified_ms: u64,
    pub sidecar_path: String,
    pub sidecar_exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub bytes_written: u64,
    pub backup_path: Option<String>,
}

fn validate_pdf_path(path: &str) -> AppResult<PathBuf> {
    let p = PathBuf::from(path);
    if !has_extension(&p, "pdf") {
        return Err(AppError::InvalidFileType {
            path: path.to_string(),
            expected: "pdf",
        });
    }
    Ok(p)
}

pub fn sidecar_for(pdf: &Path) -> PathBuf {
    pdf.with_extension(BPX_FORMAT)
}

fn has_pdf_header(head: &[u8]) -> bool {
    let window = &head[..head.len().min(PDF_HEADER_WINDOW)];
    window.windows(5).any(|w| w == b"%PDF-")
}

/// Validates the `.bpx` envelope. Returns a human-readable reason on failure.
pub fn validate_bpx(doc: &Value) -> AppResult<()> {
    let invalid = |reason: &str| AppError::InvalidDocument {
        kind: "bpx",
        reason: reason.to_string(),
    };
    let obj = doc.as_object().ok_or_else(|| invalid("root is not an object"))?;
    match obj.get("format").and_then(Value::as_str) {
        Some(BPX_FORMAT) => {}
        _ => return Err(invalid("missing or wrong \"format\" (expected \"bpx\")")),
    }
    let version = obj
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("\"version\" must be a positive integer"))?;
    if version == 0 || version > BPX_VERSION {
        return Err(AppError::UnsupportedVersion {
            kind: "bpx",
            found: version,
            supported: BPX_VERSION,
        });
    }
    if !obj.get("pdf").map(Value::is_object).unwrap_or(false) {
        return Err(invalid("\"pdf\" fingerprint must be an object"));
    }
    if !obj.get("pages").map(Value::is_object).unwrap_or(false) {
        return Err(invalid("\"pages\" must be an object"));
    }
    if !obj.get("layers").map(Value::is_array).unwrap_or(false) {
        return Err(invalid("\"layers\" must be an array"));
    }
    if !obj.get("entities").map(Value::is_array).unwrap_or(false) {
        return Err(invalid("\"entities\" must be an array"));
    }
    Ok(())
}

#[tauri::command]
pub async fn stat_pdf(path: String) -> AppResult<PdfFileInfo> {
    run_blocking(move || {
        let p = validate_pdf_path(&path)?;
        let meta = fs::metadata(&p).map_err(io_err(&p))?;
        if !meta.is_file() {
            return Err(AppError::Path(format!("{} is not a file", p.display())));
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let sidecar = sidecar_for(&p);
        Ok(PdfFileInfo {
            file_name: p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path,
            byte_length: meta.len(),
            modified_ms,
            sidecar_exists: sidecar.is_file(),
            sidecar_path: sidecar.display().to_string(),
        })
    })
    .await
}

/// Streams the whole PDF to the webview as a raw binary IPC response
/// (no base64/JSON inflation, so a 200 MB drawing set costs 200 MB, not 270 MB).
#[tauri::command]
pub async fn read_pdf(path: String) -> AppResult<tauri::ipc::Response> {
    let bytes = run_blocking(move || {
        let p = validate_pdf_path(&path)?;
        let mut file = fs::File::open(&p).map_err(io_err(&p))?;
        let len = file.metadata().map(|m| m.len() as usize).unwrap_or(0);
        let mut bytes = Vec::with_capacity(len);
        file.read_to_end(&mut bytes).map_err(io_err(&p))?;
        if !has_pdf_header(&bytes) {
            return Err(AppError::NotPdf(path));
        }
        Ok(bytes)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Returns the sidecar JSON, or `null` when the PDF has never been marked up.
#[tauri::command]
pub async fn load_bpx(pdf_path: String) -> AppResult<Option<Value>> {
    run_blocking(move || {
        let p = validate_pdf_path(&pdf_path)?;
        let sidecar = sidecar_for(&p);
        if !sidecar.is_file() {
            return Ok(None);
        }
        let text = fs::read_to_string(&sidecar).map_err(io_err(&sidecar))?;
        let doc: Value = serde_json::from_str(&text)?;
        validate_bpx(&doc)?;
        Ok(Some(doc))
    })
    .await
}

/// Atomically writes the sidecar. The previous version is kept as `<name>.bpx.bak`
/// so a bad save can always be recovered by hand.
#[tauri::command]
pub async fn save_bpx(pdf_path: String, document: Value) -> AppResult<SaveResult> {
    run_blocking(move || {
        let p = validate_pdf_path(&pdf_path)?;
        validate_bpx(&document)?;
        let sidecar = sidecar_for(&p);
        let bytes = serde_json::to_vec_pretty(&document)?;
        let backup_path = if sidecar.is_file() {
            let bak = sidecar.with_extension("bpx.bak");
            fs::copy(&sidecar, &bak).map_err(io_err(&bak))?;
            Some(bak.display().to_string())
        } else {
            None
        };
        atomic_write(&sidecar, &bytes)?;
        Ok(SaveResult {
            path: sidecar.display().to_string(),
            bytes_written: bytes.len() as u64,
            backup_path,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_doc() -> Value {
        json!({
            "format": "bpx",
            "version": 1,
            "pdf": { "fileName": "a.pdf", "byteLength": 10, "modifiedMs": 0, "pageCount": 1 },
            "displayUnit": "mm",
            "pages": {},
            "layers": [],
            "activeLayerId": "layer-markup",
            "entities": [],
            "counters": { "nextEntitySeq": 1 }
        })
    }

    #[test]
    fn accepts_valid_envelope() {
        validate_bpx(&valid_doc()).unwrap();
    }

    #[test]
    fn rejects_wrong_format_and_future_version() {
        let mut d = valid_doc();
        d["format"] = json!("other");
        assert!(validate_bpx(&d).is_err());

        let mut d = valid_doc();
        d["version"] = json!(BPX_VERSION + 1);
        assert!(matches!(
            validate_bpx(&d),
            Err(AppError::UnsupportedVersion { .. })
        ));
    }

    #[test]
    fn rejects_missing_collections() {
        for key in ["pdf", "pages", "layers", "entities"] {
            let mut d = valid_doc();
            d.as_object_mut().unwrap().remove(key);
            assert!(validate_bpx(&d).is_err(), "missing {key} should fail");
        }
    }

    #[test]
    fn sidecar_path_replaces_extension() {
        assert_eq!(
            sidecar_for(Path::new("/plans/S-201 Level 2.PDF")),
            PathBuf::from("/plans/S-201 Level 2.bpx")
        );
    }

    #[test]
    fn header_detection_allows_leading_junk() {
        assert!(has_pdf_header(b"%PDF-1.7\n"));
        assert!(has_pdf_header(b"\xEF\xBB\xBFjunk%PDF-1.4"));
        assert!(!has_pdf_header(b"PK\x03\x04 not a pdf"));
    }
}
