"use client";

import { useEffect, useRef, useState } from "react";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import type { LoadState } from "./dashboard-types";
import { mediaClubRejection, type ClubMediaStatus } from "@/src/lib/dancr/club-media-status";
import { uploadMainProfilePhoto } from "./main-profile-photo-upload";
import { photoUploadPercent } from "./photo-upload-progress";
import { mediaUploadError } from "./media-upload-feedback";
import { DancerUploadsSavedNotice, usePendingUploadNotice } from "./DancerUploadFeedback";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerChooseMainPhoto from "./DancerChooseMainPhoto";
import DancerPhotoControls from "./DancerPhotoControls";
import DancerMediaRetryButton from "./DancerMediaRetryButton";
import DancerMediaUploadRules from "./DancerMediaUploadRules";
import { isAwaitingClubApproval, mediaRejectionLabel, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { readSession, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";
import "../../public/dancer-main-photo.css";
import "./dancer-upload-queue.css";

export function DancerMainPhotoPanel({ profile, onProfileChange, onBusyChange, showRules = true, clubStatuses = [] }: {
  clubStatuses?: ClubMediaStatus[];
  showRules?: boolean;
  onBusyChange?: (busy: boolean) => void;
  profile?: LoadState["profile"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
}) {
  const photos = dancerPhotoItemsFromProfile(profile);
  const main = photos.find(photo => photo.isPrimary && photo.status === "approved");
  const pendingPhoto = photos.find(photo => photo.isPrimary && photo.status === "pending");
  const displayed = pendingPhoto || main;
  const clubRejection = mediaClubRejection(clubStatuses, displayed?.id);
  const pending = Boolean(pendingPhoto);
  const awaitingClubApproval = Boolean(!clubRejection && pendingPhoto && isAwaitingClubApproval(pendingPhoto.status, pendingPhoto.moderationStatus));
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
  usePendingUploadNotice("main", Boolean(selection.current) || busy || cropping);

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
          if (!cancelRequested.current) setStatus("Uploading");
        },
      });
      if (controller.signal.aborted) return;
      selection.current = null;
      if (!result) { setUploadPercent(null); setStatus("Crop canceled. Your main photo hasn’t changed."); return; }
      setUploadPercent(result.decision === "canceled" ? null : photoUploadPercent(undefined, {
        status: ["approved", "rejected"].includes(result.decision) ? result.decision : "pending", moderationStatus: result.decision,
      }));
      if (result.profile) onProfileChange?.(result.profile);
      const message = result.decision === "canceled" ? "Upload canceled." : result.decision === "rejected" ? mediaRejectionLabel("photo") : "";
      setStatus([message, result.replacementWarning, result.refreshFailed ? "Photo uploaded. Reload the dashboard to see its latest status." : ""].filter(Boolean).join(" "));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (cancelRequested.current || error instanceof Error && error.name === "AbortError") selection.current = null;
      else setRetry(true);
      setStatus(mediaUploadError(error, "photo"));
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
  const needsAttention = !busy && (Boolean(clubRejection) || retry || reviewDelayed);

  return <section className="dancer-main-photo-panel" aria-label="Main profile photo" aria-busy={busy || cropping}>
    <button className="dancer-main-photo-preview dancer-photo-edit-target" data-empty={!displayed} data-needs-attention={needsAttention || undefined} type="button" disabled={busy || cropping || awaitingClubApproval}
      aria-label={awaitingClubApproval ? "Main photo awaiting final approval" : displayed ? "Edit main photo" : "Add main photo"} onClick={() => displayed ? setEditRequested(value => value + 1) : input.current?.click()}>
      {displayed?.imageUrl ? <img src={displayed.imageUrl} alt={pending ? "Main photo awaiting review" : "Current main profile photo"} /> : pending ? <span>Main photo awaiting review</span> : <span className="dancer-main-photo-placeholder">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v10H3V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="3" /></svg>
        <span>Add main photo</span>
      </span>}
    </button>
    <div className="dancer-main-photo-copy">
      <h3>Main photo</h3>
      <p>Shown on your dancer card and profile. Your avatar is created automatically.</p>
      {overallPercent !== null && overallPercent < 100 ? <div className="dancer-upload-overall" data-needs-attention={retry || reviewDelayed || undefined}>
        <strong>{retry || reviewDelayed ? "Upload needs attention" : "Uploading"} · {overallPercent}%</strong>
        <span className="dancer-upload-progress" role="progressbar" aria-label="Main photo upload progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallPercent}>
          <span style={{ width: `${overallPercent}%` }} />
        </span>
      </div> : null}
      <strong className="dancer-main-photo-state" role="status" aria-live="polite" data-needs-attention={needsAttention || undefined} data-state={busy ? "pending" : clubRejection ? "rejected" : displayed?.status || "required"}>{busy ? ["Removing photo…", "Canceling…"].includes(status) ? status : "Uploading" : clubRejection || (displayed ? mediaReviewLabel(displayed.status, displayed.moderationStatus) : "Required")}</strong>
      {clubRejection ? <small className="dancer-media-rejection-help">Choose a different main photo for this club. Your avatar updates automatically.</small> : null}
      <DancerUploadsSavedNotice saved={Boolean(!clubRejection && pendingPhoto && !reviewDelayed && !busy && !cropping && !retry)} />
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Upload main profile photo" hidden disabled={busy || cropping || awaitingClubApproval} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="dancer-main-photo-actions">
        {busy && selection.current ? <button type="button" disabled={cancelRequested.current} onClick={cancelUpload}>{cancelRequested.current ? "Canceling…" : "Cancel"}</button>
          : pending && !awaitingClubApproval && !clubRejection ? <button type="button" disabled={busy || cropping} onClick={() => void remove(true)}>Cancel</button> : null}
        {awaitingClubApproval ? <button type="button" aria-label="Remove pending main photo" disabled={busy || cropping} onClick={() => void remove()}>Remove</button> : <DancerPhotoControls label="main photo" compact hidden={!displayed} openRequested={editRequested} disabled={busy || cropping} primary={
          <button type="button" aria-label={pending ? "Replace main photo" : displayed ? "Change main photo" : "Add main photo"} disabled={busy || cropping} onClick={() => input.current?.click()}>{busy ? "Updating…" : pending ? "Replace" : displayed ? "Change" : "Add"}</button>
        }>
          {displayed ? <>
            {displayed.status === "approved" ? <DancerSavedPhotoCrop key={displayed.id} photo={displayed} disabled={busy || pending} onBusyChange={setCropping} onProfileChange={onProfileChange} /> : null}
            <button type="button" disabled={busy || cropping} onClick={() => void remove()}>{pending ? "Remove pending photo" : "Remove main photo"}</button>
          </> : null}
        </DancerPhotoControls>}
      </div>
      {!pending && photos.some(photo => photo.status === "approved" && photo.id !== main?.id) ? <details className="dancer-saved-photo-picker" open={!main}>
        <summary>Choose an approved main photo</summary>
        <div className="dancer-saved-photo-choices">
          {photos.filter(photo => photo.status === "approved" && photo.id !== main?.id).map((photo, index) => <DancerChooseMainPhoto
            key={photo.id} photo={photo} mainPhotoId={main?.id} disabled={busy || cropping}
            onBusyChange={setCropping} onProfileChange={onProfileChange} label={`Use approved photo ${index + 1} as main photo`}
            thumbnail={<img src={photo.imageUrl} alt={`Approved photo ${index + 1}`} />} />)}
        </div>
      </details> : null}
      {retry && !awaitingClubApproval ? <button type="button" disabled={busy} onClick={() => void upload()}>Retry main photo upload</button> : null}
      {pendingPhoto && reviewDelayed ? <DancerMediaRetryButton id={pendingPhoto.id} kind="photo" status={pendingPhoto.status} moderationStatus={pendingPhoto.moderationStatus}
        disabled={busy || cropping} onBusyChange={setBusy} onRetried={({ profile }) => { if (profile) onProfileChange?.(profile); }} /> : null}
      <p className="dancer-main-photo-status" role="status" aria-live="polite">{busy ? "" : status}</p>
    </div>
    {showRules ? <DancerMediaUploadRules kind="photo" /> : null}
  </section>;
}
