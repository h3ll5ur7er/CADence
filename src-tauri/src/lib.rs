/// Desktop shell: hosts the web client and exposes the file system the desktop storage uses
/// (scoped to the app data folder in `capabilities/default.json`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running CADence");
}
