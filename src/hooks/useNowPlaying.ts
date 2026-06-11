import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
  duration_secs: number | null;
  source_app_id: string | null;
  thumbnail: number[] | null;
  thumbnail_content_type: string | null;
}

// Converts raw byte array to base64 in chunks to avoid call-stack overflow.
function toBase64Chunked(bytes: number[]): string {
  const CHUNK = 8192;
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(result);
}

export function useNowPlaying() {
  const [np, setNp] = useState<NowPlaying | null>(null);

  useEffect(() => {
    // Initial fetch in case the app is already playing when we load.
    invoke<NowPlaying | null>("get_now_playing").then(setNp).catch(() => {});

    // Subscribe to real-time updates pushed from Rust.
    const unlistenPromise = listen<NowPlaying | null>("media:update", (e) => {
      setNp(e.payload);
    });

    return () => {
      unlistenPromise.then((f) => f());
    };
  }, []);

  const thumbnailUrl =
    np?.thumbnail && np?.thumbnail_content_type
      ? `data:${np.thumbnail_content_type};base64,${toBase64Chunked(np.thumbnail)}`
      : null;

  return { np, thumbnailUrl };
}
