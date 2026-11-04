"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./dancer-photo-preview.css";

type Props = { src?: string | null; alt: string; style?: CSSProperties; loading?: "lazy" | "eager" };

function PhotoPreview({ src, alt, style, loading }: Props) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const retrying = state === "error" && attempt < 3 && Boolean(src);

  useEffect(() => {
    // A cached preview can finish before React attaches its load handler.
    if (image.current?.complete) setState(image.current.naturalWidth > 0 ? "ready" : "error");
  }, [attempt]);

  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => { setState("loading"); setAttempt(value => value + 1); }, 1500 * (attempt + 1));
    return () => window.clearTimeout(timer);
  }, [retrying, attempt]);

  return <>
    {src ? <img key={attempt} ref={image} src={src} alt={alt} style={{ ...style, visibility: state === "ready" ? "visible" : "hidden" }} loading={loading}
      onLoad={() => setState("ready")} onError={() => setState("error")} /> : null}
    {state !== "ready" ? <span className="dancer-photo-preview-placeholder" role="img"
      aria-label={`${alt || "Photo"}: ${!src || state === "error" && !retrying ? "preview unavailable" : "loading preview"}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>
      <small>{!src || state === "error" && !retrying ? "Preview unavailable" : "Loading…"}</small>
    </span> : null}
  </>;
}

export default function DancerPhotoPreview(props: Props) {
  // A new private URL must retry even if the previous processing URL failed.
  return <PhotoPreview key={props.src || "empty"} {...props} />;
}
