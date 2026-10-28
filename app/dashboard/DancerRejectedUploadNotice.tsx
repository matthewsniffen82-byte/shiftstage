"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestDancerPhotosJson, requestDancerTvVideoJson } from "./dashboard-session";
import "./dancer-rejected-upload-notice.css";
import { mediaRejectionLabel } from "@/src/lib/dancr/media-review-label";

export default function DancerRejectedUploadNotice({ id, kind, label, disabled = false, localOnly = false, onDismiss }: {
  id: string;
  kind: "photo" | "video";
  label: string;
  disabled?: boolean;
  localOnly?: boolean;
  onDismiss: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const dismissCallback = useRef(onDismiss);
  useEffect(() => { dismissCallback.current = onDismiss; }, [onDismiss]);
  useEffect(() => () => { request.current?.abort(); }, []);

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

  if (removed) return null;
  return <div className="dancer-rejected-upload-notice" role="status" aria-live="polite">
    <strong>{label}</strong>
    <p>{mediaRejectionLabel(kind)}</p>
    {error ? <p>{error}</p> : null}
    <button type="button" disabled={disabled || removing} onClick={() => void dismiss()}>{removing ? "Removing…" : error ? "Retry removal" : "Remove"}</button>
  </div>;
}
