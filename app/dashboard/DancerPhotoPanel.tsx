"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_DANCER_PROFILE_PHOTOS } from "@/src/lib/dancr/media-limits";
import { mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import DancerMediaPinButton from "./DancerMediaPinButton";
import { requestDancerMediaPin } from "./dashboard-session";
import { readSession, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";
import type { LoadState, DancerPhotoItem, DancerPhotoQueueItem } from "./dashboard-types";
import { DANCER_PHOTOS_KEEP_OPEN_EVENT } from "./DashboardShared";
export function DancerPhotoPanel({
  uploadOnly = false,
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  onDeletedPhotoIdsChange,
  onDeletedPhotoStoragePathsChange,
  onProfileChange,
  profile,
}: {
  uploadOnly?: boolean;
  deletedPhotoIds?: string[];
  deletedPhotoStoragePaths?: string[];
  onDeletedPhotoIdsChange?: (deletedPhotoIds: string[]) => void;
  onDeletedPhotoStoragePathsChange?: (deletedPhotoStoragePaths: string[]) => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [photos, setPhotos] = useState<DancerPhotoItem[]>(() =>
    relabelPhotoItems(dancerPhotoItemsFromProfile(profile, deletedPhotoIds)),
  );
  const [queuedPhotos, setQueuedPhotos] = useState<DancerPhotoQueueItem[]>([]);
  const [uploadingQueueItemId, setUploadingQueueItemId] = useState("");
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [pinningPhotoId, setPinningPhotoId] = useState("");
  const [deletingPhotoIds, setDeletingPhotoIds] = useState<Set<string>>(() => new Set());
  const deletedPhotoIdsRef = useRef<string[]>(deletedPhotoIds);
  const deletedPhotoStoragePathsRef = useRef<string[]>(deletedPhotoStoragePaths);
  const galleryPhotoInputRef = useRef<HTMLInputElement>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement>(null);
  const queuedPreviewUrlsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    setPhotos((current) =>
      excludePendingDeletions(
        relabelPhotoItems(preserveConfirmedPhotoPreviews(dancerPhotoItemsFromProfile(profile, deletedPhotoIdsRef.current), current)),
        deletedPhotoIdsRef.current,
      ),
    );
  }, [profile, deletedPhotoIds, deletedPhotoStoragePaths]);

  useEffect(() => () => {
    queuedPreviewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    queuedPreviewUrlsRef.current.clear();
  }, []);

  function queuePhotos(files: File[], source: DancerPhotoQueueItem["source"]) {
    if (actionInFlightRef.current) return;
    window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));
    const waitingCount = queuedPhotos.filter((item) => item.stage !== "complete").length;
    const availableProfileSlots = Math.max(0, MAX_DANCER_PROFILE_PHOTOS - photos.length - waitingCount);
    const selectedFiles = files.slice(0, availableProfileSlots);
    if (!selectedFiles.length) {
      setStatus("Your profile picture library is full. Delete or replace a picture first.");
      return;
    }

    const additions = selectedFiles.map((nextFile) => {
      const previewUrl = URL.createObjectURL(nextFile);
      queuedPreviewUrlsRef.current.add(previewUrl);
      const validType = nextFile.type.startsWith("image/");
      const validSize = nextFile.size > 0 && nextFile.size <= 25 * 1024 * 1024;
      return {
        id: `${nextFile.name}:${nextFile.size}:${nextFile.lastModified}:${crypto.randomUUID()}`,
        file: nextFile,
        previewUrl,
        source,
        stage: validType && validSize ? "queued" : "failed",
        progress: 0,
        error: !validType ? "Choose a JPEG, PNG, WebP, HEIC, or HEIF image." : !nextFile.size ? "That photo is empty. Choose another photo." : !validSize ? "Photos must be 25 MB or smaller." : undefined,
      } satisfies DancerPhotoQueueItem;
    });
    const omitted = files.length - selectedFiles.length;
    setQueuedPhotos((current) => [...current, ...additions]);
    setStatus(`${additions.length} ${additions.length === 1 ? "photo" : "photos"} selected.${omitted ? ` ${omitted} exceeded the available profile slots.` : ""}`);
    const uploadable = additions.filter((item) => !item.error);
    if (uploadable.length) void uploadPhotoBatch(uploadable);
  }

  function updateQueuedPhoto(id: string, changes: Partial<DancerPhotoQueueItem>) {
    setQueuedPhotos((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  function removeQueuedPhoto(id: string) {
    if (actionInFlightRef.current) return;
    setQueuedPhotos((current) => current.filter((item) => {
      if (item.id !== id) return true;
      queuedPreviewUrlsRef.current.delete(item.previewUrl);
      URL.revokeObjectURL(item.previewUrl);
      return false;
    }));
  }

  function beginPhotoAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentPhotoAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishPhotoAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return false;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    return mountedRef.current;
  }

  async function persistQueuedPhotoDeletions(signal: AbortSignal) {
    const idsToDelete = [...deletedPhotoIdsRef.current];
    if (!idsToDelete.length) return;

    setStatus("Saving deleted photos before upload...");
    const data = await requestDancerProfileJson({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deletedPhotoIds: idsToDelete }),
      fallbackMessage: "Unable to save deleted photos before upload.",
      signal,
    });
    if (signal.aborted || !mountedRef.current) return;

    const confirmedIds = new Set((data.deletedPhotoIds || []).map((id: unknown) => String(id)));
    const unconfirmedIds = idsToDelete.filter((id) => !confirmedIds.has(id));
    if (unconfirmedIds.length) {
      throw new Error("The deleted photo slots could not be confirmed. Please try again.");
    }

    deletedPhotoIdsRef.current = [];
    deletedPhotoStoragePathsRef.current = [];
    onDeletedPhotoIdsChange?.([]);
    onDeletedPhotoStoragePathsChange?.([]);
    if (data.profile) onProfileChange?.(data.profile);
  }

  async function uploadPhotoBatch(batch: DancerPhotoQueueItem[]) {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    if (!batch.length) return setStatus("Choose profile photos or take a new photo first.");
    if (photos.length + batch.length > MAX_DANCER_PROFILE_PHOTOS) {
      return setStatus("Your profile picture library is full. Delete or replace a picture before adding more.");
    }
    const action = beginPhotoAction();
    if (!action) return;
    const { requestId, controller } = action;

    setIsUploading(true);
    setStatus(`Preparing ${batch.length} ${batch.length === 1 ? "photo" : "photos"}...`);
    const failedItems: DancerPhotoQueueItem[] = [];
    const rejectedItemIds = new Set<string>();
    const acceptedItemIds = new Set<string>();
    let workingPhotos = [...photos];
    let acceptedCount = 0;
    let rejectedCount = 0;
    let deletionsPersisted = false;
    try {
      for (let index = 0; index < batch.length; index += 1) {
        if (!isCurrentPhotoAction(requestId, controller)) return;
        const item = batch[index];
        let uploadSortOrder = item.uploadSortOrder;
        setUploadingQueueItemId(item.id);
        updateQueuedPhoto(item.id, { stage: "uploading", progress: 5, error: undefined });
        setStatus(`Uploading photo ${index + 1} of ${batch.length}...`);
        try {
          if (workingPhotos.length >= MAX_DANCER_PROFILE_PHOTOS) {
            throw new Error("No profile photo slot is available for this photo.");
          }
          if (!deletionsPersisted) {
            await persistQueuedPhotoDeletions(controller.signal);
            if (!isCurrentPhotoAction(requestId, controller)) return;
            deletionsPersisted = true;
          }
          updateQueuedPhoto(item.id, { stage: "uploading", progress: 25 });
          setStatus(`Checking photo ${index + 1} of ${batch.length}...`);
          uploadSortOrder = uploadSortOrder ?? nextGalleryPhotoSortOrder(workingPhotos);
          const uploadKey = `${item.id}:gallery`;
          updateQueuedPhoto(item.id, { uploadSortOrder });
          const formData = new FormData();
          formData.set("file", item.file);
          formData.set("isPrimary", "false");
          formData.set("replaceExisting", "false");
          formData.set("sortOrder", String(uploadSortOrder));
          formData.set("idempotencyKey", uploadKey);

          const data = await requestDancerPhotosJson({
            method: "POST",
            headers: { "idempotency-key": uploadKey },
            body: formData,
            fallbackMessage: "Unable to upload photo.",
            signal: controller.signal,
          });
          if (!isCurrentPhotoAction(requestId, controller)) return;
          updateQueuedPhoto(item.id, { stage: "checking", progress: 85 });
          const uploadStatus = normalizePhotoStatus(data.photo?.reviewStatus || data.photo?.review_status || data.decision);
          const approved = uploadStatus === "approved";
          const uploadedPhoto: DancerPhotoItem = {
            id: String(data.photo?.id || data.moderationRecordId || `${item.file.name}:${item.file.lastModified}`),
            imageUrl: approved ? String(data.photo?.imageUrl || item.previewUrl) : item.previewUrl,
            label: "Photo",
            status: uploadStatus,
            moderationStatus: String(data.decision || ""),
            note: uploadStatus === "rejected" && typeof data.message === "string" ? data.message : photoStatusNote(uploadStatus),
            storagePath: String(data.photo?.storage_path || ""),
            isPrimary: Boolean(data.photo?.isPrimary || data.photo?.is_primary),
            sortOrder: Number(data.photo?.sortOrder ?? data.photo?.sort_order ?? uploadSortOrder),
          };
          if (uploadStatus === "rejected") {
            rejectedCount += 1;
            rejectedItemIds.add(item.id);
          } else {
            acceptedCount += 1;
            acceptedItemIds.add(item.id);
            workingPhotos = relabelPhotoItems(mergePhotoItems(workingPhotos, [uploadedPhoto]));
            setPhotos(workingPhotos);
          }
          updateQueuedPhoto(item.id, { stage: "complete", progress: 100, result: uploadedPhoto });
        } catch (error) {
          if (!isCurrentPhotoAction(requestId, controller)) return;
          const message = error instanceof Error ? error.message : "Unable to upload photo.";
          const friendlyMessage = message.includes("valid JPEG, PNG, or WebP") || message.includes("HEIC or HEIF")
            ? "That photo could not be converted. Choose another photo or set your phone camera to Most Compatible."
            : message;
          const failedItem = { ...item, uploadSortOrder, stage: "failed" as const, progress: 0, error: friendlyMessage };
          failedItems.push(failedItem);
          updateQueuedPhoto(item.id, failedItem);
        }
      }

      if (acceptedCount) {
        const refreshData = await requestDancerProfileJson({
          cache: "no-store",
          fallbackMessage: "Unable to refresh uploaded photos.",
          signal: controller.signal,
        });
        if (!isCurrentPhotoAction(requestId, controller)) return;
        if (refreshData.profile) {
          const refreshedPhotos = preserveConfirmedPhotoPreviews(dancerPhotoItemsFromProfile(refreshData.profile), workingPhotos);
          // The server identifies which reviews remain pending. A published
          // photo can have a different ID and position from its review record.
          workingPhotos = relabelPhotoItems(refreshedPhotos);
          setPhotos(workingPhotos);
          onProfileChange?.(refreshData.profile);
        }
      }

      if (!isCurrentPhotoAction(requestId, controller)) return;
      if (galleryPhotoInputRef.current) galleryPhotoInputRef.current.value = "";
      if (cameraPhotoInputRef.current) cameraPhotoInputRef.current.value = "";
      const summary = [
        acceptedCount ? `${acceptedCount} uploaded` : "",
        rejectedCount ? `${rejectedCount} not approved` : "",
        failedItems.length ? `${failedItems.length} ready to retry` : "",
      ].filter(Boolean).join(". ");
      setStatus(summary || "No photos were uploaded.");
    } catch (error) {
      if (isCurrentPhotoAction(requestId, controller)) {
        const message = error instanceof Error ? error.message : "Unable to upload photos.";
        const failedById = new Map(failedItems.map((item) => [item.id, item]));
        const batchIds = new Set(batch.map((item) => item.id));
        setQueuedPhotos((current) => current.flatMap((item) => {
          if (rejectedItemIds.has(item.id) || acceptedItemIds.has(item.id)) return [item];
          if (!batchIds.has(item.id)) return [item];
          return [failedById.get(item.id) || { ...item, stage: "failed", progress: 0, error: message }];
        }));
        setStatus(message);
      }
    } finally {
      if (finishPhotoAction(requestId)) {
        setUploadingQueueItemId("");
        setIsUploading(false);
        window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));
      }
    }
  }

  async function pinPhoto(photo: DancerPhotoItem) {
    if (photo.status !== "approved") return;
    const action = beginPhotoAction();
    if (!action) return;
    const { requestId, controller } = action;
    setPinningPhotoId(photo.id);
    setStatus("");
    let saved = false;
    try {
      const result = await requestDancerMediaPin("photo", photo.id, !photo.isPinned, controller.signal);
      if (!isCurrentPhotoAction(requestId, controller)) return;
      saved = true;
      setPhotos((current) => relabelPhotoItems(current.map((item) => item.id === photo.id ? { ...item, isPinned: result.isPinned } : item)));
      const data = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal, fallbackMessage: "Unable to refresh photos." });
      if (!isCurrentPhotoAction(requestId, controller)) return;
      if (!data.profile) throw new Error("Unable to refresh photos.");
      setPhotos(relabelPhotoItems(dancerPhotoItemsFromProfile(data.profile)));
      onProfileChange?.(data.profile);
      setStatus(result.isPinned ? "Photo pinned." : "Photo unpinned.");
    } catch (error) {
      if (isCurrentPhotoAction(requestId, controller)) setStatus(saved ? "Pin saved. Refresh to update your photos." : error instanceof Error ? error.message : "Unable to save the pin. Try again.");
    } finally {
      if (finishPhotoAction(requestId)) setPinningPhotoId("");
    }
  }

  async function deletePhoto(photo: DancerPhotoItem) {
    if (actionInFlightRef.current) return;
    if (!window.confirm("Delete this photo from your profile?")) return;
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    const action = beginPhotoAction();
    if (!action) return;
    const { requestId, controller } = action;

    setDeletingPhotoIds((current) => new Set(current).add(photo.id));
    setStatus("Deleting photo...");
    try {
      await requestDancerPhotosJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId: photo.id }),
        fallbackMessage: "Unable to delete photo.",
        signal: controller.signal,
      });
      if (!isCurrentPhotoAction(requestId, controller)) return;

      setPhotos((current) => relabelPhotoItems(current.filter((item) => item.id !== photo.id)));
      deletedPhotoIdsRef.current = deletedPhotoIdsRef.current.filter((id) => id !== photo.id);
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsChange?.(deletedPhotoIdsRef.current);
      onDeletedPhotoStoragePathsChange?.([]);
      setStatus("Photo deleted permanently.");
      window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));

      const refreshData = await requestDancerProfileJson({
        cache: "no-store",
        fallbackMessage: "Unable to verify the deleted photo.",
        signal: controller.signal,
      });
      if (!isCurrentPhotoAction(requestId, controller)) return;
      if (refreshData.profile) {
        const refreshedPhotos = dancerPhotoItemsFromProfile(refreshData.profile);
        if (refreshedPhotos.some((item) => item.id === photo.id)) {
          throw new Error("The photo could not be permanently deleted. Please try again.");
        }
        setPhotos(relabelPhotoItems(refreshedPhotos));
        onProfileChange?.(refreshData.profile);
      }
    } catch (error) {
      if (isCurrentPhotoAction(requestId, controller)) {
        setStatus(error instanceof Error ? error.message : "Unable to delete photo.");
      }
    } finally {
      if (finishPhotoAction(requestId)) {
        setDeletingPhotoIds((current) => {
          const next = new Set(current);
          next.delete(photo.id);
          return next;
        });
      }
    }
  }

  const photoActionBusy = isUploading || Boolean(pinningPhotoId) || deletingPhotoIds.size > 0;
  // The uploader owns its session history; closing the modal unmounts it.
  // The full manager already displays accepted photos in its saved library.
  const visibleQueuedPhotos = queuedPhotos.filter((item) => uploadOnly || item.stage !== "complete" || item.result?.status === "rejected");

  return (
    <article aria-label="Profile photo manager" className="info-panel upload-panel">
      <div className="dancer-photo-upload-form">
        <div className="photo-upload-heading">
          <span><strong>Add at least 1 solo picture of yourself. You can add more later.</strong></span>
        </div>
        <div className="photo-source-grid">
          <label className={`photo-source-action${photoActionBusy ? " is-disabled" : ""}`}>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              aria-label="Choose profile photos from your library"
              className="photo-source-input"
              disabled={photoActionBusy}
              multiple
              ref={galleryPhotoInputRef}
              type="file"
              onChange={(event) => {
                queuePhotos(Array.from(event.target.files || []), "gallery");
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4zM7 15l3-3 2.5 2.5L15 12l3 3" /><circle cx="16.5" cy="9" r="1" /></svg>
            </span>
            <span className="photo-source-copy">
              <strong>Gallery</strong>
              <small>Choose solo photos of yourself</small>
            </span>
            <span className="photo-source-cta" aria-hidden="true">Choose</span>
          </label>
          <label className={`photo-source-action${photoActionBusy ? " is-disabled" : ""}`}>
            <input
              accept="image/*"
              aria-label="Take a new profile photo"
              capture="environment"
              className="photo-source-input"
              disabled={photoActionBusy}
              ref={cameraPhotoInputRef}
              type="file"
              onChange={(event) => {
                queuePhotos(Array.from(event.target.files || []), "camera");
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 8h3l1.5-2h5L16 8h3v10H5z" /><circle cx="12" cy="13" r="3" /></svg>
            </span>
            <span className="photo-source-copy">
              <strong>Camera</strong>
              <small>Take a solo photo now</small>
            </span>
            <span className="photo-source-cta" aria-hidden="true">Open</span>
          </label>
        </div>
        {status ? <p className="photo-upload-status" role="status" aria-live="polite">{status}</p> : null}
      </div>
      {visibleQueuedPhotos.length ? (
        <div className="photo-upload-queue" aria-label="Photos from this upload session">
          {visibleQueuedPhotos.map((item, index) => {
            const result = item.result && (photos.find((photo) => photo.id === item.result?.id) || item.result);
            return (
              <div className={`photo-review-card is-${result?.status || "pending"} ${uploadingQueueItemId === item.id && item.stage !== "complete" ? "is-uploading" : ""}`.trim()} key={item.id}>
                <div className="photo-preview" style={{ backgroundImage: `url(${item.previewUrl})` }} />
                <span>
                  <strong>{`Selected photo ${index + 1}`}</strong>
                  <small>{result ? photoStatusLabel(result.status, result.moderationStatus) : item.stage === "uploading" ? "Uploading" : item.stage === "checking" ? "Checking" : item.error ? "Upload failed" : "Waiting to upload"}</small>
                  {item.stage !== "failed" && item.stage !== "complete" ? <progress aria-label={`Photo ${index + 1} upload progress`} max="100" value={item.progress} /> : null}
                  {result?.note ? <em>{result.note}</em> : null}
                  {item.error ? <em>{item.error}</em> : null}
                  {!result ? <span className="photo-queue-actions">
                    {item.error ? <button className="photo-retry-button" disabled={photoActionBusy} onClick={() => void uploadPhotoBatch([{ ...item, stage: "queued", progress: 0, error: undefined }])} type="button">Retry</button> : null}
                    <button className="photo-delete-button" disabled={photoActionBusy} onClick={() => removeQueuedPhoto(item.id)} type="button">Remove</button>
                  </span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {!uploadOnly && photos.length ? (
        <div className="dancer-media-manager-title">
          <strong>Your photos</strong>
          <span>{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
        </div>
      ) : null}
      {!uploadOnly ? <div className="photo-review-list compact-photo-previews" aria-label="Uploaded photos">
        {photos.map((photo) => {
          return (
            <div className={`photo-saved-preview is-${photo.status}`} key={photo.id}>
              <div className="photo-saved-frame">
                {photo.imageUrl ? <img alt={photo.label} loading="lazy" src={photo.imageUrl} /> : <span aria-hidden="true">▧</span>}
                {photo.isPinned ? <svg className="dancer-photo-pin-indicator" role="img" aria-label="Pinned photo" viewBox="0 0 24 24"><path d="m16 3 5 5-4 1-3 5-4-4 5-3 1-4Z" /><path d="m9 9 6 6M12 12l-7 7" /></svg> : null}
                <DancerMediaPinButton label={photo.label.toLowerCase()} available={photo.status === "approved"} pinned={photo.isPinned} busy={pinningPhotoId === photo.id} disabled={photoActionBusy} onClick={() => void pinPhoto(photo)} />
                <button
                  aria-label={`${deletingPhotoIds.has(photo.id) ? "Deleting" : "Delete"} ${photo.label.toLowerCase()}`}
                  aria-busy={deletingPhotoIds.has(photo.id)}
                  className="photo-card-remove-action"
                  type="button"
                  disabled={photoActionBusy}
                  onClick={() => deletePhoto(photo)}
                >
                  <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></span>
                </button>
              </div>
              <strong>{photo.label}</strong>
              <small>{photoStatusLabel(photo.status, photo.moderationStatus)}</small>
            </div>
          );
        })}
      </div> : null}
    </article>
  );
}


export function dancerPhotoItemsFromProfile(
  profile: LoadState["profile"],
  excludedPhotoIds: string[] = [],
): DancerPhotoItem[] {
  const approvedPhotos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const pendingReviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews as Array<Record<string, unknown>> : [];

  const approvedItems = approvedPhotos.flatMap<DancerPhotoItem>((photo) => {
    const id = String(photo.id || "").trim();
    if (!id) return [];
    const reviewStatus = normalizePhotoStatus(photo.review_status || photo.reviewStatus || "approved");
    const isPrimary = Boolean(photo.is_primary || photo.isPrimary);
    return [{
      id,
      imageUrl: String(photo.imageUrl || photo.image_url || ""),
      label: "Photo",
      status: reviewStatus,
      note: photoStatusNote(reviewStatus),
      storagePath: String(photo.storage_path || photo.storagePath || ""),
      isPrimary,
      sortOrder: Number(photo.sort_order ?? photo.sortOrder ?? 0),
      isPinned: photo.is_pinned === true || photo.isPinned === true,
    }];
  });

  const pendingItems = pendingReviews.flatMap<DancerPhotoItem>((review) => {
    const id = String(review.id || "").trim();
    if (!id) return [];
    const isPrimary = Boolean(review.is_primary || review.isPrimary || String(review.upload_context || "").includes("main"));
    return [{
      id,
      imageUrl: String(review.previewUrl || review.preview_url || ""),
      label: "Photo",
      status: "pending",
      moderationStatus: String(review.status || ""),
      note: photoStatusNote("pending"),
      storagePath: String(review.temporary_storage_path || review.storagePath || ""),
      isPrimary,
      sortOrder: Number(review.sort_order ?? review.sortOrder ?? (isPrimary ? 0 : 0)),
    }];
  });

  return mergePhotoItems(excludePendingDeletions([approvedItems, pendingItems].flat(), excludedPhotoIds));
}


function excludePendingDeletions(incomingPhotos: DancerPhotoItem[], pendingDeletedIds: string[]) {
  const deleted = new Set(pendingDeletedIds);
  return incomingPhotos.filter((photo) => !deleted.has(photo.id));
}


function nextGalleryPhotoSortOrder(photos: DancerPhotoItem[]) {
  const used = new Set(
    photos
      .filter((photo) => !photo.isPrimary)
      .map((photo) => Number(photo.sortOrder))
      .filter((sortOrder) => Number.isInteger(sortOrder) && sortOrder > 0),
  );
  for (let sortOrder = 1; sortOrder <= MAX_DANCER_PROFILE_PHOTOS; sortOrder += 1) {
    if (!used.has(sortOrder)) return sortOrder;
  }
  return MAX_DANCER_PROFILE_PHOTOS;
}


function preserveConfirmedPhotoPreviews(incomingPhotos: DancerPhotoItem[], currentPhotos: DancerPhotoItem[]) {
  const currentById = new Map(currentPhotos.map((photo) => [photo.id, photo]));
  return incomingPhotos.map((photo) => {
    const current = currentById.get(photo.id);
    if (photo.imageUrl || !current?.imageUrl) return photo;
    return { ...photo, imageUrl: current.imageUrl };
  });
}


function primaryPhotoIdFromProfile(profile: LoadState["profile"]) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const primary = photos.find((photo) => photo.is_primary || photo.isPrimary);
  return primary?.id || null;
}


function mergePhotoItems(...groups: DancerPhotoItem[][]) {
  const byId = new Map(groups.flat().map((photo) => [photo.id, photo]));
  const byKey = new Map<string, DancerPhotoItem>();
  byId.forEach((photo) => {
    const sortOrder = Number(photo.sortOrder);
    const key = photo.status === "pending"
      ? `photo:${photo.id}`
      : photo.isPrimary
      ? "main"
      : Number.isInteger(sortOrder) && sortOrder > 0
        ? `gallery:${sortOrder}`
        : `photo:${photo.id}`;
    byKey.set(key, photo);
  });
  return Array.from(byKey.values());
}


export function relabelPhotoItems(items: DancerPhotoItem[]) {
  return orderPhotoItemsForDisplay(mergePhotoItems(items)).map((photo, index) => {
    return { ...photo, label: `Photo ${index + 1}` };
  });
}


function orderPhotoItemsForDisplay(items: DancerPhotoItem[]) {
  const primary = items.find((photo) => photo.isPrimary);
  const gallery = items
    .filter((photo) => photo !== primary)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  return (primary ? [primary, ...gallery] : gallery).sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));
}


function normalizePhotoStatus(value: unknown): DancerPhotoItem["status"] {
  const status = String(value || "").toLowerCase();
  if (status === "approved" || status === "live") return "approved";
  if (status === "rejected" || status === "denied") return "rejected";
  return "pending";
}


function photoStatusLabel(status: DancerPhotoItem["status"], moderationStatus?: string) {
  return mediaReviewLabel(status, moderationStatus);
}


function photoStatusNote(status: DancerPhotoItem["status"]) {
  if (status === "rejected") return "Choose another photo.";
  return "";
}


function photoUploadStatusMessage(status: DancerPhotoItem["status"], message?: unknown) {
  const detail = typeof message === "string" && message.trim() ? message.trim() : photoStatusNote(status);
  if (status === "approved") return `Approved: ${detail}`;
  if (status === "rejected") return `Choose another photo: ${detail}`;
  return `Checking: ${detail}`;
}
