use crate::error::{AppError, AppResult};
use std::fs;
use std::io::Write;
use std::path::Path;

/// Builds a `map_err` adapter that tags an `io::Error` with the path it happened on.
pub fn io_err(path: &Path) -> impl FnOnce(std::io::Error) -> AppError {
    let path = path.display().to_string();
    move |source| AppError::Io { path, source }
}

pub fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
        .unwrap_or(false)
}

/// Writes `bytes` to `path` crash-safely: write + fsync a temp file in the same
/// directory, then rename over the destination (atomic on NTFS, APFS, ext4).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Path(format!("{} has no parent directory", path.display())))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Path(format!("{} has no file name", path.display())))?
        .to_string_lossy()
        .into_owned();
    let tmp = dir.join(format!(".{}.tmp-{}", file_name, std::process::id()));

    let write_result = (|| -> AppResult<()> {
        let mut file = fs::File::create(&tmp).map_err(io_err(&tmp))?;
        file.write_all(bytes).map_err(io_err(&tmp))?;
        file.sync_all().map_err(io_err(&tmp))?;
        Ok(())
    })();
    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(source) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(AppError::Io {
            path: path.display().to_string(),
            source,
        });
    }
    Ok(())
}

/// Runs blocking file work off the async runtime's worker threads so large
/// PDFs never stall IPC for other windows/commands.
pub async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Task(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markup-studio-test-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = temp_dir("atomic");
        let target = dir.join("plan.bpx");
        atomic_write(&target, b"first").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first");
        atomic_write(&target, b"second").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file left behind");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extension_check_is_case_insensitive() {
        assert!(has_extension(Path::new("/a/B.PDF"), "pdf"));
        assert!(has_extension(Path::new("/a/b.pdf"), "pdf"));
        assert!(!has_extension(Path::new("/a/b.pdf.exe"), "pdf"));
        assert!(!has_extension(Path::new("/a/pdf"), "pdf"));
    }
}
