"use client";

import { useEffect, useRef, useState } from "react";
import type { DancerPhotoItem } from "./dashboard-types";
import { uploadMainProfilePhoto, type SavedPhotoCropSource } from "./main-profile-photo-upload";

export default function DancerSavedPhotoCrop({ photo, disabled = false, onProfileChange, onBusyChange, makeMain = false, mainPhotoId }: {
  photo: DancerPhotoItem;
  makeMain?: boolean;
  mainPhotoId?: string;
  disabled?: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const action = useRef<AbortController | null>(null);
  const selection = useRef<{ source: SavedPhotoCropSource; uploadKey: string } | null>(null);
  useEffect(() => () => { action.current?.abort(); selection.current = null; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  async function crop(retrying = false) {
    if (action.current || disabled) return;
    if (!retrying || !selection.current) selection.current = {
      source: { id: photo.id, isPrimary: Boolean(photo.isPrimary), sortOrder: Number(photo.sortOrder || 0) }, uploadKey: crypto.randomUUID(),
    };
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setRetry(false); setStatus("Opening your saved photo…");
    try {
      const result = await uploadMainProfilePhoto(selection.current.source, {
        signal: controller.signal, uploadKey: selection.current.uploadKey,
        makeMain, replacementPhotoId: makeMain ? mainPhotoId : undefined,
        onUploadStart: () => setStatus("Saving and checking your crop…"),
      });
      if (controller.signal.aborted) return;
      selection.current = null;
      if (!result) { setStatus("Crop canceled. Your photo hasn’t changed."); return; }
      if (result.profile) onProfileChange?.(result.profile);
      setStatus((result.decision === "approved" ? makeMain ? "Main photo saved." : "Crop saved." : result.decision === "rejected"
        ? "This crop wasn’t approved. Your current photo hasn’t changed."
        : "Crop awaiting approval. Your current photo stays visible.") + (result.refreshFailed ? " Reload to see the latest photo." : ""));
    } catch (error) {
      if (controller.signal.aborted) return;
      setRetry(!(error instanceof Error && error.name === "AbortError"));
      setStatus(error instanceof Error ? error.message : "Unable to save your crop. Try again.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setBusy(false); }
    }
  }
  return <div className="dancer-saved-photo-crop">
    <button type="button" disabled={disabled || busy} aria-busy={busy} onClick={() => void crop()}>{busy ? "Cropping…" : "Crop photo"}</button>
    {retry ? <button type="button" disabled={disabled || busy} onClick={() => void crop(true)}>Retry crop save</button> : null}
    {status ? <p role="status" aria-live="polite">{status}</p> : null}
  </div>;
}
