use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Runtime};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Media::MediaPlaybackType;
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::core::Interface;

use super::{MediaSource, NowPlaying, TransportCommand};

// ── Known music apps ──────────────────────────────────────────────────────────

/// AUMIDs of dedicated music apps, matched case-insensitively.
/// Phase 7: move to user settings so players can be added at runtime.
const KNOWN_MUSIC_APPS: &[&str] = &[
    "youtube-music-desktop-app.exe",
    "spotify.exe",
    "applemusic.exe",
    "itunes.exe",
];

// ── Session lock ──────────────────────────────────────────────────────────────

/// The session JelloBeat is currently locked onto.
///
/// Stores the WinRT session object (not just the AUMID) so that object-level
/// identity checks can detect when Chrome replaces its session with a new one
/// while keeping the same AUMID — a case AUMID comparison would miss.
///
/// Phase 7 hook: `source_app_id` and `score` are `pub` for the mode system.
pub struct LockedSession {
    pub source_app_id: String,
    /// Score at lock time (for diagnostics and Phase 7 comparisons).
    pub score: i32,
    /// Stored to compare COM identity on `CurrentSessionChanged`.
    session: GlobalSystemMediaTransportControlsSession,
    _sub: SessionSub,
}

struct SessionSub {
    unsub: Option<Box<dyn FnOnce() + Send>>,
}

impl Drop for SessionSub {
    fn drop(&mut self) {
        if let Some(f) = self.unsub.take() {
            f();
        }
    }
}

// ── Inner state ───────────────────────────────────────────────────────────────

struct SmtcInner {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
    unsub_manager: Option<Box<dyn FnOnce() + Send>>,
    locked_session: Option<LockedSession>,
    cached: Option<NowPlaying>,
}

impl Drop for SmtcInner {
    fn drop(&mut self) {
        drop(self.locked_session.take());
        if let Some(f) = self.unsub_manager.take() {
            f();
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub struct WindowsSmtc {
    inner: Arc<Mutex<SmtcInner>>,
}

impl WindowsSmtc {
    pub fn new() -> Self {
        WindowsSmtc {
            inner: Arc::new(Mutex::new(SmtcInner {
                manager: None,
                unsub_manager: None,
                locked_session: None,
                cached: None,
            })),
        }
    }

    pub fn start<R: Runtime>(&self, app: AppHandle<R>) -> Result<(), String> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        log_sessions(&manager);

        let inner_arc = self.inner.clone();
        let app_csc = app.clone();
        let manager_csc = manager.clone();
        let token_csc = manager
            .CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
                handle_session_changed(&manager_csc, &inner_arc, &app_csc);
                Ok(())
            }))
            .map_err(|e| e.to_string())?;

        let manager_for_remove = manager.clone();
        let unsub_mgr: Box<dyn FnOnce() + Send> =
            Box::new(move || {
                let _ = manager_for_remove.RemoveCurrentSessionChanged(token_csc);
            });

        if let Some((sess, score)) = pick_best_session(&manager) {
            let np = read_now_playing(&sess);
            let locked = make_locked_session(&sess, score, &self.inner, &app);
            {
                let mut guard = self.inner.lock().unwrap();
                guard.locked_session = Some(locked);
                guard.cached = np.clone();
            }
            if let Some(ref np) = np {
                let _ = app.emit("media:update", np);
            }
        }

        {
            let mut guard = self.inner.lock().unwrap();
            guard.manager = Some(manager);
            guard.unsub_manager = Some(unsub_mgr);
        }

        Ok(())
    }

    pub fn cached_now_playing(&self) -> Option<NowPlaying> {
        self.inner.lock().unwrap().cached.clone()
    }
}

impl Default for WindowsSmtc {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaSource for WindowsSmtc {
    fn now_playing(&self) -> Option<NowPlaying> {
        self.cached_now_playing()
    }

