"use client";

import { useEffect, useRef, useState } from "react";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import type { LoadState } from "./dashboard-types";
import { uploadMainProfilePhoto } from "./main-profile-photo-upload";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import { mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { readSession, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";
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
  const pendingReviewId = (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).some((review: Record<string, unknown>) => review.id === pendingPhoto?.id) ? pendingPhoto?.id : undefined;
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const action = useRef<AbortController | null>(null);
  const selection = useRef<{ file: File; uploadKey: string; replacementPhotoId?: string; pendingReviewId?: string } | null>(null);
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
      const message = result.decision === "rejected" ? "This photo wasn’t approved. Choose another photo. Your current photo hasn’t changed." : "";
      setStatus([message, result.replacementWarning, result.refreshFailed ? "Photo uploaded. Reload the dashboard to see its latest status." : ""].filter(Boolean).join(" "));
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
    if (!file || action.current || cropping) return;
    selection.current = null;
    setRetry(false);
    if (!file.size || file.size > 25 * 1024 * 1024 || (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name))) {
      setStatus("Choose a JPEG, PNG, WebP, HEIC, or HEIF photo up to 25 MB.");
      return;
    }
    selection.current = { file, uploadKey: crypto.randomUUID(), replacementPhotoId: main?.id || (pendingReviewId ? undefined : pendingPhoto?.id), pendingReviewId };
    void upload();
  }

  async function remove() {
    if (!displayed || action.current || cropping || !window.confirm(pending ? "Remove this pending main photo? Your approved photo will stay in use." : "Remove your main photo? An approved main photo is required to complete your profile.")) return;
    const owner = readSession()?.account?.id;
    if (!owner) { setStatus("Sign in again to remove your photo."); return; }
    const controller = new AbortController();
    action.current = controller;
    selection.current = null; setRetry(false); setBusy(true); setStatus("Removing photo…");
    const current = () => !controller.signal.aborted && readSession()?.account?.id === owner;
    try {
      await requestDancerPhotosJson({ method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId: displayed.id }), signal: controller.signal });
      if (!current()) return;
      onProfileChange?.({ ...profile,
        dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).filter((photo: Record<string, unknown>) => photo.id !== displayed.id),
        pending_photo_reviews: (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).filter((photo: Record<string, unknown>) => photo.id !== displayed.id),
      });
      const refreshed = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal });
      if (!current()) return;
      if (!refreshed.profile) throw new Error("Photo removed. Reload to see the latest status.");
      onProfileChange?.(refreshed.profile); setStatus("Photo removed.");
    } catch (error) {
      if (current()) setStatus(error instanceof Error ? error.message : "Unable to remove your photo. Try again.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setBusy(false); }
    }
  }

  return <section className="dancer-main-photo-panel" aria-label="Main profile photo" aria-busy={busy || cropping}>
    <div className="dancer-main-photo-preview">
      {displayed?.imageUrl ? <img src={displayed.imageUrl} alt={pending ? "Main photo awaiting review" : "Current main profile photo"} /> : <span>{pending ? "Main photo awaiting review" : "No main photo yet"}</span>}
    </div>
    <div className="dancer-main-photo-copy">
      <h3>Main photo</h3>
      <p>Shown on your grid card and at the top of your profile.</p>
      <strong className="dancer-main-photo-state" data-state={busy ? "pending" : displayed?.status || "required"}>{busy ? "Checking" : displayed ? mediaReviewLabel(displayed.status, displayed.moderationStatus) : "Required"}</strong>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Upload main profile photo" hidden disabled={busy || cropping} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="dancer-main-photo-actions">
        <button type="button" disabled={busy || cropping} onClick={() => input.current?.click()}>{busy ? "Updating photo…" : pending ? "Choose another photo" : displayed ? "Change photo" : "Add photo"}</button>
        {displayed?.status === "approved" ? <DancerSavedPhotoCrop key={displayed.id} photo={displayed} disabled={busy || pending} onBusyChange={setCropping} onProfileChange={onProfileChange} /> : null}
        {displayed ? <button type="button" disabled={busy || cropping} onClick={() => void remove()}>{pending ? "Remove pending photo" : "Remove main photo"}</button> : null}
      </div>
      {retry ? <button type="button" disabled={busy} onClick={() => void upload()}>Retry main photo upload</button> : null}
      <p className="dancer-main-photo-status" role="status" aria-live="polite">{status}</p>
    </div>
  </section>;
}
