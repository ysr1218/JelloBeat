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

#[cfg(windows)]
#[tauri::command]
pub fn transport(
    cmd: crate::media::TransportCommand,
    state: tauri::State<crate::media::windows_smtc::WindowsSmtc>,
) -> Result<(), String> {
    use crate::media::MediaSource;
    state.transport(cmd)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn transport(_cmd: crate::media::TransportCommand) -> Result<(), String> {
    Err("transport not supported on this platform".to_string())
}