    fn transport(&self, _cmd: TransportCommand) -> Result<(), String> {
        Err("not implemented (Phase 2)".to_string())
    }
}

// ── Session selection ─────────────────────────────────────────────────────────

/// Called whenever the OS session list changes (`CurrentSessionChanged`).
///
/// Decision flow:
///   1. Is the locked session object still in the list?  (COM identity, not AUMID)
///      - No  → re-subscribe (Chrome replaced its session with a new COM object)
///   2. If alive, is the best candidate strictly higher-scoring?
///      - Yes → switch
///      - Tie → keep current (stability)
fn handle_session_changed<R: Runtime>(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    inner_arc: &Arc<Mutex<SmtcInner>>,
    app: &AppHandle<R>,
) {
    log_sessions(manager);

    // Snapshot the current lock without holding the mutex across WinRT calls.
    let locked_info = {
        let guard = inner_arc.lock().unwrap();
        guard.locked_session.as_ref().map(|ls| {
            (ls.source_app_id.clone(), ls.session.clone(), ls.score)
        })
    };

    let cur_aumid = locked_info.as_ref().map(|(a, _, _)| a.as_str()).unwrap_or("none");
    let cur_score_disp = locked_info.as_ref().map(|(_, _, s)| s.to_string()).unwrap_or("—".into());
    eprintln!("[SMTC] current lock: {cur_aumid} (score at lock: {cur_score_disp})");

    match pick_best_session(manager) {
        None => {
            eprintln!("[SMTC] no valid sessions → clearing lock");
            let old = inner_arc.lock().unwrap().locked_session.take();
            drop(old);
            inner_arc.lock().unwrap().cached = None;
            let _ = app.emit("media:update", Option::<NowPlaying>::None);
        }
        Some((best_sess, best_score)) => {
            let best_aumid = best_sess
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default();

            let (should_switch, reason) = match &locked_info {
                None => (true, "no lock"),
                Some((_, current_sess, _)) => {
                    // Key fix: use COM object identity, not AUMID.
                    // Chrome (and other apps) may replace their session with a
                    // new COM object while keeping the same AUMID — AUMID comparison
                    // would miss this and leave the old (dead) subscription active.
                    if !session_exists_in_list(manager, current_sess) {
                        (true, "session object replaced/removed")
                    } else {
                        // Session still alive — check if best is strictly better.
                        match score_session(current_sess) {
                            None => (true, "locked session became invalid"),
                            Some(cur_now) => {
                                if best_score > cur_now {
                                    (true, "better score")
                                } else {
                                    (false, "keep (tie or lower)")
                                }
                            }
                        }
                    }
                }
            };

            eprintln!(
                "[SMTC] best: {best_aumid} (score: {best_score}) → {} [{reason}]",
                if should_switch { "SWITCH" } else { "keep current" }
            );

            if should_switch {
                let old = inner_arc.lock().unwrap().locked_session.take();
                drop(old);
                let np = read_now_playing(&best_sess);
                let locked = make_locked_session(&best_sess, best_score, inner_arc, app);
                {
                    let mut guard = inner_arc.lock().unwrap();
                    guard.locked_session = Some(locked);
                    guard.cached = np.clone();
                }
                if let Some(ref np) = np {
                    let _ = app.emit("media:update", np);
                }
            }
        }
    }
}

/// Scores a session for selection priority.
///
/// Returns `None` (excluded) when:
///   - PlaybackStatus is not Playing / Paused / Stopped (transitional/uninitialized).
///   - Title is empty.
///
/// Score:
///   +100  AUMID is in KNOWN_MUSIC_APPS
///   +10   PlaybackStatus == Playing
fn score_session(sess: &GlobalSystemMediaTransportControlsSession) -> Option<i32> {
    use GlobalSystemMediaTransportControlsSessionPlaybackStatus as PS;

    let info = sess.GetPlaybackInfo().ok()?;
    let status = info.PlaybackStatus().ok()?;

    if status != PS::Playing && status != PS::Paused && status != PS::Stopped {
        return None;
    }

    let title = sess
        .TryGetMediaPropertiesAsync()
        .ok()?
        .get()
        .ok()?
        .Title()
        .ok()?
        .to_string();

    if title.is_empty() {
        return None;
    }

    let aumid = sess
        .SourceAppUserModelId()
        .ok()
        .map(|s| s.to_string())
        .unwrap_or_default()
        .to_lowercase();

    let mut score: i32 = 0;
    if KNOWN_MUSIC_APPS.iter().any(|&app| aumid == app) {
        score += 100;
    }
    if status == PS::Playing {
        score += 10;
    }
    Some(score)
}

/// Returns the highest-scoring valid session (and its score).
/// Among equal-scoring sessions the first one wins; the caller handles tie-
/// breaking against the existing lock.
fn pick_best_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Option<(GlobalSystemMediaTransportControlsSession, i32)> {
    let Ok(sessions) = manager.GetSessions() else {
        return None;
    };
    let count = sessions.Size().unwrap_or(0);
    let mut best: Option<(GlobalSystemMediaTransportControlsSession, i32)> = None;
    for i in 0..count {
        let Ok(sess) = sessions.GetAt(i) else { continue };
        let Some(score) = score_session(&sess) else { continue };
        match &best {
            Some((_, best_score)) if *best_score >= score => {}
            _ => best = Some((sess, score)),
        }
    }
    best
}

/// Returns `true` if `session` (by COM object identity) is still present in
/// the manager's session list.
fn session_exists_in_list(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    session: &GlobalSystemMediaTransportControlsSession,
) -> bool {
    let Ok(sessions) = manager.GetSessions() else {
        return false;
    };
    let count = sessions.Size().unwrap_or(0);
    for i in 0..count {
        if let Ok(s) = sessions.GetAt(i) {
            if same_session(session, &s) {
                return true;
            }
        }
    }
    false
}

/// Compares two sessions by COM object identity (raw interface pointer equality).
///
/// Both values are the same WinRT interface type, so for in-process objects
/// the same session always returns the same interface pointer — direct
/// comparison is correct and cheaper than a full IUnknown QI.
fn same_session(
    a: &GlobalSystemMediaTransportControlsSession,
    b: &GlobalSystemMediaTransportControlsSession,
) -> bool {
    a.as_raw() == b.as_raw()
}

/// Subscribes MediaPropertiesChanged and PlaybackInfoChanged, wrapping the
/// session into a `LockedSession` that auto-unsubscribes on drop.
fn make_locked_session<R: Runtime>(
    session: &GlobalSystemMediaTransportControlsSession,
    score: i32,
    inner_arc: &Arc<Mutex<SmtcInner>>,
    app: &AppHandle<R>,
) -> LockedSession {
    let source_app_id = session
        .SourceAppUserModelId()
        .ok()
        .map(|s| s.to_string())
        .unwrap_or_default();

    // Capture AUMID strings for diagnostic logging in the event closures.
    let aumid_mp = source_app_id.clone();
    let inner_mp = inner_arc.clone();
    let app_mp = app.clone();
    let token_mp = session
        .MediaPropertiesChanged(&TypedEventHandler::new(move |sender, _| {
            if let Some(ref sess) = *sender {
                let np = read_now_playing(sess);
                let title = np.as_ref().map(|n| n.title.as_str()).unwrap_or("?");
                eprintln!("[SMTC] [props ] {aumid_mp} | {title}");
                inner_mp.lock().unwrap().cached = np.clone();
                if let Some(ref np) = np {
                    let _ = app_mp.emit("media:update", np);
                }
            }
            Ok(())
        }))
        .unwrap_or_default();

    let aumid_pi = source_app_id.clone();
    let inner_pi = inner_arc.clone();
    let app_pi = app.clone();
    let token_pi = session
        .PlaybackInfoChanged(&TypedEventHandler::new(move |sender, _| {
            if let Some(ref sess) = *sender {
                let np = read_now_playing(sess);
                let status = if np.as_ref().map(|n| n.is_playing).unwrap_or(false) {
                    "playing"
                } else {
                    "paused "
                };
                let title = np.as_ref().map(|n| n.title.as_str()).unwrap_or("?");
                eprintln!("[SMTC] [status] {aumid_pi} | {status} | {title}");
                inner_pi.lock().unwrap().cached = np.clone();
                if let Some(ref np) = np {
                    let _ = app_pi.emit("media:update", np);
                }
            }
            Ok(())
        }))
        .unwrap_or_default();

    let sess_for_unsub = session.clone();
    let _sub = SessionSub {
        unsub: Some(Box::new(move || {
            let _ = sess_for_unsub.RemoveMediaPropertiesChanged(token_mp);
            let _ = sess_for_unsub.RemovePlaybackInfoChanged(token_pi);
        })),
    };

    eprintln!("[SMTC] locked: {source_app_id} (score: {score})");
    LockedSession { source_app_id, score, session: session.clone(), _sub }
}

// ── Diagnostic logging ────────────────────────────────────────────────────────

fn log_sessions(manager: &GlobalSystemMediaTransportControlsSessionManager) {
    use GlobalSystemMediaTransportControlsSessionPlaybackStatus as PS;

    let Ok(sessions) = manager.GetSessions() else { return };
    let count = sessions.Size().unwrap_or(0);

    eprintln!(
        "[SMTC] ── {count} session(s) ─────────────────────────────────────────────────────"
    );
    eprintln!(
        "  # │ {:<7} │ {:<8} │ {:<38} │ Title",
        "Type", "Status", "AUMID"
    );
    eprintln!(
        "────┼─{:─<7}─┼─{:─<8}─┼─{:─<38}─┼─────────────────────────────────────",
        "", "", ""
    );

    for i in 0..count {
        let Ok(sess) = sessions.GetAt(i) else { continue };

        let aumid = sess
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_else(|_| "?".into());

        let info = sess.GetPlaybackInfo().ok();

        let type_str = info
            .as_ref()
            .and_then(|i| i.PlaybackType().ok())
            .and_then(|r| r.Value().ok())
            .map(|t| match t {
                MediaPlaybackType::Music => "Music",
                MediaPlaybackType::Video => "Video",
                _ => "Unknown",
            })
            .unwrap_or("?");

        let status_str = info
            .as_ref()
            .and_then(|i| i.PlaybackStatus().ok())
            .map(|s| {
                if s == PS::Playing { "Playing" }
                else if s == PS::Paused { "Paused" }
                else if s == PS::Stopped { "Stopped" }
                else { "Other" }
            })
            .unwrap_or("?");

        let title = sess
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|op| op.get().ok())
            .and_then(|p| p.Title().ok())
            .map(|t| t.to_string())
            .unwrap_or_else(|| "?".into());

        eprintln!(
            "{:3} │ {type_str:<7} │ {status_str:<8} │ {:<38} │ {}",
            i + 1,
            trunc(&aumid, 38),
            trunc(&title, 45),
        );
    }
    eprintln!();
}

