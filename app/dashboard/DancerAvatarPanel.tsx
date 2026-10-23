"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { DASHBOARD_SESSION_KEY, requestDashboardJson, readSession, requestDancerProfileJson } from "./dashboard-session";
import type { LoadState } from "./dashboard-types";
import { AvatarUploadBusyContext } from "./DashboardShared";
import { cropProfilePhoto, type AvatarCrop } from "./profile-photo-crop";
import { dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import { dancerAvatarPreview } from "./dancer-avatar-preview";

export function DancerAvatarPanel({ compact = false, menuOnly = false, onProfileChange, profile }: {
  compact?: boolean;
  menuOnly?: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const photos = dancerPhotoItemsFromProfile(profile);
  const main = photos.find(photo => photo.status === "approved" && photo.isPrimary);
  const pendingMain = photos.find(photo => photo.status === "pending" && photo.isPrimary);
  const { pendingAvatarUrl, avatarUrl, objectPosition } = dancerAvatarPreview(profile, pendingMain?.id);
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

  if (menuOnly) return canAdjustCrop ? <>
    <button type="button" disabled={busy} onClick={() => void adjustCrop()}>{busy ? "Updating avatar…" : "Adjust avatar crop"}</button>
    {status ? <p role="status" aria-live="polite">{status}</p> : null}
  </> : null;

  return <article className={`info-panel dancer-avatar-panel${compact ? " is-compact" : ""}`} aria-busy={busy} data-avatar-state={pendingAvatarUrl ? "pending" : avatarUrl ? "approved" : "automatic"}>
    <div className="dancer-avatar-editor" aria-label="Automatic avatar preview">
      <button className="dancer-avatar-preview dancer-photo-edit-target" data-empty={!avatarUrl} type="button" disabled={busy || !canAdjustCrop}
        aria-label={pendingAvatarUrl ? "Avatar preview waiting for final approval" : canAdjustCrop ? "Adjust avatar crop" : "Automatic avatar preview"} onClick={() => void adjustCrop()}>
        {avatarUrl ? <img src={avatarUrl} alt="Avatar from your main photo" style={{ objectPosition }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>}
      </button>
    </div>
    <div className="dancer-avatar-upload-controls">
      {pendingAvatarUrl ? <p>Waiting for final approval</p> : canAdjustCrop ? <button type="button" disabled={busy} onClick={() => void adjustCrop()}>{busy ? "Updating…" : "Adjust crop"}</button> : <p>{pendingMain ? "Ready after photo checks." : "Add your main photo first."}</p>}
    </div>
    {status ? <p role="status" aria-live="polite">{status}</p> : null}
  </article>;
}
