"use client";

import { useEffect, useRef, useState } from "react";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import type { LoadState } from "./dashboard-types";
import { uploadMainProfilePhoto } from "./main-profile-photo-upload";
import "../../public/dancer-main-photo.css";

export function DancerMainPhotoPanel({ profile, onProfileChange }: {
  profile?: LoadState["profile"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
}) {
  const photos = dancerPhotoItemsFromProfile(profile);
  const main = photos.find(photo => photo.isPrimary && photo.status === "approved");
  const displayed = main || photos.find(photo => photo.status === "approved");
  const pending = photos.some(photo => photo.isPrimary && photo.status === "pending");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const action = useRef<AbortController | null>(null);
  const selection = useRef<{ file: File; uploadKey: string; replacementPhotoId?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { action.current?.abort(); selection.current = null; }, []);

  async function upload() {
    if (action.current || !selection.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setRetry(false); setStatus("Position and crop your main photo, then choose Use photo.");
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
        : "Main photo uploaded and awaiting approval. Your current photo stays visible until approval.";
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

  return <section className="dancer-main-photo-panel" aria-label="Main profile photo">
    <div className="dancer-main-photo-preview">
      {displayed?.imageUrl ? <img src={displayed.imageUrl} alt="Current main profile photo" /> : <span>No main photo yet</span>}
    </div>
    <div className="dancer-main-photo-copy">
      <h3>Main profile photo</h3>
      <p>The full photo on your dancer card. Drag and zoom to crop before uploading. Your avatar is uploaded separately.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Upload main profile photo" hidden disabled={busy || pending} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <button type="button" disabled={busy || pending} onClick={() => input.current?.click()}>{busy ? "Updating main photo…" : main ? "Replace & crop main photo" : "Upload & crop main photo"}</button>
      {retry ? <button type="button" disabled={busy} onClick={() => void upload()}>Retry main photo upload</button> : null}
      <p className="dancer-main-photo-status" role="status" aria-live="polite">{status || (pending ? "Main photo awaiting approval. Your current photo stays visible." : "")}</p>
    </div>
  </section>;
}
