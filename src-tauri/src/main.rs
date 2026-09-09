#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
async fn set_keep_awake(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "windows")]
        let result = {
            #[link(name = "kernel32")]
            extern "system" { fn SetThreadExecutionState(flags: u32) -> u32; }
            // Thread-scoped request; no power plan or registry is changed.
            let flags = 0x80000000 | if enabled { 0x00000002 } else { 0 };
            if unsafe { SetThreadExecutionState(flags) } == 0 { Err("无法更新屏幕常亮请求".to_string()) } else { Ok(enabled) }
        };
        #[cfg(not(target_os = "windows"))]
        let result = Err("此功能仅支持 Windows".to_string());
        let _ = send.send(result);
    }).map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_focus_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "shell32")]
        extern "system" { fn ShellExecuteW(window: isize, operation: *const u16, file: *const u16, params: *const u16, directory: *const u16, show: i32) -> isize; }
        let uri: Vec<u16> = "ms-settings:notifications\0".encode_utf16().collect();
        let result = unsafe { ShellExecuteW(0, std::ptr::null(), uri.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if result <= 32 { return Err("请手动打开 Windows 设置 → 系统 → 通知".into()); }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("请在系统设置中开启勿扰".into())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_keep_awake, open_focus_settings])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .run(tauri::generate_context!())
        .expect("无法启动航刻");
}
