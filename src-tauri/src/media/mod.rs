use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    /// Duration in seconds from TimelineProperties.EndTime. None if unavailable or 0 (live stream).
    pub duration_secs: Option<f64>,
    /// Windows AUMID of the source app (e.g. Spotify, Chrome). Used in Phase 5 for Core Audio mapping.
    pub source_app_id: Option<String>,
    /// Album art bytes (JPEG/PNG).
    pub thumbnail: Option<Vec<u8>>,
    /// MIME type of the thumbnail bytes (e.g. "image/jpeg"). None when thumbnail is None.
    pub thumbnail_content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransportCommand {
    Play,
    Pause,
    TogglePlayPause,
    SkipNext,
    SkipPrevious,
}

/// Platform-agnostic interface to a system media session.
/// Each platform provides its own implementation behind `#[cfg(target_os = ...)]`.
/// Event subscription is handled internally by each implementation via Tauri's AppHandle.emit().
pub trait MediaSource: Send + Sync {
    /// Returns the currently playing track, or `None` when nothing is active.
    fn now_playing(&self) -> Option<NowPlaying>;

    /// Sends a transport command (play/pause/skip) to the active session.
    fn transport(&self, cmd: TransportCommand) -> Result<(), String>;
}

#[cfg(windows)]
pub mod windows_smtc;
