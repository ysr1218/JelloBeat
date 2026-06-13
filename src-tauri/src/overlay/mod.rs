use std::sync::Mutex;

/// Expand the window to cover the entire virtual desktop (all connected monitors).
///
/// Computes the bounding box of every monitor's physical-pixel rectangle, then sets
/// the window position to the top-left origin and size to the full extent.
///
/// All values are in physical pixels — Tauri's set_size / set_position accept these
/// directly via PhysicalSize / PhysicalPosition.
///
/// DPI note: Monitor::size() already returns physical pixels regardless of scale_factor,
/// so the bounding-box arithmetic is scale-agnostic for the window itself. Mixed-DPI
/// handling inside the webview (CSS pixel space) is left for a future phase.
///
/// Fallback chain when available_monitors() fails or returns empty:
///   fit_to_monitor() → current_monitor() → primary_monitor() → 1920×1080 at (0,0)
pub fn fit_to_virtual_desktop(window: &tauri::WebviewWindow) {
    use tauri::{PhysicalPosition, PhysicalSize};

    let monitors = match window.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => {
            fit_to_monitor(window);
            return;
        }
    };

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
        let pos = m.position();
        let sz = m.size();
        min_x = min_x.min(pos.x);
        min_y = min_y.min(pos.y);
        max_x = max_x.max(pos.x + sz.width as i32);
        max_y = max_y.max(pos.y + sz.height as i32);
    }

    let _ = window.set_size(PhysicalSize::new(
        (max_x - min_x) as u32,
        (max_y - min_y) as u32,
    ));
    let _ = window.set_position(PhysicalPosition::new(min_x, min_y));
}

/// Resize the window to cover only the monitor it currently lives on.
/// Used as a fallback inside fit_to_virtual_desktop and may be re-used
/// for single-monitor configurations in the future.
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
