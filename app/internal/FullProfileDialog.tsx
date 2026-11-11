"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { InternalFullProfile, type InternalProfile as Profile, type InternalRequestAction, type PublicProfileActions, type VipProfileRequestAction, type VipProfileIntent } from "./InternalFullProfile";
import "./internal.css";
import "../../public/profile-media-card-feed.css";
import "../../public/dancer-profile-layout.css";
import "../../public/dancer-profile-details.css";

export type ProfileSelection = { id: string; stageName: string; photoUrl?: string; tableRequest?: Profile["tableRequest"]; rosterStatus?: Profile["rosterStatus"]; performanceScore?: Profile["performanceScore"] };

export function ClubProfileDialog({ prewarm = false, prefetchProfile, publicSlug, vipVenueId, publicActions, vipRequest, onVipRequest, loadingIdentity, profile, profileId = profile?.id || "", token, request, onRequest, onCancel, onReady, onError, onClose }: { prewarm?: boolean; prefetchProfile?: VipProfileIntent; publicSlug?: string; vipVenueId?: string; publicActions?: PublicProfileActions; vipRequest?: VipProfileRequestAction; onVipRequest?: () => void; loadingIdentity?: ProfileSelection | null; profile: Profile | null; profileId?: string; token?: string; request?: InternalRequestAction; onRequest?: () => void; onCancel?: () => void; onReady?: () => void; onError?: () => void; onClose: () => void }) {
  const profileDialog = useRef<HTMLDialogElement>(null);
  const [readyId, setReadyId] = useState("");
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const ready = !!profileId && readyId === profileId;
  const card = loadingIdentity?.id === profileId ? loadingIdentity : null;
  const selected = profile?.id === profileId ? profile : null;
  const name = card?.stageName || selected?.stage_name || "Dancer";
  const photo = card?.photoUrl || selected?.initialPhotoUrl;
  useLayoutEffect(() => {
    const dialog = profileDialog.current;
    if (profileId) {
      if (!dialog?.open) dialog?.showModal();
      if (ready) dialog?.querySelector("iframe")?.focus({ preventScroll: true });
    } else {
      if (dialog?.open) dialog.close();
    }
    if (readyId && readyId !== profileId) setReadyId("");
  }, [profileId, ready, readyId]);
  return (
    <dialog className="ir-profile-dialog ir-full-profile-dialog" ref={profileDialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-label={profileId ? `${name}’s full profile` : "Dancer profile"}>
      {profileId && !ready && <div key={profileId} className="public-profile-shell profile-split-layout" data-profile-layout="portrait-details" aria-busy="true">
        <div className="profile-featured-column">
          {photo && <img className="profile-featured-photo" src={photo} data-image-state="ready" alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}
        </div>
        <header className="profile-titlebar"><div className="profile-titlebar-controls">
          <button type="button" className="public-profile-close" aria-label="Back to previous view" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
          </button>
        </div></header>
        <div className="profile-portrait-info"><div className="profile-portrait-copy">
          <div className="profile-titlebar-person">
            <span className="profile-titlebar-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
            <div className="profile-titlebar-identity"><h1>{name}</h1></div>
          </div>
        </div></div>
      </div>}
      {prewarm || profileId ? <InternalFullProfile key={viewerAttempt} hidden={!ready} prefetchProfile={prefetchProfile} initialPhotoUrl={card?.photoUrl} profileId={profileId} publicSlug={publicSlug} vipVenueId={vipVenueId} publicActions={publicActions} vipRequest={vipRequest} onVipRequest={onVipRequest} profile={profile} token={token} request={request} onRequest={onRequest} onCancel={onCancel} onReady={() => { setReadyId(profileId); onReady?.(); }} onError={() => { setReadyId(""); setViewerAttempt(attempt => attempt + 1); (onError || onClose)(); }} onClose={onClose} /> : null}
    </dialog>
  );
}

