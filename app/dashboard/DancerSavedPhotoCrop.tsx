"use client";

import { useEffect, useRef, useState } from "react";
import type { DancerPhotoItem } from "./dashboard-types";
import { uploadMainProfilePhoto, type SavedPhotoCropSource } from "./main-profile-photo-upload";

export default function DancerSavedPhotoCrop({ photo, disabled = false, onProfileChange, onBusyChange, makeMain = false, mainPhotoId, replacementPhotoId, pendingReviewId }: {
  photo: DancerPhotoItem;
  makeMain?: boolean;
  mainPhotoId?: string;
  replacementPhotoId?: string;
  pendingReviewId?: string;
  disabled?: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const action = useRef<AbortController | null>(null);
  const selection = useRef<{ source: SavedPhotoCropSource | File; uploadKey: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = photo.status === "pending";
  useEffect(() => () => { action.current?.abort(); selection.current = null; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  async function crop(retrying = false, file?: File) {
    if (action.current || disabled) return;
    if (pending && !retrying && !file) { input.current?.click(); return; }
    if (file && (!file.size || file.size > 25 * 1024 * 1024 || (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)))) {
      setStatus("Choose a JPEG, PNG, WebP, HEIC, or HEIF photo up to 25 MB."); return;
    }
    if (!retrying || !selection.current) selection.current = {
      source: file || { id: photo.id, isPrimary: Boolean(photo.isPrimary), sortOrder: Number(photo.sortOrder || 0) }, uploadKey: crypto.randomUUID(),
    };
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setRetry(false); setStatus("Opening your saved photo…");
    try {
      const result = await uploadMainProfilePhoto(selection.current.source, {
        signal: controller.signal, uploadKey: selection.current.uploadKey,
        makeMain, replacementPhotoId: makeMain ? mainPhotoId : pending ? replacementPhotoId : undefined,
        pendingReviewId: pending ? pendingReviewId : undefined,
        photoSlot: pending ? { isPrimary: Boolean(photo.isPrimary), sortOrder: Number(photo.sortOrder || 0) } : undefined,
        onUploadStart: () => setStatus("Saving and checking your crop…"),
      });
      if (controller.signal.aborted) return;
      selection.current = null;
      if (!result) { setStatus("Crop canceled. Your photo hasn’t changed."); return; }
      if (result.profile) onProfileChange?.(result.profile);
      setStatus([result.decision === "rejected" ? "This photo wasn’t approved. Your current photo hasn’t changed." : "",
        result.replacementWarning, result.refreshFailed ? "Photo uploaded. Reload to see the latest status." : ""].filter(Boolean).join(" "));
    } catch (error) {
      if (controller.signal.aborted) return;
      setRetry(!(error instanceof Error && error.name === "AbortError"));
      setStatus(error instanceof Error ? error.message : "Unable to save your crop. Try again.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setBusy(false); }
    }
  }
  return <div className="dancer-saved-photo-crop">
    {pending ? <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Replace pending photo" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void crop(false, file); }} /> : null}
    <button type="button" disabled={disabled || busy} aria-busy={busy} onClick={() => void crop()}>{busy ? "Preparing photo…" : pending ? "Choose another photo" : makeMain ? "Use as main photo" : "Crop photo"}</button>
    {retry ? <button type="button" disabled={disabled || busy} onClick={() => void crop(true)}>Retry crop save</button> : null}
    {status ? <p role="status" aria-live="polite">{status}</p> : null}
  </div>;
}
