"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { AVATAR_REJECTED_MESSAGE, avatarUploadPresentation, type AvatarUploadFeedback } from "./avatar-upload-state";
import { DashboardDataRequestError, readSession, requestDancerAvatarJson, requestDancerProfileJson } from "./dashboard-session";
import type { LoadState } from "./dashboard-types";
import { AvatarUploadBusyContext } from "./DashboardShared";
export function DancerAvatarPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFeedback, setUploadFeedback] = useState<AvatarUploadFeedback | null>(null);
  const reportAvatarBusy = useContext(AvatarUploadBusyContext);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const uploadIdentityRef = useRef<{ signature: string; key: string } | null>(null);
  const avatarUrl = String(profile?.avatarPhotoUrl || "");
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const latestAvatarReview = profile?.avatar_review as Record<string, unknown> | undefined;
  const pendingPreviewRef = useRef({ id: "", url: "" });
  const pendingId = String(pendingAvatar?.id || "");
  if (pendingPreviewRef.current.id !== pendingId) {
    pendingPreviewRef.current = { id: pendingId, url: String(pendingAvatar?.previewUrl || "") };
  }

  useEffect(() => {
    reportAvatarBusy(isSaving);
    return () => reportAvatarBusy(false);
  }, [isSaving, reportAvatarBusy]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
      uploadIdentityRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectAvatar(nextFile: File | null) {
    if (actionInFlightRef.current) return;
    if (!nextFile) return;
    uploadIdentityRef.current = createAvatarUploadIdentity(nextFile);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setUploadFeedback(null);
    setStatus("");
    void uploadAvatar(nextFile);
  }

  async function refreshProfile(signal: AbortSignal) {
    const data = await requestDancerProfileJson({
      cache: "no-store",
      fallbackMessage: "Unable to refresh your avatar.",
      signal,
    });
    if (!data.profile) throw new Error("Unable to refresh your avatar.");
    return data.profile as Record<string, unknown>;
  }

  function beginAvatarAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentAvatarAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishAvatarAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return false;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    return mountedRef.current;
  }

  async function uploadAvatar(nextFile: File) {
    const session = readSession();
    if (!session?.accessToken) {
      setUploadFeedback({ state: "failed", message: "Sign in again before uploading your avatar." });
      return;
    }
    if (!nextFile.type.startsWith("image/") || nextFile.size > 25 * 1024 * 1024) {
      setFile(null);
      setUploadFeedback({ state: "failed", message: nextFile.size > 25 * 1024 * 1024
        ? "Avatar photos must be 25 MB or smaller. Choose another photo."
        : "Choose a JPEG, PNG, WebP, HEIC, or HEIF image." });
      return;
    }
    const formData = new FormData();
    const signature = avatarFileSignature(nextFile);
    const uploadIdentity = uploadIdentityRef.current?.signature === signature
      ? uploadIdentityRef.current
      : createAvatarUploadIdentity(nextFile);
    uploadIdentityRef.current = uploadIdentity;
    const uploadKey = uploadIdentity.key;
    formData.set("file", nextFile);
    formData.set("idempotencyKey", uploadKey);
    const action = beginAvatarAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsSaving(true);
    setUploadProgress(25);
    setStatus("");
    setUploadFeedback({ state: "checking", message: "Checking your avatar..." });
    try {
      const data = await requestDancerAvatarJson({
        method: "POST",
        headers: { "idempotency-key": uploadKey },
        body: formData,
        fallbackMessage: "Unable to upload avatar.",
        signal: controller.signal,
      });
      if (!isCurrentAvatarAction(requestId, controller)) return;
      setUploadProgress(85);
      // The server has received this file. A failed read must never offer to upload it again.
      const decision = String(data.decision || "pending").toLowerCase();
      const feedback: AvatarUploadFeedback = {
        state: decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "pending",
        reviewId: String(data.moderationRecordId || ""),
        message: decision === "approved" ? "Avatar approved and saved."
          : decision === "rejected" ? AVATAR_REJECTED_MESSAGE
          : "Your avatar is waiting for approval. You don’t need to upload it again.",
      };
      setUploadFeedback(feedback);
      setFile(null);
      uploadIdentityRef.current = null;
      try {
        const refreshedProfile = await refreshProfile(controller.signal);
        if (!isCurrentAvatarAction(requestId, controller)) return;
        onProfileChange?.(refreshedProfile);
      } catch {
        if (!isCurrentAvatarAction(requestId, controller)) return;
        setUploadFeedback({ ...feedback, message: decision === "rejected" ? AVATAR_REJECTED_MESSAGE
          : `${feedback.message} Your profile could not refresh. Reload the dashboard to see its latest status.` });
      }
    } catch (error) {
      if (isCurrentAvatarAction(requestId, controller)) {
        const rejected = error instanceof DashboardDataRequestError && error.status === 422;
        if (rejected) {
          setFile(null);
          uploadIdentityRef.current = null;
        }
        setUploadFeedback({ state: rejected ? "rejected" : "failed", message: rejected
          ? AVATAR_REJECTED_MESSAGE
          : error instanceof Error ? error.message : "Unable to upload avatar. Try again." });
      }
    } finally {
      if (finishAvatarAction(requestId)) {
        setIsSaving(false);
        setUploadProgress(0);
      }
    }
  }

  function avatarFileSignature(nextFile: File) {
    return `${nextFile.name}:${nextFile.size}:${nextFile.lastModified}`;
  }

  function createAvatarUploadIdentity(nextFile: File) {
    const signature = avatarFileSignature(nextFile);
    return { signature, key: `${signature}:avatar:${crypto.randomUUID()}` };
  }

  async function removeAvatar() {
    if (actionInFlightRef.current) return;
    if (!window.confirm("Remove your current avatar? A moderated avatar is required before profile submission.")) return;
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    const action = beginAvatarAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsSaving(true);
    setStatus("Removing avatar...");
    try {
      await requestDancerAvatarJson({
        method: "DELETE",
        fallbackMessage: "Unable to remove avatar.",
        signal: controller.signal,
      });
      if (!isCurrentAvatarAction(requestId, controller)) return;
      const refreshedProfile = await refreshProfile(controller.signal);
      if (!isCurrentAvatarAction(requestId, controller)) return;
      onProfileChange?.(refreshedProfile);
      setUploadFeedback(null);
      setFile(null);
      setPreviewUrl("");
      setStatus("Avatar removed.");
    } catch (error) {
      if (isCurrentAvatarAction(requestId, controller)) {
        setStatus(error instanceof Error ? error.message : "Unable to remove avatar.");
      }
    } finally {
      if (finishAvatarAction(requestId)) setIsSaving(false);
    }
  }

  const visibleAvatar = previewUrl || pendingPreviewRef.current.url || avatarUrl;
  const presentation = avatarUploadPresentation({ upload: uploadFeedback, avatarUrl, pendingReview: pendingAvatar, latestReview: latestAvatarReview });
  const statusMessage = status || presentation.message;
  return (
    <article className="info-panel dancer-avatar-panel" aria-busy={isSaving} data-avatar-state={presentation.state || "required"}>
      <p className="dancer-profile-editor-intro">Use a clear solo face photo of yourself.</p>
      <div className="dancer-avatar-editor" aria-label="Avatar preview">
        <span className="dancer-avatar-preview">
          {visibleAvatar ? <img src={visibleAvatar} alt="Selected dancer avatar preview" /> : <b aria-hidden="true">+</b>}
          {previewUrl && presentation.state === "approved" && latestAvatarReview?.id === uploadFeedback?.reviewId && avatarUrl ? (
            <img
              alt=""
              aria-hidden="true"
              data-avatar-approved-preview
              src={avatarUrl}
              style={{ display: "none" }}
              onLoad={() => setPreviewUrl((current) => current === previewUrl ? "" : current)}
            />
          ) : null}
        </span>
        <strong className={`dancer-avatar-state is-${presentation.state || "required"}`}>{presentation.label}</strong>
      </div>
      <div className="dancer-avatar-upload-controls">
        <div className="photo-source-grid dancer-avatar-source-grid">
          <label className={`photo-source-action${isSaving ? " is-disabled" : ""}`}>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              aria-label="Choose avatar from your photo library"
              className="photo-source-input"
              disabled={isSaving}
              type="file"
              onChange={(event) => {
                selectAvatar(event.target.files?.[0] || null);
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4zM7 15l3-3 2.5 2.5L15 12l3 3" /><circle cx="16.5" cy="9" r="1" /></svg></span>
            <span className="photo-source-copy"><strong>Gallery</strong><small>Choose a clear face photo</small></span>
            <span className="photo-source-cta" aria-hidden="true">Choose</span>
          </label>
          <label className={`photo-source-action${isSaving ? " is-disabled" : ""}`}>
            <input
              accept="image/*"
              aria-label="Take a new avatar photo"
              capture="user"
              className="photo-source-input"
              disabled={isSaving}
              type="file"
              onChange={(event) => {
                selectAvatar(event.target.files?.[0] || null);
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 8h3l1.5-2h5L16 8h3v10H5z" /><circle cx="12" cy="13" r="3" /></svg></span>
            <span className="photo-source-copy"><strong>Camera</strong><small>Take a new face photo now</small></span>
            <span className="photo-source-cta" aria-hidden="true">Open</span>
          </label>
        </div>
        {isSaving ? <progress aria-label="Avatar upload progress" max="100" value={uploadProgress} /> : null}
        {file && !isSaving && presentation.canRetry ? <button type="button" onClick={() => void uploadAvatar(file)}>Retry avatar upload</button> : null}
        {avatarUrl ? <button type="button" disabled={isSaving} onClick={() => void removeAvatar()}>Remove avatar</button> : null}
      </div>
      <p role="status" aria-live="polite">{statusMessage}</p>
    </article>
  );
}
