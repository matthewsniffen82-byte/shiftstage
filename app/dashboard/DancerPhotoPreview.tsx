"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { refreshDancerPhotoPreviews } from "./dancer-media-status";
import "./dancer-photo-preview.css";

type Props = { src?: string | null; alt: string; style?: CSSProperties; loading?: "lazy" | "eager" };

function previewIdentity(src: Props["src"]) {
  if (!src) return "empty";
  try {
    const url = new URL(src);
    // A renewed access token still points to the same private image. Preserve
    // its DOM node; different objects, crops and versions must reset the preview.
    if (/^\/storage\/v1\/(?:object|render\/image)\/sign\//.test(url.pathname)) {
      url.searchParams.delete("token");
      return url.href;
    }
  } catch { /* Local upload previews and relative URLs retain their full identity. */ }
  return src;
}

function PhotoPreview({ src, alt, style, loading }: Props) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState({ src, attempt: 0, imageKey: 0 });
  const attempt = retry.src === src ? retry.attempt : 0;
  const retrying = state === "error" && attempt < 3 && Boolean(src);

  useEffect(() => {
    // A cached preview can finish before React attaches its load handler.
    if (image.current?.complete) setState(image.current.naturalWidth > 0 ? "ready" : "error");
    // Keep the loaded image visible while the browser loads a renewed URL into
    // the same image element. Failed URLs still get a fresh loading/retry cycle.
    else setState(current => current === "ready" ? current : "loading");
  }, [src, attempt]);

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
    {src ? <img key={retry.imageKey} ref={image} src={src} alt={alt} style={{ ...style, visibility: state === "ready" ? "visible" : "hidden" }} loading={loading}
      onLoad={() => setState("ready")} onError={() => setState("error")} /> : null}
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
