"use client";

import { useEffect, useRef, useState } from "react";
import { primeVideoPreviewFrame } from "./dancer-profile-media-sync";

function resourceKey(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://preview.invalid");
    url.searchParams.delete("preview");
    url.searchParams.delete("token");
    return url.href;
  } catch { return value; }
}

export default function DancerVideoThumbnail({ posterUrl, videoUrl }: {
  posterUrl?: string | null;
  videoUrl?: string | null;
}) {
  const [failedPoster, setFailedPoster] = useState("");
  const [posterSource, setPosterSource] = useState(posterUrl || "");
  const [failedVideo, setFailedVideo] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [previewSource, setPreviewSource] = useState("");
  const containerRef = useRef<HTMLSpanElement>(null);
  // Polls renew private preview tokens. Keep the loaded resource until it fails
  // or its identity changes, then use the latest authorized URL.
  const currentPoster = posterUrl && posterSource && posterSource !== failedPoster
    && resourceKey(posterSource) === resourceKey(posterUrl) ? posterSource : posterUrl || "";
  const hasPoster = Boolean(currentPoster && currentPoster !== failedPoster);

  useEffect(() => {
    if (currentPoster !== posterSource) setPosterSource(currentPoster);
  }, [currentPoster, posterSource]);

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
    if (!hasPoster && isVisible && videoUrl && (!previewSource || previewSource === failedVideo
      || resourceKey(videoUrl) !== resourceKey(previewSource)) && videoUrl !== previewSource) setPreviewSource(videoUrl);
  }, [hasPoster, isVisible, videoUrl, previewSource, failedVideo]);

  return (
    <span className="dancer-video-thumbnail" ref={containerRef} aria-hidden="true">
      {hasPoster ? <img alt="" loading="lazy" src={currentPoster} onError={() => setFailedPoster(currentPoster)} /> : previewSource ? (
        <video
          muted
          playsInline
          preload="metadata"
          src={previewSource}
          onError={() => setFailedVideo(previewSource)}
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
