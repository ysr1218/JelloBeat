use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Runtime};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::core::{EventRegistrationToken, Interface};

use super::{MediaSource, NowPlaying, TransportCommand};

// Holds live SMTC state. Wrapped in Arc<Mutex<>> so WinRT event closures can share it.
struct SmtcInner {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
    token_session_changed: Option<EventRegistrationToken>,
    session_state: Option<SessionState>,
    cached: Option<NowPlaying>,
}

struct SessionState {
    session: GlobalSystemMediaTransportControlsSession,
    token_media_props: EventRegistrationToken,
    token_playback: EventRegistrationToken,
}

impl Drop for SmtcInner {
    fn drop(&mut self) {
        if let Some(ss) = self.session_state.take() {
            let _ = ss.session.RemoveMediaPropertiesChanged(ss.token_media_props);
            let _ = ss.session.RemovePlaybackInfoChanged(ss.token_playback);
        }
        if let (Some(mgr), Some(t)) = (&self.manager, self.token_session_changed.take()) {
            let _ = mgr.RemoveCurrentSessionChanged(t);
        }
    }
}

pub struct WindowsSmtc {
    inner: Arc<Mutex<SmtcInner>>,
}

impl WindowsSmtc {
    pub fn new() -> Self {
        WindowsSmtc {
            inner: Arc::new(Mutex::new(SmtcInner {
                manager: None,
                token_session_changed: None,
                session_state: None,
                cached: None,
            })),
        }
    }

    pub fn start<R: Runtime>(&self, app: AppHandle<R>) -> Result<(), String> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let inner_arc = self.inner.clone();
        let app_csc = app.clone();
        let manager_csc = manager.clone();
        let token_csc = manager
            .CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
                handle_session_changed(&manager_csc, &inner_arc, &app_csc);
                Ok(())
            }))
            .map_err(|e| e.to_string())?;

        let session = pick_active_session(&manager);
        if let Some(ref sess) = session {
            let np = read_now_playing(sess);
            subscribe_session(sess, &self.inner, &app);
            self.inner.lock().unwrap().cached = np;
        }

        {
            let mut guard = self.inner.lock().unwrap();
            guard.manager = Some(manager);
            guard.token_session_changed = Some(token_csc);
            if let Some(ref np) = guard.cached.clone() {
                let _ = app.emit("media:update", np);
            }
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

// ── Internal helpers ─────────────────────────────────────────────────────────

fn handle_session_changed<R: Runtime>(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    inner_arc: &Arc<Mutex<SmtcInner>>,
    app: &AppHandle<R>,
) {
    // Take old session state out before calling WinRT Remove* to avoid deadlock.
    let old_state = inner_arc.lock().unwrap().session_state.take();
    if let Some(ss) = old_state {
        let _ = ss.session.RemoveMediaPropertiesChanged(ss.token_media_props);
        let _ = ss.session.RemovePlaybackInfoChanged(ss.token_playback);
    }

    if let Some(sess) = pick_active_session(manager) {
        let np = read_now_playing(&sess);
        subscribe_session(&sess, inner_arc, app);
        inner_arc.lock().unwrap().cached = np.clone();
        if let Some(ref np) = np {
            let _ = app.emit("media:update", np);
        }
    } else {
        inner_arc.lock().unwrap().cached = None;
        let _ = app.emit("media:update", Option::<NowPlaying>::None);
    }
}

fn subscribe_session<R: Runtime>(
    session: &GlobalSystemMediaTransportControlsSession,
    inner_arc: &Arc<Mutex<SmtcInner>>,
    app: &AppHandle<R>,
) {
    // In windows-rs 0.61 TypedEventHandler closures receive Ref<'_, T> (not &Option<T>).
    // Ref<'_, T> implements Deref<Target=T>, so &*sender gives &T.

    let inner_mp = inner_arc.clone();
    let app_mp = app.clone();
    let token_mp = session
        .MediaPropertiesChanged(&TypedEventHandler::new(move |sender, _| {
            let np = read_now_playing(&*sender);
            inner_mp.lock().unwrap().cached = np.clone();
            if let Some(ref np) = np {
                let _ = app_mp.emit("media:update", np);
            }
            Ok(())
        }))
        .unwrap_or_default();

    let inner_pi = inner_arc.clone();
    let app_pi = app.clone();
    let token_pi = session
        .PlaybackInfoChanged(&TypedEventHandler::new(move |sender, _| {
            let np = read_now_playing(&*sender);
            inner_pi.lock().unwrap().cached = np.clone();
            if let Some(ref np) = np {
                let _ = app_pi.emit("media:update", np);
            }
            Ok(())
        }))
        .unwrap_or_default();

    inner_arc.lock().unwrap().session_state = Some(SessionState {
        session: session.clone(),
        token_media_props: token_mp,
        token_playback: token_pi,
    });
}

fn pick_active_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Option<GlobalSystemMediaTransportControlsSession> {
    if let Ok(sess) = manager.GetCurrentSession() {
        return Some(sess);
    }
    if let Ok(sessions) = manager.GetSessions() {
        let count = sessions.Size().unwrap_or(0);
        for i in 0..count {
            if let Ok(sess) = sessions.GetAt(i) {
                if let Ok(info) = sess.GetPlaybackInfo() {
                    if info.PlaybackStatus()
                        == Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                    {
                        return Some(sess);
                    }
                }
            }
        }
        if count > 0 {
            return sessions.GetAt(0).ok();
        }
    }
    None
}

fn read_now_playing(session: &GlobalSystemMediaTransportControlsSession) -> Option<NowPlaying> {
    // TryGetMediaPropertiesAsync returns Result<IAsyncOperation<MediaProps>> — no double-unwrap.
    let props = session
        .TryGetMediaPropertiesAsync()
        .ok()?
        .get()
        .ok()?;

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

    // Cast IRandomAccessStreamWithContentType → IInputStream via Interface hierarchy.
    let input_stream: IInputStream = stream.cast().ok()?;
    let reader = DataReader::CreateDataReader(&input_stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;

    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some((buf, content_type))
}
