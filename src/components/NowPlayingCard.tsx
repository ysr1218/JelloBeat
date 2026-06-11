import { useNowPlaying } from "../hooks/useNowPlaying";

export function NowPlayingCard() {
  const { np, thumbnailUrl } = useNowPlaying();

  if (!np) {
    return (
      <div className="now-playing-card idle">
        <p className="idle-text">No media playing</p>
      </div>
    );
  }

  return (
    <div className="now-playing-card">
      {thumbnailUrl && (
        <img
          className="thumbnail"
          src={thumbnailUrl}
          alt="Album art"
        />
      )}
      <div className="info">
        <p className="title">{np.title || "Unknown title"}</p>
        <p className="artist">{np.artist || "Unknown artist"}</p>
        {np.album && <p className="album">{np.album}</p>}
        <p className="status">{np.is_playing ? "Playing" : "Paused"}</p>
      </div>
    </div>
  );
}
