"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestDancerPhotosJson, requestDancerTvVideoJson } from "./dashboard-session";
import "./dancer-rejected-upload-notice.css";

export const REJECTION_NOTICE_MS = 10_000;

export default function DancerRejectedUploadNotice({ id, kind, label, message, disabled = false, onDismiss }: {
  id: string;
  kind: "photo" | "video";
  label: string;
  message: string;
  disabled?: boolean;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const notice = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const dismissCallback = useRef(onDismiss);
  useEffect(() => { dismissCallback.current = onDismiss; }, [onDismiss]);
  useEffect(() => () => { request.current?.abort(); }, []);

  useEffect(() => {
    let inView = typeof IntersectionObserver === "undefined";
    const updateVisibility = () => setVisible(inView && document.visibilityState === "visible");
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      updateVisibility();
    }, { threshold: 0.5 });
    if (notice.current) observer?.observe(notice.current);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);

  const dismiss = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRemoving(true);
    setError("");
    try {
      const options = { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dismiss-rejected", ...(kind === "photo" ? { photoId: id } : {}) }),
        signal: controller.signal, fallbackMessage: "Unable to clear this upload. Try again." };
      const data = kind === "photo" ? await requestDancerPhotosJson(options) : await requestDancerTvVideoJson(id, options);
      if (controller.signal.aborted) return;
      if (data.dismissedId !== id) throw new Error("Unable to confirm removal. Try again.");
      setRemoved(true);
      dismissCallback.current();
    } catch {
      if (!controller.signal.aborted) setError("Couldn't clear this upload. Try again.");
    } finally {
      if (!controller.signal.aborted) { request.current = null; setRemoving(false); }
    }
  }, [id, kind]);

  useEffect(() => {
    if (!visible || paused || disabled || removing || removed || error) return;
    const timer = window.setTimeout(() => void dismiss(), REJECTION_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, paused, disabled, removing, removed, error, dismiss]);

  if (removed) return null;
  return <div ref={notice} className="dancer-rejected-upload-notice" role="status" aria-live="polite"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <strong>{label}: Not approved</strong>
    <p>{message}</p>
    {error ? <><p>{error}</p><button type="button" disabled={disabled || removing} onClick={() => void dismiss()}>Retry removal</button></> : null}
  </div>;
}
