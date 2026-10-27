"use client";

import { useState, type VideoHTMLAttributes } from "react";

function resourceIdentity(source: string) {
  try {
    const url = new URL(source, "https://media.invalid");
    // These capabilities are renewed by dashboard polling, not new videos.
    url.searchParams.delete("preview");
    url.searchParams.delete("token");
    return url.href;
  } catch { return source; }
}

type StableVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { src: string };

/** Keep a native player's source intact for the entire play/pause session. */
export default function StableVideo({ src, onPlay, onError, ...props }: StableVideoProps) {
  const identity = resourceIdentity(src);
  const [playback, setPlayback] = useState(() => ({ identity, src, started: false }));
  let current = playback;
  if (identity !== playback.identity || (!playback.started && src !== playback.src)) {
    current = { identity, src, started: false };
    setPlayback(current);
  }

  return <video {...props} key={identity} src={current.src}
    onPlay={event => {
      setPlayback(value => value.started ? value : { ...value, started: true });
      onPlay?.(event);
    }}
    onError={event => {
      // A failed player may try the next refreshed URL; never reload on pause.
      setPlayback(value => ({ ...value, started: false }));
      onError?.(event);
    }}
  />;
}
