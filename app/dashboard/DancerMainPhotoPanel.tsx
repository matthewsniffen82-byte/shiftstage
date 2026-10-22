"use client";

import { useEffect, useRef, useState } from "react";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import type { LoadState } from "./dashboard-types";
import { uploadMainProfilePhoto } from "./main-profile-photo-upload";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerPhotoControls from "./DancerPhotoControls";
import DancerMediaRetryButton from "./DancerMediaRetryButton";
import DancerMediaUploadRules from "./DancerMediaUploadRules";
import { isAwaitingClubApproval, mediaReviewExplanation, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
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
  const displayed = pendingPhoto || main;
  const pending = Boolean(pendingPhoto);
  const awaitingClubApproval = Boolean(pendingPhoto && isAwaitingClubApproval(pendingPhoto.status, pendingPhoto.moderationStatus));
  const pendingReviewId = (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).some((review: Record<string, unknown>) => review.id === pendingPhoto?.id) ? pendingPhoto?.id : undefined;
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const [editRequested, setEditRequested] = useState(0);
  const action = useRef<AbortController | null>(null);
  const selection = useRef<{ file: File; uploadKey: string; replacementPhotoId?: string; pendingReviewId?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { action.current?.abort(); selection.current = null; }, []);

  useEffect(() => { onBusyChange?.(busy || cropping); return () => onBusyChange?.(false); }, [busy, cropping, onBusyChange]);

  async function upload() {
    if (action.current || !selection.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setRetry(false); setStatus("Uploading");
    try {
      const result = await uploadMainProfilePhoto(selection.current.file, {
        ...selection.current, signal: controller.signal,
        onUploadStart: () => { if (!controller.signal.aborted) setStatus("Uploading"); },
      });
      if (controller.signal.aborted) return;
      selection.current = null;
      if (!result) { setStatus("Crop canceled. Your main photo hasn’t changed."); return; }
      if (result.profile) onProfileChange?.(result.profile);
      const message = result.decision === "rejected" ? `Not approved. ${mediaReviewExplanation("photo", "rejected", result)}` : "";
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
    if (!file || action.current || cropping || awaitingClubApproval) return;
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
    <button className="dancer-main-photo-preview dancer-photo-edit-target" data-empty={!displayed} type="button" disabled={busy || cropping || awaitingClubApproval}
      aria-label={awaitingClubApproval ? "Main photo waiting for Club approval" : displayed ? "Edit main photo" : "Add main photo"} onClick={() => displayed ? setEditRequested(value => value + 1) : input.current?.click()}>
      {displayed?.imageUrl ? <img src={displayed.imageUrl} alt={pending ? "Main photo awaiting review" : "Current main profile photo"} /> : <span>{pending ? "Main photo awaiting review" : "+ Add photo"}</span>}
    </button>
    <div className="dancer-main-photo-copy">
      <h3>Main photo</h3>
      <p>Shown on your dancer card and profile. Your avatar is created automatically.</p>
      <strong className="dancer-main-photo-state" data-state={busy ? "pending" : displayed?.status || "required"}>{busy ? "Uploading" : displayed ? mediaReviewLabel(displayed.status, displayed.moderationStatus) : "Required"}</strong>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Upload main profile photo" hidden disabled={busy || cropping || awaitingClubApproval} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="dancer-main-photo-actions">
        {awaitingClubApproval ? <button type="button" aria-label="Remove pending main photo" disabled={busy || cropping} onClick={() => void remove()}>Remove</button> : <DancerPhotoControls label="main photo" compact hidden={!displayed} openRequested={editRequested} disabled={busy || cropping} primary={
          <button type="button" aria-label={pending ? "Replace main photo" : displayed ? "Change main photo" : "Add main photo"} disabled={busy || cropping} onClick={() => input.current?.click()}>{busy ? "Updating…" : pending ? "Replace" : displayed ? "Change" : "Add"}</button>
        }>
          {photos.some(photo => photo.status === "approved" && photo.id !== displayed?.id) ? <details className="dancer-saved-photo-picker">
            <summary>Choose uploaded photo</summary>
            <div className="dancer-saved-photo-choices">
              {photos.filter(photo => photo.status === "approved" && photo.id !== displayed?.id).map((photo, index) => <DancerSavedPhotoCrop
                key={photo.id} photo={photo} makeMain mainPhotoId={main?.id} disabled={busy || cropping}
                onBusyChange={setCropping} onProfileChange={onProfileChange} label={`Use uploaded photo ${index + 1} as main photo`}
                thumbnail={<img src={photo.imageUrl} alt={`Uploaded photo ${index + 1}`} />} />)}
            </div>
          </details> : null}
          {displayed ? <>
            {displayed.status === "approved" ? <DancerSavedPhotoCrop key={displayed.id} photo={displayed} disabled={busy || pending} onBusyChange={setCropping} onProfileChange={onProfileChange} /> : null}
            <button type="button" disabled={busy || cropping} onClick={() => void remove()}>{pending ? "Remove pending photo" : "Remove main photo"}</button>
          </> : null}
        </DancerPhotoControls>}
      </div>
      {retry && !awaitingClubApproval ? <button type="button" disabled={busy} onClick={() => void upload()}>Retry main photo upload</button> : null}
      {pendingPhoto && !awaitingClubApproval ? <DancerMediaRetryButton id={pendingPhoto.id} kind="photo" status={pendingPhoto.status} moderationStatus={pendingPhoto.moderationStatus}
        disabled={busy || cropping} onBusyChange={setBusy} onRetried={({ profile }) => { if (profile) onProfileChange?.(profile); }} /> : null}
      <p className="dancer-main-photo-status" role="status" aria-live="polite">{status}</p>
    </div>
    <DancerMediaUploadRules kind="photo" />
  </section>;
}
