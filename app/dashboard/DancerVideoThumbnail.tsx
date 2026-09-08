"use client";

import { useEffect, useRef, useState } from "react";
import { primeVideoPreviewFrame } from "./dancer-profile-media-sync";

export default function DancerVideoThumbnail({ posterUrl, videoUrl }: {
  posterUrl?: string | null;
  videoUrl?: string | null;
}) {
  const [failedPoster, setFailedPoster] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [previewSource, setPreviewSource] = useState("");
  const containerRef = useRef<HTMLSpanElement>(null);
  const hasPoster = Boolean(posterUrl && posterUrl !== failedPoster);

  useEffect(() => {
    const container = containerRef.current;
    if (hasPoster || isVisible || !videoUrl || !container) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasPoster, isVisible, videoUrl]);

  useEffect(() => {
    // Keep the current frame stable when status polling renews signed URLs.
    if (!hasPoster && isVisible && videoUrl && !previewSource) setPreviewSource(videoUrl);
  }, [hasPoster, isVisible, videoUrl, previewSource]);

  return (
    <span className="dancer-video-thumbnail" ref={containerRef} aria-hidden="true">
      {hasPoster ? <img alt="" loading="lazy" src={posterUrl!} onError={() => setFailedPoster(posterUrl!)} /> : previewSource ? (
        <video
          muted
          playsInline
          preload="metadata"
          src={previewSource}
          onLoadedMetadata={(event) => primeVideoPreviewFrame(event.currentTarget)}
        />
      ) : null}
      <style>{`
        .dancer-video-thumbnail { position:absolute; inset:0; display:block; overflow:hidden; border-radius:inherit; pointer-events:none; }
        .dancer-video-thumbnail img, .dancer-video-thumbnail video { display:block; width:100%; height:100%; max-height:none; object-fit:cover; }
      `}</style>
    </span>
  );
}
