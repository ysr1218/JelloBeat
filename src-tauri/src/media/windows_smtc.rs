// Phase 1에서 실제 SMTC 구현 예정.
// GlobalSystemMediaTransportControlsSessionManager를 통해
// now_playing() 구현 및 MediaPropertiesChanged 이벤트 구독.
use super::{MediaSource, NowPlaying, TransportCommand};

pub struct WindowsSmtc;

impl WindowsSmtc {
    pub fn new() -> Self {
        WindowsSmtc
    }
}

impl Default for WindowsSmtc {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaSource for WindowsSmtc {
    fn now_playing(&self) -> Option<NowPlaying> {
        None
    }

    fn transport(&self, _cmd: TransportCommand) -> Result<(), String> {
        Err("not implemented (Phase 1)".to_string())
    }
}
