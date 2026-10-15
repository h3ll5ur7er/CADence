/// Desktop shell: hosts the web client and exposes the file system the desktop storage uses
/// (scoped to the app data folder in `capabilities/default.json`), save dialogs, the browser for
/// links, and updates from GitHub releases.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running CADence");
}
