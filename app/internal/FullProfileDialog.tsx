"use client";

import { useEffect, useRef, useState } from "react";
import { InternalFullProfile, type InternalProfile as Profile, type InternalRequestAction, type PublicProfileActions } from "./InternalFullProfile";
import "./internal.css";

export type ProfileSelection = { id: string; stageName: string; photoUrl?: string };

export function ClubProfileDialog({ prewarm = false, publicSlug, publicActions, loadingIdentity, profile, profileId = profile?.id || "", token, request, onRequest, onCancel, onReady, onError, onClose }: { prewarm?: boolean; publicSlug?: string; publicActions?: PublicProfileActions; loadingIdentity?: ProfileSelection | null; profile: Profile | null; profileId?: string; token?: string; request?: InternalRequestAction; onRequest?: () => void; onCancel?: () => void; onReady?: () => void; onError?: () => void; onClose: () => void }) {
  const profileDialog = useRef<HTMLDialogElement>(null);
  const [readyId, setReadyId] = useState("");
  const [viewerAttempt, setViewerAttempt] = useState(0);
  useEffect(() => {
    if (profileId && !profileDialog.current?.open) profileDialog.current?.showModal();
    if (!profileId) { profileDialog.current?.close(); setReadyId(""); }
  }, [profile, profileId, readyId]);
  return (
    <dialog className="ir-profile-dialog ir-full-profile-dialog" ref={profileDialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-label={profile ? `${profile.stage_name}’s full profile` : "Dancer profile"}>
      {profileId && readyId !== profileId ? <div className="ir-profile-loading" role="status">
        <button type="button" className="ir-profile-loading-close" onClick={onClose} aria-label="Close dancer profile">← Back</button>
        {loadingIdentity?.photoUrl ? <img src={loadingIdentity.photoUrl} alt="" /> : null}
        <h2>{loadingIdentity?.stageName || profile?.stage_name || "Dancer profile"}</h2>
        <p>Loading profile…</p>
      </div> : null}
      {prewarm || profileId ? <InternalFullProfile key={viewerAttempt} hidden={!!profileId && readyId !== profileId} profileId={profileId} publicSlug={publicSlug} publicActions={publicActions} profile={profile} token={token} request={request} onRequest={onRequest} onCancel={onCancel} onReady={() => { setReadyId(profileId); onReady?.(); }} onError={() => { setReadyId(""); setViewerAttempt(attempt => attempt + 1); (onError || onClose)(); }} onClose={onClose} /> : null}
    </dialog>
  );
}

