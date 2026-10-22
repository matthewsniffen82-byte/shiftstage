"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestDancerPhotosJson, requestDancerTvVideoJson } from "./dashboard-session";
import "./dancer-rejected-upload-notice.css";

export const REJECTION_NOTICE_MS = 5_000;

export default function DancerRejectedUploadNotice({ id, kind, label, message, disabled = false, localOnly = false, onDismiss }: {
  id: string;
  kind: "photo" | "video";
  label: string;
  message: string;
  disabled?: boolean;
  localOnly?: boolean;
  onDismiss: () => void;
}) {
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const notice = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const remainingMs = useRef(REJECTION_NOTICE_MS);
  const dismissCallback = useRef(onDismiss);
  useEffect(() => { dismissCallback.current = onDismiss; }, [onDismiss]);
  useEffect(() => () => { request.current?.abort(); }, []);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    if (typeof IntersectionObserver === "undefined") setHasBeenVisible(true);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setHasBeenVisible(true);
    }, { threshold: 0 });
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
      // Files rejected before upload have no server record to dismiss.
      if (localOnly) {
        setRemoved(true);
        dismissCallback.current();
        return;
      }
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
  }, [id, kind, localOnly]);

  useEffect(() => {
    if (!hasBeenVisible || !pageVisible || disabled || removing || removed || error) return;
    // Once shown, scrolling or a phone's synthetic hover must not restart cleanup.
    // Preserve elapsed time when the tab is hidden or another upload is busy.
    const startedAt = performance.now();
    const timer = window.setTimeout(() => void dismiss(), remainingMs.current);
    return () => {
      window.clearTimeout(timer);
      remainingMs.current = Math.max(0, remainingMs.current - (performance.now() - startedAt));
    };
  }, [hasBeenVisible, pageVisible, disabled, removing, removed, error, dismiss]);

  if (removed) return null;
  return <div ref={notice} className="dancer-rejected-upload-notice" role="status" aria-live="polite">
    <strong>{label}: Not approved</strong>
    <p>{message}</p>
    {error ? <><p>{error}</p><button type="button" disabled={disabled || removing} onClick={() => void dismiss()}>Retry removal</button></> : null}
  </div>;
}
