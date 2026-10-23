"use client";

import { useState } from "react";
import DancerMediaViewer from "./DancerMediaViewer";
import DancerVideoThumbnail from "./DancerVideoThumbnail";
import "./dancer-video-preview.css";

export default function DancerVideoPreview({ label, videoUrl, posterUrl, disabled = false }: {
  label: string;
  videoUrl?: string | null;
  posterUrl?: string | null;
  disabled?: boolean;
}) {
  const [playing, setPlaying] = useState<{ videoUrl: string; posterUrl?: string | null } | null>(null);

  return <>
    <DancerVideoThumbnail videoUrl={videoUrl} posterUrl={posterUrl} />
    <button className="dancer-video-preview-open" type="button" aria-label={`Play ${label.toLowerCase()}`}
      disabled={disabled || !videoUrl} onClick={() => {
        // Keep playback stable when status polling renews the private preview URL.
        if (videoUrl && !disabled) setPlaying({ videoUrl, posterUrl });
      }}>
      <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z" /></svg></span>
    </button>
    {playing ? <DancerMediaViewer kind="video" label={label} imageUrl={playing.posterUrl}
      videoUrl={playing.videoUrl} onClose={() => setPlaying(null)} /> : null}
  </>;
}
