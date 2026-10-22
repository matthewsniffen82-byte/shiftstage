"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { DASHBOARD_SESSION_KEY, requestDashboardJson, readSession, requestDancerProfileJson } from "./dashboard-session";
import type { LoadState } from "./dashboard-types";
import { AvatarUploadBusyContext } from "./DashboardShared";
import { cropProfilePhoto, type AvatarCrop } from "./profile-photo-crop";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";

export function DancerAvatarPanel({ compact = false, onProfileChange, profile }: {
  compact?: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const photos = dancerPhotoItemsFromProfile(profile);
  const main = photos.find(photo => photo.status === "approved" && photo.isPrimary);
  const pendingMain = photos.find(photo => photo.status === "pending" && photo.isPrimary);
  const pendingReview = (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [])
    .find((review: Record<string, unknown>) => review.id === pendingMain?.id && review.status === "pending_review");
  const pendingAvatarUrl = typeof pendingReview?.avatarPreviewUrl === "string" ? pendingReview.avatarPreviewUrl : "";
  const avatarUrl = pendingAvatarUrl || String(profile?.avatarPhotoUrl || "");
  const canAdjustCrop = Boolean(main && !pendingAvatarUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const action = useRef<AbortController | null>(null);
  const reportBusy = useContext(AvatarUploadBusyContext);
  useEffect(() => { reportBusy(busy); return () => reportBusy(false); }, [busy, reportBusy]);
  useEffect(() => {
    action.current?.abort(); action.current = null; setBusy(false); setStatus("");
    return () => { action.current?.abort(); action.current = null; };
  }, [profile?.id, main?.id, main?.storagePath, profile?.avatar_updated_at, canAdjustCrop]);

  async function adjustCrop() {
    if (!main || !canAdjustCrop || action.current) return;
    const owner = readSession()?.account?.id;
    if (!owner) { setStatus("Sign in again to adjust your avatar."); return; }
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setStatus("Opening your main photo…");
    const assertOwner = () => {
      const session = readSession();
      if (controller.signal.aborted || session?.account?.id !== owner || session.account.role !== "dancer") throw new DOMException("Crop canceled.", "AbortError");
    };
    const accountChanged = (event: StorageEvent) => {
      if (event.key !== DASHBOARD_SESSION_KEY && event.key !== null) return;
      try { assertOwner(); } catch { controller.abort(); }
    };
    window.addEventListener("storage", accountChanged);
    try {
      assertOwner();
      const body = new FormData(); body.set("photoId", main.id);
      const prepared = await requestDashboardJson("/api/dancer/photos/preview", { method: "POST", body, signal: controller.signal, expectedRole: "dancer" });
      assertOwner();
      if (typeof prepared.imageDataUrl !== "string" || !prepared.imageDataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Unable to open your main photo.");
      const bytes = Uint8Array.from(atob(prepared.imageDataUrl.split(",")[1]), character => character.charCodeAt(0));
      let crop: AvatarCrop | undefined;
      await cropProfilePhoto(new File([bytes], "main-photo.jpg", { type: "image/jpeg" }), controller.signal, assertOwner, 1, prepared.imageDataUrl, value => { crop = value; });
      assertOwner();
      if (!crop) { setStatus("Crop canceled. Your avatar hasn’t changed."); return; }
      setStatus("Saving your avatar crop…");
      await requestDashboardJson("/api/dancer/avatar/crop", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, expectedRole: "dancer",
        body: JSON.stringify({ photoId: main.id, sourcePath: main.storagePath, expectedAvatarUpdatedAt: profile?.avatar_updated_at ?? null, crop }),
        fallbackMessage: "Unable to save your crop. Refresh your profile before trying again.",
      });
      assertOwner();
      // An acknowledged save is never retried just because the profile read failed.
      setStatus("Avatar crop saved.");
      try {
        const refreshed = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal });
        assertOwner();
        if (!refreshed.profile) throw new Error("Profile unavailable.");
        onProfileChange?.(refreshed.profile);
      } catch { assertOwner(); setStatus("Avatar crop saved. Reload to see the latest photo."); }
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Unable to adjust your avatar.");
    } finally {
      window.removeEventListener("storage", accountChanged);
      if (action.current === controller) { action.current = null; setBusy(false); }
    }
  }

  return <article className={`info-panel dancer-avatar-panel${compact ? " is-compact" : ""}`} aria-busy={busy} data-avatar-state={pendingAvatarUrl ? "pending" : avatarUrl ? "approved" : "automatic"}>
    <div className="dancer-avatar-editor" aria-label="Automatic avatar preview">
      <button className="dancer-avatar-preview dancer-photo-edit-target" data-empty={!avatarUrl} type="button" disabled={busy || !canAdjustCrop}
        aria-label={pendingAvatarUrl ? "Avatar preview pending club approval" : "Adjust avatar crop"} onClick={() => void adjustCrop()}>
        {avatarUrl ? <img src={avatarUrl} alt="Avatar from your main photo" style={{ objectPosition: pendingAvatarUrl ? "50% 50%" : `${profile?.avatarPhotoFocalX ?? 50}% ${profile?.avatarPhotoFocalY ?? 50}%` }} /> : <span aria-hidden="true">Auto</span>}
      </button>
    </div>
    <div className="dancer-avatar-upload-controls">
      {pendingAvatarUrl ? <p>Preview · Pending club approval</p> : canAdjustCrop ? <button type="button" disabled={busy} onClick={() => void adjustCrop()}>{busy ? "Updating…" : "Adjust crop"}</button> : <p>Appears after your main photo passes checks.</p>}
    </div>
    {status ? <p role="status" aria-live="polite">{status}</p> : null}
  </article>;
}
