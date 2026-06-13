import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { useJelloPhysics } from "../hooks/useJelloPhysics";

function formatDuration(secs: number | null): string {
  if (!secs) return "--:--";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function simplifySource(id: string | null | undefined): string {
  if (!id) return "Music";
  const base = id.replace(/\\/g, "/").split("/").pop() ?? id;
  const name = base.replace(/\.exe$/i, "");
  if (/^\{[0-9A-F-]{36}\}$/i.test(name)) return "Browser";
  return name.split(/[_!]/)[0];
}

export function NowPlayingCard() {
  const { np, thumbnailUrl } = useNowPlaying();
  const transport = (cmd: string) => invoke("transport", { cmd }).catch(console.error);
  const boxRef = useRef<HTMLDivElement>(null);

  // Stable callback: report current bounding rect to Rust for hit-testing.
  const updateHitRect = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    invoke("set_hit_rect", {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    }).catch(console.error);
  }, []); // boxRef is stable

  // Re-report hit rect when idle↔active state changes (box height differs).
  useEffect(() => {
    updateHitRect();
  }, [np !== null, updateHitRect]); // eslint-disable-line react-hooks/exhaustive-deps

  const { onMouseDown } = useJelloPhysics(boxRef, updateHitRect);

  if (!np) {
    return (
      <div className="jello-box jello-idle" ref={boxRef} onMouseDown={onMouseDown}>
        <div className="jello-bg-base" />
        <div className="jello-content">
          <p className="jello-idle-text">No media playing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="jello-box" ref={boxRef} onMouseDown={onMouseDown}>
      <div className="jello-bg-base" />
      {thumbnailUrl && (
        <div className="jello-bg-art" style={{ backgroundImage: `url(${thumbnailUrl})` }} />
      )}
      <div className="jello-content">
        <div className="jello-art-wrap">
          {thumbnailUrl
            ? <img className="jello-art" src={thumbnailUrl} alt="" />
            : <div className="jello-art jello-art-fallback" />}
        </div>
        <div className="jello-right">
          <div className="jello-info">
            <p className="jello-source">♪ {simplifySource(np.source_app_id)}</p>
            <p className="jello-title">{np.title || "Unknown title"}</p>
            <p className="jello-artist">{np.artist || "Unknown artist"}</p>
          </div>
          <div className="jello-mid">
            <input
              type="range"
              className="jello-progress"
              min={0} max={100} value={0}
              onChange={() => {}}
            />
            <div className="jello-time">
              <span>0:00</span>
              <span>{formatDuration(np.duration_secs)}</span>
            </div>
            <div className="jello-transport">
              <button className="jello-btn-skip" onClick={() => transport("SkipPrevious")}>⏮</button>
              <button className="jello-btn-play" onClick={() => transport(np.is_playing ? "Pause" : "Play")}>
                {np.is_playing ? "⏸" : "▶"}
              </button>
              <button className="jello-btn-skip" onClick={() => transport("SkipNext")}>⏭</button>
            </div>
          </div>
          <div className="jello-volume">
            <span className="jello-vol-icon">🔈</span>
            <input
              type="range"
              className="jello-volume-slider"
              min={0} max={100} defaultValue={80}
              onChange={(e) => console.log("volume:", e.target.value)}
            />
            <span className="jello-vol-icon">🔊</span>
          </div>
        </div>
      </div>
    </div>
  );
}
