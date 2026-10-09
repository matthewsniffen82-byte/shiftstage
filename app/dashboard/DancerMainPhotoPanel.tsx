"use client";

import { useEffect, useRef, useState } from "react";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import type { LoadState } from "./dashboard-types";
import { uploadMainProfilePhoto } from "./main-profile-photo-upload";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import "../../public/dancer-main-photo.css";

export function DancerMainPhotoPanel({ profile, onProfileChange, onBusyChange }: {
  onBusyChange?: (busy: boolean) => void;
  profile?: LoadState["profile"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
}) {
  const photos = dancerPhotoItemsFromProfile(profile);
  const main = photos.find(photo => photo.isPrimary && photo.status === "approved");
  const pendingPhoto = photos.find(photo => photo.isPrimary && photo.status === "pending");
  const displayed = pendingPhoto || main || photos.find(photo => photo.status === "approved");
  const pending = Boolean(pendingPhoto);
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const action = useRef<AbortController | null>(null);
  const selection = useRef<{ file: File; uploadKey: string; replacementPhotoId?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { action.current?.abort(); selection.current = null; }, []);

  useEffect(() => { onBusyChange?.(busy || cropping); return () => onBusyChange?.(false); }, [busy, cropping, onBusyChange]);

  async function upload() {
    if (action.current || !selection.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setRetry(false); setStatus("Preparing your photo…");
    try {
      const result = await uploadMainProfilePhoto(selection.current.file, {
        ...selection.current, signal: controller.signal,
        onUploadStart: () => { if (!controller.signal.aborted) setStatus("Uploading and checking your main photo…"); },
      });
      if (controller.signal.aborted) return;
      selection.current = null;
      if (!result) { setStatus("Crop canceled. Your main photo hasn’t changed."); return; }
      if (result.profile) onProfileChange?.(result.profile);
      const message = result.decision === "approved" ? "Main profile photo approved and saved."
        : result.decision === "rejected" ? "This photo wasn’t approved. Choose another photo. Your current photo hasn’t changed."
        : result.profile ? "" : "Main photo uploaded and awaiting approval.";
      setStatus(message + (result.refreshFailed ? " Reload the dashboard to see its latest status." : ""));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof Error && error.name === "AbortError") selection.current = null;
      else setRetry(true);
      setStatus(error instanceof Error ? error.message : "Unable to upload your main photo. Try again.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setBusy(false); }
    }
  }

  function choose(file?: File) {
    if (!file || action.current || pending) return;
    selection.current = null;
    setRetry(false);
    if (!file.size || file.size > 25 * 1024 * 1024 || (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name))) {
      setStatus("Choose a JPEG, PNG, WebP, HEIC, or HEIF photo up to 25 MB.");
      return;
    }
    selection.current = { file, uploadKey: crypto.randomUUID(), replacementPhotoId: main?.id };
    void upload();
  }

  return <section className="dancer-main-photo-panel" aria-label="Main profile photo" aria-busy={busy || cropping}>
    <div className="dancer-main-photo-preview">
      {displayed?.imageUrl ? <img src={displayed.imageUrl} alt={pending ? "Main photo awaiting approval" : "Current main profile photo"} /> : <span>{pending ? "Main photo awaiting approval" : "No main photo yet"}</span>}
    </div>
    <div className="dancer-main-photo-copy">
      <h3>Main photo</h3>
      <p>Shown on your grid card and at the top of your profile.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Upload main profile photo" hidden disabled={busy || pending || cropping} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="dancer-main-photo-actions">
        <button type="button" disabled={busy || pending || cropping} onClick={() => input.current?.click()}>{busy ? "Updating photo…" : pending ? "Awaiting approval" : displayed ? "Change photo" : "Add photo"}</button>
        {displayed?.status === "approved" ? <DancerSavedPhotoCrop key={displayed.id} photo={displayed} disabled={busy || pending} onBusyChange={setCropping} onProfileChange={onProfileChange} /> : null}
      </div>
      {retry ? <button type="button" disabled={busy} onClick={() => void upload()}>Retry main photo upload</button> : null}
      <p className="dancer-main-photo-status" role="status" aria-live="polite">{status || (pending ? "Main photo uploaded and awaiting approval." : "")}</p>
    </div>
  </section>;
}
