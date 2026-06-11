pub mod media;
mod commands;

#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(windows)]
            {
                use media::windows_smtc::WindowsSmtc;
                // manage() first so the state is available when the thread accesses it.
                app.manage(WindowsSmtc::new());

                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    // WinRT requires COM to be initialized on every thread that calls it.
                    // CoInitializeEx(MTA) is equivalent to RoInitialize(MTA) for WinRT.
                    unsafe {
                        let _ = windows::Win32::System::Com::CoInitializeEx(
                            None,
                            windows::Win32::System::Com::COINIT_MULTITHREADED,
                        );
                    }
                    let smtc = handle.state::<WindowsSmtc>();
                    if let Err(e) = smtc.start(handle.clone()) {
                        eprintln!("[SMTC] start failed: {e}");
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_now_playing,
            commands::transport,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
