"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { readSession, requestDashboardJson, requestDancerProfileJson } from "./dashboard-session";
import type { DancerPhotoItem } from "./dashboard-types";

export default function DancerChooseMainPhoto({ photo, mainPhotoId, disabled = false, onProfileChange, onBusyChange, thumbnail, label }: {
  photo: DancerPhotoItem; mainPhotoId?: string; disabled?: boolean; thumbnail?: ReactNode; label?: string;
  onProfileChange?: (profile: Record<string, unknown>) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  async function choose() {
    if (action.current || disabled || photo.status !== "approved") return;
    const owner = readSession()?.account?.id;
    if (!owner) { setStatus("Sign in again to choose your main photo."); return; }
    const controller = new AbortController(); action.current = controller;
    const current = () => !controller.signal.aborted && readSession()?.account?.id === owner;
    setBusy(true); setStatus("");
    try {
      await requestDashboardJson("/api/dancer/photos/main", { method: "PATCH", expectedRole: "dancer", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId: photo.id, mainPhotoId: mainPhotoId || null }) });
      if (!current()) return;
      const result = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal });
      if (!current()) return;
      if (!result.profile) throw new Error("Main photo saved. Refresh to see your updated profile.");
      onProfileChange?.(result.profile); setStatus("Main photo updated. Your avatar updates automatically.");
    } catch (error) { if (current()) setStatus(error instanceof Error ? error.message : "Unable to choose your main photo."); }
    finally { if (!controller.signal.aborted) { action.current = null; setBusy(false); } }
  }
  return <div className="dancer-saved-photo-crop">
    <button type="button" className={thumbnail ? "dancer-saved-photo-choice" : undefined} aria-label={label}
      disabled={disabled || busy || photo.status !== "approved"} aria-busy={busy} onClick={() => void choose()}>
      {thumbnail || (busy ? "Saving…" : "Use as main photo")}
    </button>
    {status ? <p role="status">{status}</p> : null}
  </div>;
}
