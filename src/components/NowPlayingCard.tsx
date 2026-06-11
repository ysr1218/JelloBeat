import { invoke } from "@tauri-apps/api/core";
import { useNowPlaying } from "../hooks/useNowPlaying";

function formatDuration(secs: number | null): string {
  if (!secs) return "--:--";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NowPlayingCard() {
  const { np, thumbnailUrl } = useNowPlaying();
  const transport = (cmd: string) => invoke("transport", { cmd }).catch(console.error);

  if (!np) {
    return (
      <div className="jello-box jello-idle">
        <div className="jello-bg-base" />
        <div className="jello-content">
          <p className="jello-idle-text">No media playing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="jello-box">
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
          <div className="jello-row-top">
            <div className="jello-meta">
              <p className="jello-title">{np.title || "Unknown title"}</p>
              <p className="jello-artist">{np.artist || "Unknown artist"}</p>
            </div>
            <div className="jello-transport">
              <button className="jello-btn-skip" onClick={() => transport("SkipPrevious")}>⏮</button>
              <button className="jello-btn-play" onClick={() => transport(np.is_playing ? "Pause" : "Play")}>
                {np.is_playing ? "⏸" : "▶"}
              </button>
              <button className="jello-btn-skip" onClick={() => transport("SkipNext")}>⏭</button>
            </div>
          </div>
          <input
            type="range"
            className="jello-progress"
            min={0} max={100} value={0}
            onChange={() => {}}
          />
          <div className="jello-row-bottom">
            <div className="jello-time">
              <span>0:00</span>
              <span>{formatDuration(np.duration_secs)}</span>
            </div>
            <div className="jello-volume">
              <span className="jello-vol-icon">🔊</span>
              <input
                type="range"
                className="jello-volume-slider"
                min={0} max={100} defaultValue={80}
                onChange={(e) => console.log("volume:", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
