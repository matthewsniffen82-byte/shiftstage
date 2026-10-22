"use client";

import { useEffect, useRef, useState } from "react";
import { InternalFullProfile, type InternalProfile as Profile, type InternalRequestAction, type PublicProfileActions, type VipProfileRequestAction } from "./InternalFullProfile";
import "./internal.css";

export type ProfileSelection = { id: string; stageName: string; photoUrl?: string; tableRequest?: Profile["tableRequest"]; rosterStatus?: Profile["rosterStatus"]; performanceScore?: Profile["performanceScore"] };

export function ClubProfileDialog({ prewarm = false, publicSlug, publicActions, vipRequest, onVipRequest, loadingIdentity, profile, profileId = profile?.id || "", token, request, onRequest, onCancel, onReady, onError, onClose }: { prewarm?: boolean; publicSlug?: string; publicActions?: PublicProfileActions; vipRequest?: VipProfileRequestAction; onVipRequest?: () => void; loadingIdentity?: ProfileSelection | null; profile: Profile | null; profileId?: string; token?: string; request?: InternalRequestAction; onRequest?: () => void; onCancel?: () => void; onReady?: () => void; onError?: () => void; onClose: () => void }) {
  const profileDialog = useRef<HTMLDialogElement>(null);
  const [readyId, setReadyId] = useState("");
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const ready = !!profileId && readyId === profileId;
  useEffect(() => {
    const dialog = profileDialog.current;
    // Keep the roster usable while the warm frame prepares the actual profile.
    // A new selection or a failed load must never reveal an empty/old dialog.
    if (ready) {
      if (!dialog?.open) dialog?.showModal();
    } else {
      if (dialog?.open) dialog.close();
      if (readyId) setReadyId("");
    }
  }, [ready, readyId]);
  return (
    <dialog className="ir-profile-dialog ir-full-profile-dialog" ref={profileDialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-label={profile?.stage_name || loadingIdentity?.stageName ? `${profile?.stage_name || loadingIdentity?.stageName}’s full profile` : "Dancer profile"}>
      {prewarm || profileId ? <InternalFullProfile key={viewerAttempt} hidden={!ready} profileId={profileId} publicSlug={publicSlug} publicActions={publicActions} vipRequest={vipRequest} onVipRequest={onVipRequest} profile={profile} token={token} request={request} onRequest={onRequest} onCancel={onCancel} onReady={() => { setReadyId(profileId); onReady?.(); }} onError={() => { setReadyId(""); setViewerAttempt(attempt => attempt + 1); (onError || onClose)(); }} onClose={onClose} /> : null}
    </dialog>
  );
}