fn trunc(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(max_chars.saturating_sub(1)).collect();
    if chars.next().is_some() { head + "…" } else { s.to_string() }
}

// ── Media property readers ────────────────────────────────────────────────────

fn read_now_playing(session: &GlobalSystemMediaTransportControlsSession) -> Option<NowPlaying> {
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;

    let title = props.Title().unwrap_or_default().to_string();
    let artist = props.Artist().unwrap_or_default().to_string();
    let album = props.AlbumTitle().unwrap_or_default().to_string();

    let playback = session.GetPlaybackInfo().ok()?;
    let is_playing = playback.PlaybackStatus()
        == Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing);

    let duration_secs = session
        .GetTimelineProperties()
        .ok()
        .and_then(|tl| tl.EndTime().ok())
        .map(|ts| ts.Duration as f64 / 1e7)
        .filter(|&d| d > 0.0);

    let source_app_id = session
        .SourceAppUserModelId()
        .ok()
        .map(|s| s.to_string());

    let (thumbnail, thumbnail_content_type) = read_thumbnail(&props)
        .map(|(b, ct)| (Some(b), Some(ct)))
        .unwrap_or((None, None));

    Some(NowPlaying {
        title,
        artist,
        album,
        is_playing,
        duration_secs,
        source_app_id,
        thumbnail,
        thumbnail_content_type,
    })
}

fn read_thumbnail(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<(Vec<u8>, String)> {
    let stream_ref = props.Thumbnail().ok()?;
    let stream = stream_ref.OpenReadAsync().ok()?.get().ok()?;

    let content_type = stream
        .ContentType()
        .unwrap_or_else(|_| "image/jpeg".into())
        .to_string();

    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }

    let input_stream: IInputStream = stream.cast().ok()?;
    let reader = DataReader::CreateDataReader(&input_stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;

    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some((buf, content_type))
}
