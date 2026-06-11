#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(windows)]
#[tauri::command]
pub fn get_now_playing(
    state: tauri::State<crate::media::windows_smtc::WindowsSmtc>,
) -> Option<crate::media::NowPlaying> {
    state.cached_now_playing()
}

#[cfg(not(windows))]
#[tauri::command]
pub fn get_now_playing() -> Option<crate::media::NowPlaying> {
    None
}
