pub mod media;
pub mod overlay;
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Safety exit: Ctrl+Shift+Q closes the app even when click-through is active
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let quit_sc =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyQ);
                app.global_shortcut().on_shortcut(quit_sc, |app_handle, _sc, ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        app_handle.exit(0);
                    }
                })?;
            }

            // OverlayState: shared hit-rect for cursor polling (click-through)
            app.manage(std::sync::Arc::new(overlay::OverlayState::new()));

            // Resize window to cover the current monitor (no hardcoded resolution)
            let main_win = app.get_webview_window("main").unwrap();
            overlay::fit_to_monitor(&main_win);

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

                // Cursor polling: toggle set_ignore_cursor_events based on jello-box hit rect.
                // mouseenter/mouseleave cannot be used because when ignore_cursor_events=true,
                // the OS does not deliver mouse events to the webview at all.
                {
                    use windows::Win32::Foundation::POINT;
                    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

                    let poll_window = app.get_webview_window("main").unwrap();
                    let poll_state: std::sync::Arc<overlay::OverlayState> =
                        app.state::<std::sync::Arc<overlay::OverlayState>>()
                            .inner()
                            .clone();

                    std::thread::spawn(move || {
                        // Start interactive: hit_rect not yet reported by frontend
                        let mut was_inside = true;
                        let _ = poll_window.set_ignore_cursor_events(false);

                        loop {
                            std::thread::sleep(std::time::Duration::from_millis(50));

                            let rect = poll_state.hit_rect.lock().unwrap().clone();
                            let Some(rect) = rect else {
                                // hit_rect not initialized yet — keep window fully interactive
                                if !was_inside {
                                    was_inside = true;
                                    let _ = poll_window.set_ignore_cursor_events(false);
                                }
                                continue;
                            };

                            let cursor = unsafe {
                                let mut pt = POINT::default();
                                let _ = GetCursorPos(&mut pt);
                                pt
                            };

                            let win_pos = match poll_window.outer_position() {
                                Ok(p) => p,
                                Err(_) => continue,
                            };

                            let rx = cursor.x - win_pos.x;
                            let ry = cursor.y - win_pos.y;
                            let inside = rx >= rect.x
                                && rx <= rect.x + rect.w
                                && ry >= rect.y
                                && ry <= rect.y + rect.h;

                            if inside != was_inside {
                                was_inside = inside;
                                let _ = poll_window.set_ignore_cursor_events(!inside);
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_now_playing,
            commands::transport,
            commands::set_hit_rect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
