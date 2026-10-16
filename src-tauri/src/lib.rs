use std::path::{Path, PathBuf};

/// Files the app was started with (Open with CADence, a double-clicked `.cadence` archive, or files
/// dropped onto the executable): their paths, for the web client to open.
#[tauri::command]
fn opened_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
        .collect()
}

/// The bytes of a file the app was started with; other paths are refused, so the web client cannot
/// read files outside the app data folder this way.
#[tauri::command]
fn read_opened_file(path: String) -> Result<tauri::ipc::Response, String> {
    if !opened_files().contains(&path) {
        return Err(format!("{path} was not opened with CADence"));
    }
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|error| error.to_string())
}

/// Folders the operating system keeps installed fonts in.
fn font_folders() -> Vec<PathBuf> {
    let env = |name: &str| std::env::var(name).ok().map(PathBuf::from);
    if cfg!(windows) {
        [env("WINDIR").map(|w| w.join("Fonts")), env("LOCALAPPDATA").map(|l| l.join("Microsoft").join("Windows").join("Fonts"))]
            .into_iter()
            .flatten()
            .collect()
    } else if cfg!(target_os = "macos") {
        [Some(PathBuf::from("/System/Library/Fonts")), Some(PathBuf::from("/Library/Fonts")), env("HOME").map(|h| h.join("Library/Fonts"))]
            .into_iter()
            .flatten()
            .collect()
    } else {
        [Some(PathBuf::from("/usr/share/fonts")), Some(PathBuf::from("/usr/local/share/fonts")), env("HOME").map(|h| h.join(".local/share/fonts"))]
            .into_iter()
            .flatten()
            .collect()
    }
}

/// The TrueType and OpenType font files in those folders (and a few levels below).
fn font_files() -> Vec<PathBuf> {
    fn walk(folder: &Path, depth: u32, found: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(folder) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && depth > 0 {
                walk(&path, depth - 1, found);
            } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("ttf") || e.eq_ignore_ascii_case("otf")) {
                found.push(path);
            }
        }
    }
    let mut found = Vec::new();
    for folder in font_folders() {
        walk(&folder, 3, &mut found);
    }
    found
}

/// The names of the fonts installed on this computer (their file names), sorted.
#[tauri::command]
fn system_fonts() -> Vec<String> {
    let mut names: Vec<String> = font_files().iter().filter_map(|p| p.file_name()?.to_str().map(String::from)).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// The bytes of an installed font, by the name `system_fonts` gave it.
#[tauri::command]
fn read_system_font(name: String) -> Result<tauri::ipc::Response, String> {
    let path = font_files().into_iter().find(|p| p.file_name().and_then(|f| f.to_str()) == Some(name.as_str())).ok_or(format!("No font {name} on this computer"))?;
    std::fs::read(path).map(tauri::ipc::Response::new).map_err(|error| error.to_string())
}

/// Desktop shell: hosts the web client and exposes the file system the desktop storage uses
/// (scoped to the app data folder in `capabilities/default.json`), save dialogs, the browser for
/// links, updates from GitHub releases, the files the app was started with, and installed fonts.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![opened_files, read_opened_file, system_fonts, read_system_font])
        .run(tauri::generate_context!())
        .expect("error while running CADence");
}
