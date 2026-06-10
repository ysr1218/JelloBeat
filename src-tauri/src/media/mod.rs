use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    /// JPEG/PNG bytes of album art, if available
    pub thumbnail: Option<Vec<u8>>,
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
pub trait MediaSource: Send + Sync {
    /// Returns the currently playing track, or `None` when nothing is active.
    fn now_playing(&self) -> Option<NowPlaying>;

    /// Sends a transport command (play/pause/skip) to the active session.
    fn transport(&self, cmd: TransportCommand) -> Result<(), String>;
}

#[cfg(windows)]
pub mod windows_smtc;
