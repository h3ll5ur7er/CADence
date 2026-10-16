use std::path::Path;

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

/// Desktop shell: hosts the web client and exposes the file system the desktop storage uses
/// (scoped to the app data folder in `capabilities/default.json`), save dialogs, the browser for
/// links, updates from GitHub releases, and the files the app was started with.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![opened_files, read_opened_file])
        .run(tauri::generate_context!())
        .expect("error while running CADence");
}
