mod bpx;
mod error;
mod fsutil;
mod toolchest;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            bpx::stat_pdf,
            bpx::read_pdf,
            bpx::load_bpx,
            bpx::save_bpx,
            toolchest::load_tool_chests,
            toolchest::save_tool_chests,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markup Studio");
}
