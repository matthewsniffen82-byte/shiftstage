"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { refreshDancerPhotoPreviews } from "./dancer-media-status";
import "./dancer-photo-preview.css";

type Props = { src?: string | null; alt: string; style?: CSSProperties; loading?: "lazy" | "eager" };

function previewIdentity(src: Props["src"]) {
  if (!src) return "empty";
  try {
    const url = new URL(src, "https://preview.invalid");
    if (url.pathname === "/api/media/dancer-photo" && url.searchParams.has("preview")) {
      url.searchParams.set("preview", "");
      return url.href;
    }
    if (/^\/storage\/v1\/(?:object|render\/image)\/sign\//.test(url.pathname)) {
      url.searchParams.delete("token");
      return url.href;
    }
  } catch { /* Keep unrecognized sources distinct. */ }
  return src;
}

function PhotoPreview({ src, alt, style, loading }: Props) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // This component is keyed by photo and variant. A renewed link is available
  // for recovery without replacing a photo that is already on screen.
  const [loadedSrc, setLoadedSrc] = useState<Props["src"]>(null);
  const displaySrc = loadedSrc || src;
  const [retry, setRetry] = useState({ src, attempt: 0, imageKey: 0 });
  const attempt = retry.src === src ? retry.attempt : 0;
  const retrying = state === "error" && attempt < 3 && Boolean(src);

  useEffect(() => {
    // A cached preview can finish before React attaches its load handler.
    if (image.current?.complete) {
      const decoded = image.current.naturalWidth > 0;
      setLoadedSrc(decoded ? displaySrc : null);
      setState(decoded ? "ready" : "error");
    } else setState(current => current === "ready" ? current : "loading");
  }, [displaySrc, attempt]);

  useEffect(() => {
    if (state === "error" && src) refreshDancerPhotoPreviews();
  }, [state, src]);

  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => {
      setState("loading");
      setRetry(previous => ({ src, attempt: attempt + 1, imageKey: previous.imageKey + 1 }));
    }, 1500 * (attempt + 1));
    return () => window.clearTimeout(timer);
  }, [retrying, attempt, src]);

  return <>
    {displaySrc ? <img key={retry.imageKey} ref={image} src={displaySrc} alt={alt} style={{ ...style, visibility: state === "ready" ? "visible" : "hidden" }} loading={loading}
      onLoad={() => { setLoadedSrc(displaySrc); setState("ready"); }} onError={() => { setLoadedSrc(null); setState("error"); }} /> : null}
    {state !== "ready" ? <span className="dancer-photo-preview-placeholder" role="img"
      aria-label={`${alt || "Photo"}: ${!src || state === "error" && !retrying ? "preview unavailable" : "loading preview"}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>
      <small>{!src || state === "error" && !retrying ? "Preview unavailable" : "Loading…"}</small>
    </span> : null}
  </>;
}

export default function DancerPhotoPreview(props: Props) {
  return <PhotoPreview key={previewIdentity(props.src)} {...props} />;
}
