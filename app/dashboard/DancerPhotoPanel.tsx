"use client";
import RefreshButton from "../components/RefreshButton";

import { useEffect, useRef, useState, type ReactNode } from "react";
import DancerUploadDisclosure from "./DancerUploadDisclosure";
import { MAX_DANCER_PROFILE_PHOTOS, MIN_DANCER_ONBOARDING_PHOTOS } from "@/src/lib/dancr/media-limits";
import DancerMediaUploadRules from "./DancerMediaUploadRules";
import { isAwaitingClubApproval, mediaReviewExplanation, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import DancerMediaPinButton from "./DancerMediaPinButton";
import DancerMediaRetryButton from "./DancerMediaRetryButton";
import DancerRejectedUploadNotice from "./DancerRejectedUploadNotice";
import { requestDancerMediaPin } from "./dashboard-session";
import { readSession, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";
import type { LoadState, DancerPhotoItem, DancerPhotoQueueItem } from "./dashboard-types";
import { DANCER_PHOTOS_KEEP_OPEN_EVENT } from "./DashboardShared";
import { preparePhotoUpload } from "./prepare-photo-upload";
import { cropProfilePhoto } from "./profile-photo-crop";
import { createPhotoCropQueue } from "./photo-upload-crop-queue";
import { MEDIA_UPLOAD_CONCURRENCY, runMediaUploadBatch } from "./media-upload-batch";
import { createMediaUploadCancellation } from "./media-upload-cancellation";
import { mediaBatchSummary, mediaUploadError } from "./media-upload-feedback";
import { DancerUploadProgress, DancerUploadSummary, usePendingUploadNotice } from "./DancerUploadFeedback";
import DancerPhotoBatchChoice from "./DancerPhotoBatchChoice";
import DancerPendingMediaGrid from "./DancerPendingMediaGrid";
import { keepDefaultPhotoCrop } from "./default-photo-crop";
import "./dancer-upload-queue.css";
export function DancerPhotoPanel({
  uploadOnly = false,
  showRules = true,
  automaticMain = false,
  mainPhotoAccessory,
  onBusyChange,
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  onDeletedPhotoIdsChange,
  onDeletedPhotoStoragePathsChange,
  onProfileChange,
  profile,
}: {
  uploadOnly?: boolean;
  showRules?: boolean;
  automaticMain?: boolean;
  mainPhotoAccessory?: ReactNode;
  onBusyChange?: (busy: boolean) => void;
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
  const [uploadBatchIds, setUploadBatchIds] = useState<string[]>([]);
  const [cropBatchIds, setCropBatchIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [cancelingUploads, setCancelingUploads] = useState(false);
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(() => new Set());
  const uploadCancellationRef = useRef<ReturnType<typeof createMediaUploadCancellation> | null>(null);
  const [pinningPhotoId, setPinningPhotoId] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retiredReviewIds, setRetiredReviewIds] = useState<Set<string>>(() => new Set());
  const [confirmedPhotoIds, setConfirmedPhotoIds] = useState<Set<string>>(() => new Set());
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
  const dismissedRejectionsRef = useRef<Set<string>>(new Set());

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
    const refreshed = dancerPhotoItemsFromProfile(profile, deletedPhotoIdsRef.current);
    setQueuedPhotos(current => current.map(item => {
      const result = refreshed.find(photo => photo.id === item.result?.id);
      return result ? { ...item, result } : item;
    }));
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

  function queuePhotos(files: File[], source: DancerPhotoQueueItem["source"], replaces?: DancerPhotoQueueItem["replaces"]) {
    if (actionInFlightRef.current || cropBatchIds.length) return;
    window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));
    const waitingCount = queuedPhotos.filter((item) => item.stage !== "complete").length;
    const availableProfileSlots = replaces ? 1 : Math.max(0, MAX_DANCER_PROFILE_PHOTOS - photos.length - waitingCount);
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
        replaces,
        stage: validType && validSize ? "queued" : "failed",
        progress: 0,
        error: !validType ? "Choose a JPEG, PNG, WebP, HEIC, or HEIF image." : !nextFile.size ? "That photo is empty. Choose another photo." : !validSize ? "Photos must be 25 MB or smaller." : undefined,
      } satisfies DancerPhotoQueueItem;
    });
    const omitted = files.length - selectedFiles.length;
    const uploadable = additions.filter((item) => !item.error);
    for (const item of additions.filter(item => item.error)) {
      URL.revokeObjectURL(item.previewUrl); queuedPreviewUrlsRef.current.delete(item.previewUrl);
    }
    setUploadBatchIds(uploadable.map(item => item.id));
    setQueuedPhotos((current) => [...current, ...uploadable]);
    if (uploadable.length > 1) setCropBatchIds(uploadable.map(item => item.id));
    else if (uploadable.length) void uploadPhotoBatch(uploadable);
    setStatus([...new Set(additions.flatMap(item => item.error ? [item.error] : [])),
      omitted ? `${omitted} exceeded the available profile slots.` : ""].filter(Boolean).join(" "));
  }

  function confirmBatchCrops(keepAll: boolean) {
    const batch = queuedPhotos.filter(item => cropBatchIds.includes(item.id));
    setCropBatchIds([]);
    void uploadPhotoBatch(batch, keepAll);
  }

  function cancelBatchCrops() {
    const ids = new Set(cropBatchIds);
    setQueuedPhotos(current => current.filter(item => {
      if (!ids.has(item.id)) return true;
      URL.revokeObjectURL(item.previewUrl); queuedPreviewUrlsRef.current.delete(item.previewUrl);
      return false;
    }));
    setUploadBatchIds(current => current.filter(id => !ids.has(id)));
    setCropBatchIds([]); setStatus("");
  }

  function updateQueuedPhoto(id: string, changes: Partial<DancerPhotoQueueItem>) {
    setQueuedPhotos((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  function reviewRetried(id: string, data: { profile?: Record<string, unknown>; result: any }) {
    const updateResult = (photo: DancerPhotoItem): DancerPhotoItem => ({
      ...photo, id: String(data.result.photo?.id || id), status: normalizePhotoStatus(data.result.decision),
      moderationStatus: data.result.decision,
      note: mediaReviewExplanation("photo", normalizePhotoStatus(data.result.decision), { moderationStatus: data.result.decision, reasonCodes: data.result.reasonCodes, message: data.result.message }),
    });
    if (data.profile) {
      confirmLibraryPhotos(data.profile);
      setPhotos(relabelPhotoItems(dancerPhotoItemsFromProfile(data.profile)));
      onProfileChange?.(data.profile);
    } else {
      setPhotos(current => current.map(photo => photo.id === id ? updateResult(photo) : photo));
    }
    setQueuedPhotos(current => current.map(item => item.result?.id === id ? { ...item, result: updateResult(item.result) } : item));
  }

  function confirmLibraryPhotos(nextProfile: Record<string, unknown>) {
    const approved = dancerPhotoItemsFromProfile(nextProfile).filter(photo => photo.status === "approved");
    setConfirmedPhotoIds(current => new Set([...current, ...approved.map(photo => photo.id)]));
  }

  async function refreshPhotoLibrary() {
    const action = beginPhotoAction();
    if (!action) return;
    const { requestId, controller } = action;
    setRetrying(true);
    try {
      const data = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal, fallbackMessage: "Unable to refresh your library. Try again." });
      if (!isCurrentPhotoAction(requestId, controller) || !data.profile) return;
      confirmLibraryPhotos(data.profile);
      setPhotos(relabelPhotoItems(dancerPhotoItemsFromProfile(data.profile)));
      onProfileChange?.(data.profile);
      setStatus("");
    } catch (error) {
      if (isCurrentPhotoAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to refresh your library. Try again.");
    } finally {
      if (finishPhotoAction(requestId)) setRetrying(false);
    }
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

  async function discardPhotoUpload(item?: DancerPhotoQueueItem, result?: DancerPhotoItem) {
    if (result) await requestDancerPhotosJson({ method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoId: result.id }), fallbackMessage: "Unable to cancel photo. Try again." });
    if (!mountedRef.current) return;
    if (result) {
      setPhotos(current => current.filter(photo => photo.id !== result.id));
      setRetiredReviewIds(current => new Set(current).add(result.id));
    }
    setQueuedPhotos(current => current.filter(queued => {
      if (queued.id !== item?.id && (!result || queued.result?.id !== result.id)) return true;
      queuedPreviewUrlsRef.current.delete(queued.previewUrl); URL.revokeObjectURL(queued.previewUrl); return false;
    }));
  }

  async function cancelPhotoUpload(item?: DancerPhotoQueueItem, result?: DancerPhotoItem) {
    const id = item?.id || result!.id;
    setCancelingIds(current => new Set(current).add(id));
    if (item && ["queued", "preparing", "cropping", "uploading", "checking"].includes(item.stage) && uploadCancellationRef.current) {
      uploadCancellationRef.current.cancelOne(item.id);
      if (item.stage === "queued") await discardPhotoUpload(item);
      return;
    }
    try { await discardPhotoUpload(item, result); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Unable to cancel photo. Try again."); }
    finally { setCancelingIds(current => { const next = new Set(current); next.delete(id); return next; }); }
  }

  function dismissRejectedPhoto(id: string) {
    dismissedRejectionsRef.current.add(id);
    setRetiredReviewIds(current => new Set(current).add(id));
    setPhotos(current => current.filter(photo => photo.id !== id));
    setQueuedPhotos(current => current.filter(item => {
      if (item.result?.id !== id) return true;
      queuedPreviewUrlsRef.current.delete(item.previewUrl);
      URL.revokeObjectURL(item.previewUrl);
      return false;
    }));
    if (profile) onProfileChange?.({ ...profile,
      rejected_photo_reviews: (Array.isArray(profile.rejected_photo_reviews) ? profile.rejected_photo_reviews : []).filter((review: Record<string, unknown>) => !dismissedRejectionsRef.current.has(String(review.id))),
      dancer_photos: (Array.isArray(profile.dancer_photos) ? profile.dancer_photos : []).filter((photo: Record<string, unknown>) => !dismissedRejectionsRef.current.has(String(photo.id))),
    });
    setStatus(current => /not approved/.test(current) ? "" : current);
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

  async function uploadPhotoBatch(batch: DancerPhotoQueueItem[], keepAllCrops = false) {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    if (!batch.length) return setStatus("Choose profile photos or take a new photo first.");
    if (photos.length + batch.filter(item => !item.replaces).length > MAX_DANCER_PROFILE_PHOTOS) {
      return setStatus("Your profile picture library is full. Delete or replace a picture before adding more.");
    }
    const action = beginPhotoAction();
    if (!action) return;
    const { requestId, controller } = action;

    setIsUploading(true);
    setCancelingUploads(false);
    const cancellation = createMediaUploadCancellation(controller.signal);
    const cropNext = createPhotoCropQueue();
    uploadCancellationRef.current = cancellation;
    setStatus("");
    const failedItems: DancerPhotoQueueItem[] = [];
    const cropErrors: string[] = [];
    const rejectedItemIds = new Set<string>();
    const acceptedItemIds = new Set<string>();
    let workingPhotos = [...photos];
    let acceptedCount = 0;
    let rejectedCount = 0;
    // Reserve distinct positions before requests overlap, including positions retained by retries.
    let nextSortOrder = Math.max(nextGalleryPhotoSortOrder(workingPhotos), ...batch.map(item => (item.uploadSortOrder ?? -1) + 1));
    // Reserve the main slot before concurrent uploads start; retries retain it.
    const mainCandidate = automaticMain && !workingPhotos.some(photo => photo.isPrimary && photo.status !== "rejected")
      ? batch.find(item => item.uploadSortOrder === 0) || batch.find(item => item.uploadSortOrder === undefined) : undefined;
    try {
      await persistQueuedPhotoDeletions(controller.signal);
      await runMediaUploadBatch(batch, batch.some(item => item.replaces) ? 1 : MEDIA_UPLOAD_CONCURRENCY, async (queuedItem, index) => {
        if (!isCurrentPhotoAction(requestId, controller)) return;
        const transfer = cancellation.start(queuedItem.id);
        if (!transfer) {
          if (!queuedItem.cropConfirmed || cancellation.isCanceled(queuedItem.id)) { await discardPhotoUpload(queuedItem); return; }
          updateQueuedPhoto(queuedItem.id, { stage: "failed", progress: 0, error: "Upload canceled." });
          return;
        }
        let item = queuedItem;
        const uploadSortOrder = item.uploadSortOrder ?? (item.id === mainCandidate?.id ? 0 : nextSortOrder++);
        updateQueuedPhoto(item.id, { stage: "preparing", progress: 0, uploadSortOrder, error: undefined });
        try {
          if (!item.file.type.startsWith("image/") || !item.file.size || item.file.size > 25 * 1024 * 1024) {
            throw new Error("Choose a photo between 1 byte and 25 MB.");
          }
          if (!item.cropConfirmed) {
            const assertCurrent = () => {
              transfer.signal.throwIfAborted();
              const currentSession = readSession();
              if (!isCurrentPhotoAction(requestId, controller) || !currentSession?.accessToken || currentSession.account?.id !== session.account?.id) {
                throw new DOMException("Photo selection closed. Sign in again to upload.", "AbortError");
              }
            };
            const cropped = await cropNext(async () => {
              assertCurrent();
              if (keepAllCrops) return keepDefaultPhotoCrop(item.file, transfer.signal);
              updateQueuedPhoto(item.id, { stage: "cropping" });
              return cropProfilePhoto(item.file, transfer.signal, assertCurrent, 9 / 16, undefined, undefined, {
                position: index + 1, total: batch.length,
                onCancelBatch: () => { cancellation.cancel(); setCancelingUploads(true); },
              });
            }, transfer.signal);
            assertCurrent();
            if (!cropped) { await discardPhotoUpload(item); return; }
            const previewUrl = cropped === item.file ? item.previewUrl : URL.createObjectURL(cropped);
            if (previewUrl !== item.previewUrl) {
              queuedPreviewUrlsRef.current.add(previewUrl);
              queuedPreviewUrlsRef.current.delete(item.previewUrl);
              URL.revokeObjectURL(item.previewUrl);
            }
            item = { ...item, file: cropped, previewUrl, cropConfirmed: true };
            updateQueuedPhoto(item.id, { file: cropped, previewUrl, cropConfirmed: true, stage: "preparing" });
          }
          if (item.replaces) {
            const { photoId, queueId } = item.replaces;
            if (photoId) {
              await requestDancerPhotosJson({ method: "DELETE", headers: { "content-type": "application/json" },
                body: JSON.stringify({ photoId }), signal: transfer.signal, fallbackMessage: "Unable to replace this photo. Try again." });
              if (!isCurrentPhotoAction(requestId, controller)) return;
              workingPhotos = workingPhotos.filter(photo => photo.id !== photoId);
              setPhotos(workingPhotos);
              setRetiredReviewIds(current => new Set(current).add(photoId));
            }
            setQueuedPhotos(current => current.filter(queued => queued.id !== queueId));
            item = { ...item, replaces: undefined };
            updateQueuedPhoto(item.id, { replaces: undefined });
          }
          if (workingPhotos.length >= MAX_DANCER_PROFILE_PHOTOS) {
            throw new Error("No profile photo slot is available for this photo.");
          }
          const file = await preparePhotoUpload(item.file, transfer.signal);
          if (!isCurrentPhotoAction(requestId, controller)) return;
          transfer.signal.throwIfAborted();
          updateQueuedPhoto(item.id, { stage: "uploading", progress: 0 });
          const uploadKey = `${item.id}:gallery`;
          const formData = new FormData();
          formData.set("file", file);
          formData.set("isPrimary", String(automaticMain && uploadSortOrder === 0));
          formData.set("replaceExisting", "false");
          formData.set("sortOrder", String(uploadSortOrder));
          formData.set("idempotencyKey", uploadKey);

          const data = await requestDancerPhotosJson({
            method: "POST",
            headers: { "idempotency-key": uploadKey },
            body: formData,
            fallbackMessage: "Unable to upload photo.",
            signal: transfer.signal,
            onUploadProgress: progress => {
              if (!isCurrentPhotoAction(requestId, controller) || transfer.signal.aborted) return;
              if (progress === 100) transfer.beginReview();
              updateQueuedPhoto(item.id, {
                progress, stage: progress === 100 ? "checking" : "uploading",
              });
            },
          });
          if (!isCurrentPhotoAction(requestId, controller)) return;
          transfer.signal.throwIfAborted();
          const uploadStatus = normalizePhotoStatus(data.photo?.reviewStatus || data.photo?.review_status || data.decision);
          const approved = uploadStatus === "approved";
          const uploadedPhoto: DancerPhotoItem = {
            id: String(data.photo?.id || data.moderationRecordId || `${item.file.name}:${item.file.lastModified}`),
            imageUrl: approved ? String(data.photo?.imageUrl || item.previewUrl) : item.previewUrl,
            label: "Photo",
            status: uploadStatus,
            moderationStatus: String(data.decision || ""),
            note: mediaReviewExplanation("photo", uploadStatus, { moderationStatus: data.decision, reasonCodes: data.reasonCodes, message: data.message }),
            storagePath: String(data.photo?.storage_path || ""),
            isPrimary: Boolean(data.photo?.isPrimary || data.photo?.is_primary),
            sortOrder: Number(data.photo?.sortOrder ?? data.photo?.sort_order ?? uploadSortOrder),
          };
          if (transfer.canceled) {
            try { await discardPhotoUpload(item, uploadedPhoto); }
            catch (error) {
              updateQueuedPhoto(item.id, { stage: "failed", progress: 100, result: uploadedPhoto,
                error: error instanceof Error ? error.message : "Unable to cancel photo. Try again." });
            }
            return;
          }
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
          if (transfer.signal.aborted) {
            if (!item.cropConfirmed || transfer.canceled) { await discardPhotoUpload(item); return; }
            updateQueuedPhoto(item.id, { stage: "failed", progress: 0, error: "Upload canceled." });
            return;
          }
          const friendlyMessage = mediaUploadError(error, "photo");
          if (!item.cropConfirmed) {
            cropErrors.push("Couldn't prepare this photo. Select it again.");
            await discardPhotoUpload(item);
            return;
          }
          const failedItem = { ...item, uploadSortOrder, stage: "failed" as const, progress: 0, error: friendlyMessage };
          failedItems.push(failedItem);
          updateQueuedPhoto(item.id, failedItem);
        } finally {
          transfer.finish();
          setCancelingIds(current => { const next = new Set(current); next.delete(item.id); return next; });
        }
      }, controller.signal);

      if (acceptedCount || rejectedCount) {
        const refreshData = await requestDancerProfileJson({
          cache: "no-store",
          fallbackMessage: "Unable to refresh uploaded photos.",
          signal: controller.signal,
        });
        if (!isCurrentPhotoAction(requestId, controller)) return;
        if (refreshData.profile) {
          confirmLibraryPhotos(refreshData.profile);
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
        ...new Set(cropErrors),
        rejectedCount ? `${rejectedCount} not approved` : "",
        failedItems.length ? `${failedItems.length} ready to retry` : "",
      ].filter(Boolean).join(". ");
      setStatus(cancellation.canceled ? (acceptedCount ? "Uploads canceled. Completed uploads are kept." : "") : summary);
    } catch (error) {
      if (isCurrentPhotoAction(requestId, controller)) {
        const message = error instanceof Error ? error.message : "Unable to upload photos.";
        const failedById = new Map(failedItems.map((item) => [item.id, item]));
        const batchIds = new Set(batch.map((item) => item.id));
        setQueuedPhotos((current) => current.flatMap((item) => {
          if (rejectedItemIds.has(item.id) || acceptedItemIds.has(item.id)) return [item];
          if (!batchIds.has(item.id)) return [item];
          if (!item.cropConfirmed) {
            queuedPreviewUrlsRef.current.delete(item.previewUrl); URL.revokeObjectURL(item.previewUrl);
            return [];
          }
          if (item.error === "Upload canceled.") return [item];
          return [failedById.get(item.id) || { ...item, stage: "failed", progress: 0, error: message }];
        }));
        setStatus(message);
      }
    } finally {
      if (finishPhotoAction(requestId)) {
        uploadCancellationRef.current = null;
        setCancelingUploads(false);
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
      setQueuedPhotos(current => current.filter(item => item.result?.id !== photo.id));
      setRetiredReviewIds(current => new Set(current).add(photo.id));
      deletedPhotoIdsRef.current = deletedPhotoIdsRef.current.filter((id) => id !== photo.id);
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsChange?.(deletedPhotoIdsRef.current);
      onDeletedPhotoStoragePathsChange?.([]);
      setStatus("");
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

  const photoActionBusy = isUploading || retrying || Boolean(pinningPhotoId) || deletingPhotoIds.size > 0 || cropBatchIds.length > 0;
  const hasUnsavedUploads = queuedPhotos.some(item => !item.result && item.stage !== "complete" && item.error !== "Upload canceled.");
  usePendingUploadNotice("photos", hasUnsavedUploads);
  useEffect(() => { onBusyChange?.(photoActionBusy); return () => onBusyChange?.(false); }, [photoActionBusy, onBusyChange]);
  // Approved photos belong in the gallery. Keep unresolved uploads here and
  // use the refreshed library to retire reviews, even when approval changes IDs.
  const rejectedPhotos: DancerPhotoItem[] = (Array.isArray(profile?.rejected_photo_reviews) ? profile.rejected_photo_reviews : []).map((review: Record<string, unknown>) => ({
    id: String(review.id), label: "Photo", imageUrl: "", status: "rejected",
    note: mediaReviewExplanation("photo", "rejected", { reasonCodes: review.reason_codes, message: review.message }),
  }));
  const reviewPhotos = [...photos.filter(photo => photo.status !== "approved"), ...rejectedPhotos].filter(photo => !retiredReviewIds.has(photo.id));
  const libraryIds = new Set([...confirmedPhotoIds, ...dancerPhotoItemsFromProfile(profile).filter(photo => photo.status === "approved").map(photo => photo.id)]);
  // A selection belongs to the crop tool until the dancer confirms it.
  const confirmedQueuedPhotos = queuedPhotos.filter(item => item.cropConfirmed || item.result);
  const visibleQueuedPhotos = confirmedQueuedPhotos.filter(item => item.stage !== "complete" || item.result?.status === "rejected"
    || (uploadOnly && item.result?.status === "approved" && !libraryIds.has(item.result.id))
    || reviewPhotos.some(photo => photo.id === item.result?.id));
  const reviews: { item?: DancerPhotoQueueItem; result?: DancerPhotoItem }[] = [
    ...visibleQueuedPhotos.map(item => ({ item, result: reviewPhotos.find(photo => photo.id === item.result?.id) || item.result })),
    ...reviewPhotos.filter(photo => !visibleQueuedPhotos.some(item => item.result?.id === photo.id)).map(result => ({ result })),
  ];
  const awaitingReviews = reviews.filter(({ item, result }) => !item?.error && result
    && photoStatusLabel(result.status, result.moderationStatus) === "Awaiting final approval");
  const activeReviews = reviews.filter(review => !awaitingReviews.includes(review));
  const approvedPhotos = photos.filter(photo => photo.status === "approved");
  const needsMainPhoto = automaticMain && !photos.some(photo => photo.isPrimary && photo.status !== "rejected");
  const uploadLabel = needsMainPhoto ? "Main photo & avatar" : uploadOnly && !automaticMain ? "More photos" : "Add photos";
  const batchEntries = uploadBatchIds.length
    ? confirmedQueuedPhotos.filter(item => uploadBatchIds.includes(item.id)).map(item => ({ item,
      result: reviewPhotos.find(photo => photo.id === item.result?.id)
        || photos.find(photo => photo.id === item.result?.id)
        || (item.result && approvedPhotos.find(photo => photo.sortOrder === item.result?.sortOrder && photo.isPrimary === item.result?.isPrimary))
        || item.result,
    })) : reviews;
  const batchProgress = mediaBatchSummary(batchEntries.map(({ item, result }) => ({
    saved: Boolean(result && !["uploading", "failed"].includes(result.status)),
    failed: Boolean(item?.error) || ["error", "moderation_error", "moderation_retry"].includes(result?.moderationStatus || ""),
  })));

  return (
    <article aria-busy={photoActionBusy} aria-label="Profile photo manager" className="info-panel upload-panel">
      <DancerUploadDisclosure kind="photos" label={uploadLabel} openRequested={needsMainPhoto} defaultOpen={needsMainPhoto || !uploadOnly || approvedPhotos.length < MIN_DANCER_ONBOARDING_PHOTOS}>
      <div className="dancer-photo-upload-form">
        <strong className="photo-source-heading">{uploadLabel}</strong>
        {needsMainPhoto ? <button type="button" className="dancer-main-photo-empty" disabled={photoActionBusy}
          aria-label="Add a main photo and create your avatar" onClick={() => galleryPhotoInputRef.current?.click()}>
          <span className="dancer-main-photo-empty-preview" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM5 16l5-5 4 4 3-3 3 3" /><circle cx="16" cy="9" r="1" /></svg>
            <span><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg></span>
          </span>
          <span className="dancer-main-photo-empty-copy"><strong>Add main photo</strong><small>Your avatar will be created automatically.</small></span>
        </button> : null}
        {showRules ? <DancerMediaUploadRules kind="photo" /> : null}
        {!uploadOnly && !approvedPhotos.length ? <div className="photo-upload-heading">
          <span><strong>Add at least 1 solo photo of yourself. You can add more later.</strong></span>
        </div> : null}
        <div className="photo-source-grid">
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            aria-hidden="true"
            className="photo-source-input"
            disabled={photoActionBusy}
            multiple
            ref={galleryPhotoInputRef}
            tabIndex={-1}
            type="file"
            onChange={(event) => {
              queuePhotos(Array.from(event.target.files || []), "gallery");
              event.target.value = "";
            }}
          />
          <button
            aria-label={needsMainPhoto ? "Choose your main photo from your library" : "Choose profile photos from your library"}
            className={`photo-source-action${photoActionBusy ? " is-disabled" : ""}`}
            disabled={photoActionBusy}
            type="button"
            onClick={() => galleryPhotoInputRef.current?.click()}
          >
            <span className="photo-source-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4zM7 15l3-3 2.5 2.5L15 12l3 3" /><circle cx="16.5" cy="9" r="1" /></svg>
            </span>
            <span className="photo-source-copy">
              <strong>Gallery</strong>
              <small>Choose existing photos</small>
            </span>
            <span className="photo-source-cta" aria-hidden="true">Choose</span>
          </button>
          <input
            accept="image/*"
            aria-hidden="true"
            capture="environment"
            className="photo-source-input"
            disabled={photoActionBusy}
            ref={cameraPhotoInputRef}
            tabIndex={-1}
            type="file"
            onChange={(event) => {
              queuePhotos(Array.from(event.target.files || []), "camera");
              event.target.value = "";
            }}
          />
          <button
            aria-label={needsMainPhoto ? "Take a new main photo" : "Take a new profile photo"}
            className={`photo-source-action${photoActionBusy ? " is-disabled" : ""}`}
            disabled={photoActionBusy}
            type="button"
            onClick={() => cameraPhotoInputRef.current?.click()}
          >
            <span className="photo-source-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 8h3l1.5-2h5L16 8h3v10H5z" /><circle cx="12" cy="13" r="3" /></svg>
            </span>
            <span className="photo-source-copy">
              <strong>Camera</strong>
              <small>Take photo now</small>
            </span>
            <span className="photo-source-cta" aria-hidden="true">Open</span>
          </button>
        </div>
        <p className="photo-upload-selection-hint">Select photos, then keep all crops or adjust individually.</p>
        {automaticMain ? <p className="photo-upload-selection-hint">{needsMainPhoto
          ? "The first photo you select becomes your main photo. Your other photos stay saved."
          : "Your main photo appears on dancer cards and creates your avatar. Choose another from a photo’s menu."}</p> : null}
        {status && !(status === "Uploading" && reviews.length) ? <p className="photo-upload-status" role="status" aria-live="polite">{status}</p> : null}
      </div>
      </DancerUploadDisclosure>
      {cropBatchIds.length ? <DancerPhotoBatchChoice photos={queuedPhotos.filter(item => cropBatchIds.includes(item.id))}
        onKeep={() => confirmBatchCrops(true)} onAdjust={() => confirmBatchCrops(false)} onCancel={cancelBatchCrops} /> : null}
      <DancerUploadSummary summary={batchProgress} busy={photoActionBusy || hasUnsavedUploads} />
      {activeReviews.length ? (
        <div className="photo-upload-queue" role="group" aria-label="Photo upload status">
          {!uploadOnly ? <strong>Upload status · {activeReviews.length}</strong> : null}
          {isUploading && queuedPhotos.some(item => ["queued", "preparing", "cropping", "uploading"].includes(item.stage)) ? <button className="dancer-upload-cancel" type="button" disabled={cancelingUploads} onClick={() => {
            uploadCancellationRef.current?.cancel(); setCancelingUploads(true);
          }}>{cancelingUploads ? "Canceling…" : "Cancel uploads"}</button> : null}
          {activeReviews.map(review => {
            const { item, result } = review;
            const selectionNumber = reviews.indexOf(review) + 1;
            const awaitingClubApproval = Boolean(result && isAwaitingClubApproval(result.status, result.moderationStatus));
            const uploadStatus = item?.error === "Upload canceled." ? "Upload canceled" : item?.error ? "Upload failed" : result ? photoStatusLabel(result.status, result.moderationStatus) : "Uploading";
            const processing = uploadStatus === "Uploading";
            const uploadProgress = uploadStatus === "Uploading" && item?.stage === "uploading" ? item.progress : item?.stage === "queued" ? 0 : undefined;
            if (result?.status === "rejected") return <DancerRejectedUploadNotice key={result.id} id={result.id} kind="photo"
              label={item?.file.name || `Photo ${selectionNumber}`} message={result.note || photoStatusNote("rejected")}
              disabled={photoActionBusy} onDismiss={() => dismissRejectedPhoto(result.id)} />;
            return (
              <div className={`photo-review-card is-${result?.status || "pending"} dancer-upload-review-card${awaitingClubApproval ? " is-awaiting-club" : ""} ${item && ["preparing", "uploading", "checking"].includes(item.stage) ? "is-uploading" : ""}`.trim()} key={item?.id || result?.id}>
                <div className="photo-preview" style={{ backgroundImage: `url(${item?.previewUrl || result?.imageUrl || ""})` }} aria-label="Photo preview">{!item?.previewUrl && !result?.imageUrl ? <span>Photo</span> : null}</div>
                <span className="dancer-upload-review-copy">
                  <strong>{`Photo ${selectionNumber}`}</strong>
                  <small role="status" aria-live="polite">{uploadStatus === "Uploading" && uploadProgress !== undefined ? `${uploadStatus} · ${uploadProgress}%` : uploadStatus}</small>
                  {processing ? <DancerUploadProgress label={`Photo ${selectionNumber}: Uploading`} progress={uploadProgress} /> : null}
                  {uploadStatus === "Review delayed" ? <em>Processing paused. Tap Retry.</em> : result?.note && uploadStatus !== "Awaiting final approval" ? <em>{result.note}</em> : null}
                  {result && !awaitingClubApproval && !processing ? <DancerMediaRetryButton id={result.id} kind="photo" status={result.status} moderationStatus={result.moderationStatus}
                    disabled={photoActionBusy || retrying} onBusyChange={busy => { setRetrying(busy); onBusyChange?.(busy); }} onRetried={data => reviewRetried(result.id, data)} /> : null}
                  {item?.error ? <em>{item.error}</em> : null}
                  {processing ? <button type="button" disabled={cancelingIds.has(item?.id || result!.id)}
                    onClick={() => void cancelPhotoUpload(item, result)}>{cancelingIds.has(item?.id || result!.id) ? "Canceling…" : "Cancel"}</button> : null}
                  {processing ? null : result?.status === "approved" ? <span className="photo-queue-actions"><em>Approved. Updating your library.</em><RefreshButton label="Refresh photo library" busy={retrying} type="button" disabled={photoActionBusy} onClick={() => void refreshPhotoLibrary()} /></span> : <span className="photo-queue-actions">
                    {item?.error && !result && !awaitingClubApproval ? <button className="photo-retry-button" disabled={photoActionBusy} onClick={() => void uploadPhotoBatch([{ ...item, stage: "queued", progress: 0, error: undefined }])} type="button">Retry</button> : null}
                    {!awaitingClubApproval ? <label className="media-review-replace">Replace<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={photoActionBusy} aria-label={`Replace photo ${selectionNumber}`} onChange={event => {
                      const file = event.target.files?.[0]; event.target.value = "";
                      if (file) queuePhotos([file], "gallery", { photoId: result?.id, queueId: item?.id });
                    }} /></label> : null}
                    <button className="photo-delete-button" disabled={photoActionBusy} onClick={() => result ? void deletePhoto(result) : item && removeQueuedPhoto(item.id)} type="button">Remove</button>
                  </span>}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <DancerPendingMediaGrid items={[...awaitingReviews].sort((a, b) => Number(Boolean(b.result?.isPrimary)) - Number(Boolean(a.result?.isPrimary))).map(review => {
        const { item, result } = review;
        return { id: result!.id, kind: "photo", isMainPhoto: Boolean(result!.isPrimary),
          label: result!.isPrimary ? "Main photo" : `Photo ${reviews.indexOf(review) + 1}`,
          imageUrl: item?.previewUrl || result!.imageUrl, disabled: photoActionBusy,
          accessory: result!.isPrimary ? mainPhotoAccessory : undefined,
          removing: deletingPhotoIds.has(result!.id), onRemove: () => void deletePhoto(result!) };
      })} />
      {!uploadOnly && approvedPhotos.length ? (
        <div className="dancer-media-manager-title">
          <strong>Your photos</strong>
          <span>{approvedPhotos.length} {approvedPhotos.length === 1 ? "photo" : "photos"}</span>
        </div>
      ) : null}
      {!uploadOnly ? <div className="photo-review-list compact-photo-previews" aria-label="Uploaded photos">
        {approvedPhotos.map((photo) => {
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
              <DancerMediaRetryButton id={photo.id} kind="photo" status={photo.status} moderationStatus={photo.moderationStatus}
                disabled={photoActionBusy || retrying} onBusyChange={busy => { setRetrying(busy); onBusyChange?.(busy); }} onRetried={data => reviewRetried(photo.id, data)} />
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
      moderationStatus: String(review.club_reviewed_at ? "staff_review" : review.status || ""),
      note: mediaReviewExplanation("photo", "pending", { moderationStatus: String(review.club_reviewed_at ? "staff_review" : review.status || ""), reasonCodes: review.reason_codes, message: review.message }),
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
  return mediaReviewExplanation("photo", status);
}


function photoUploadStatusMessage(status: DancerPhotoItem["status"], message?: unknown) {
  const detail = typeof message === "string" && message.trim() ? message.trim() : photoStatusNote(status);
  if (status === "approved") return `Approved: ${detail}`;
  if (status === "rejected") return `Choose another photo: ${detail}`;
  return `Checking: ${detail}`;
}
