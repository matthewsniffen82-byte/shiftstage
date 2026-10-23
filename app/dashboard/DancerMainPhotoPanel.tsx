"use client";

import { useEffect, useRef, useState } from "react";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import type { LoadState } from "./dashboard-types";
import { uploadMainProfilePhoto } from "./main-profile-photo-upload";
import { photoUploadPercent } from "./photo-upload-progress";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerPhotoControls from "./DancerPhotoControls";
import DancerMediaRetryButton from "./DancerMediaRetryButton";
import DancerMediaUploadRules from "./DancerMediaUploadRules";
import { isAwaitingClubApproval, mediaReviewExplanation, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { readSession, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";
import "../../public/dancer-main-photo.css";
import "./dancer-upload-queue.css";

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
  const reviewDelayed = Boolean(pendingPhoto && mediaReviewLabel(pendingPhoto.status, pendingPhoto.moderationStatus) === "Review delayed");
  const pendingReviewId = (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).some((review: Record<string, unknown>) => review.id === pendingPhoto?.id) ? pendingPhoto?.id : undefined;
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [status, setStatus] = useState("");
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [retry, setRetry] = useState(false);
  const [editRequested, setEditRequested] = useState(0);
  const action = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const uploadReceived = useRef(false);
  const previousMainId = useRef<string | undefined>(undefined);
  const selection = useRef<{ file: File; uploadKey: string; replacementPhotoId?: string; pendingReviewId?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { action.current?.abort(); selection.current = null; }, []);

  useEffect(() => { onBusyChange?.(busy || cropping); return () => onBusyChange?.(false); }, [busy, cropping, onBusyChange]);

  async function upload() {
    if (action.current || !selection.current) return;
    const controller = new AbortController();
    action.current = controller;
    previousMainId.current = main?.id;
    cancelRequested.current = false; uploadReceived.current = false;
    setBusy(true); setRetry(false); setStatus("Uploading"); setUploadPercent(0);
    try {
      const result = await uploadMainProfilePhoto(selection.current.file, {
        ...selection.current, signal: controller.signal,
        isCanceled: () => cancelRequested.current,
        onUploadStart: () => { if (!controller.signal.aborted) setStatus("Uploading"); },
        onUploadProgress: percent => {
          if (controller.signal.aborted || action.current !== controller) return;
          if (percent === 100) uploadReceived.current = true;
          setUploadPercent(photoUploadPercent({ stage: "uploading", progress: percent }));
          if (!cancelRequested.current) setStatus(percent === 100 ? "Completed" : "Uploading");
        },
      });
      if (controller.signal.aborted) return;
      selection.current = null;
      if (!result) { setUploadPercent(null); setStatus("Crop canceled. Your main photo hasn’t changed."); return; }
      setUploadPercent(result.decision === "canceled" ? null : photoUploadPercent(undefined, {
        status: ["approved", "rejected"].includes(result.decision) ? result.decision : "pending", moderationStatus: result.decision,
      }));
      if (result.profile) onProfileChange?.(result.profile);
      const message = result.decision === "canceled" ? "Upload canceled." : result.decision === "rejected" ? `Not approved. ${mediaReviewExplanation("photo", "rejected", result)}` : "";
      setStatus([message, result.replacementWarning, result.refreshFailed ? "Photo uploaded. Reload the dashboard to see its latest status." : ""].filter(Boolean).join(" "));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (cancelRequested.current || error instanceof Error && error.name === "AbortError") selection.current = null;
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

  function cancelUpload() {
    cancelRequested.current = true;
    if (uploadReceived.current) { setStatus("Canceling…"); return; }
    action.current?.abort(); action.current = null; selection.current = null;
    setUploadPercent(null);
    setBusy(false); setRetry(false); setStatus("Upload canceled.");
  }

  async function remove(cancelPending = false) {
    if (!displayed || action.current || cropping || (!cancelPending && !window.confirm(pending ? "Remove this pending main photo? Your approved photo will stay in use." : "Remove your main photo? An approved main photo is required to complete your profile."))) return;
    const owner = readSession()?.account?.id;
    if (!owner) { setStatus("Sign in again to remove your photo."); return; }
    const controller = new AbortController();
    action.current = controller;
    selection.current = null; setUploadPercent(null); setRetry(false); setBusy(true); setStatus("Removing photo…");
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
      onProfileChange?.(refreshed.profile); setStatus("");
    } catch (error) {
      if (current()) setStatus(error instanceof Error ? error.message : "Unable to remove your photo. Try again.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setBusy(false); }
    }
  }

  const overallPercent = busy && selection.current ? uploadPercent
    : pendingPhoto ? photoUploadPercent(undefined, pendingPhoto)
    : uploadPercent !== null && !retry && main && main.id !== previousMainId.current ? 100 : uploadPercent;

  return <section className="dancer-main-photo-panel" aria-label="Main profile photo" aria-busy={busy || cropping}>
    <button className="dancer-main-photo-preview dancer-photo-edit-target" data-empty={!displayed} type="button" disabled={busy || cropping || awaitingClubApproval}
      aria-label={awaitingClubApproval ? "Main photo waiting for final approval" : displayed ? "Edit main photo" : "Add main photo"} onClick={() => displayed ? setEditRequested(value => value + 1) : input.current?.click()}>
      {displayed?.imageUrl ? <img src={displayed.imageUrl} alt={pending ? "Main photo awaiting review" : "Current main profile photo"} /> : <span>{pending ? "Main photo awaiting review" : "+ Add photo"}</span>}
    </button>
    <div className="dancer-main-photo-copy">
      <h3>Main photo</h3>
      <p>Shown on your dancer card and profile. Your avatar is created automatically.</p>
      {overallPercent !== null && overallPercent < 100 ? <div className="dancer-upload-overall">
        <strong>{retry || reviewDelayed ? "Upload needs attention" : "Uploading"} · {overallPercent}%</strong>
        <span className="dancer-upload-progress" role="progressbar" aria-label="Main photo upload progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallPercent}>
          <span style={{ width: `${overallPercent}%` }} />
        </span>
      </div> : null}
      <strong className="dancer-main-photo-state" role="status" aria-live="polite" data-state={busy ? "pending" : displayed?.status || "required"}>{busy ? ["Completed", "Removing photo…", "Canceling…"].includes(status) ? status : "Uploading" : displayed ? mediaReviewLabel(displayed.status, displayed.moderationStatus) : "Required"}</strong>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Upload main profile photo" hidden disabled={busy || cropping || awaitingClubApproval} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="dancer-main-photo-actions">
        {busy && selection.current ? <button type="button" disabled={cancelRequested.current} onClick={cancelUpload}>{cancelRequested.current ? "Canceling…" : "Cancel"}</button>
          : pending && !awaitingClubApproval ? <button type="button" disabled={busy || cropping} onClick={() => void remove(true)}>Cancel</button> : null}
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
      {pendingPhoto && reviewDelayed ? <DancerMediaRetryButton id={pendingPhoto.id} kind="photo" status={pendingPhoto.status} moderationStatus={pendingPhoto.moderationStatus}
        disabled={busy || cropping} onBusyChange={setBusy} onRetried={({ profile }) => { if (profile) onProfileChange?.(profile); }} /> : null}
      <p className="dancer-main-photo-status" role="status" aria-live="polite">{busy ? "" : status}</p>
    </div>
    <DancerMediaUploadRules kind="photo" />
  </section>;
}
