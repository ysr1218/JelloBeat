use std::sync::Mutex;

/// Resize and reposition the window to cover the monitor it currently lives on.
///
/// Resolution detection order:
///   1. current_monitor() — accurate after the window has a screen position
///   2. primary_monitor() — reliable fallback on first launch (window not yet placed)
///   3. hardcoded 1920×1080 at (0,0) — last resort when no monitor info is available
///
/// Call this once at startup, and again whenever the window is moved to another monitor
/// (Phase 7+: listen for WindowEvent::Moved and re-call).
pub fn fit_to_monitor(window: &tauri::WebviewWindow) {
    use tauri::{PhysicalPosition, PhysicalSize};
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    match monitor {
        Some(m) => {
            let sz = m.size();
            let pos = m.position();
            let _ = window.set_size(PhysicalSize::new(sz.width, sz.height));
            let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
        }
        None => {
            let _ = window.set_size(PhysicalSize::new(1920_u32, 1080_u32));
            let _ = window.set_position(PhysicalPosition::new(0_i32, 0_i32));
        }
    }
}

#[derive(Clone)]
pub struct HitRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

pub struct OverlayState {
    pub hit_rect: Mutex<Option<HitRect>>,
}

impl OverlayState {
    pub fn new() -> Self {
        Self {
            hit_rect: Mutex::new(None),
        }
    }
}
