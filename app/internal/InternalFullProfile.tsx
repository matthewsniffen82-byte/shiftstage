"use client";

import { useEffect, useRef, useState } from "react";

export type InternalProfile = {
  id: string; slug?: string; stage_name: string; city: string; venueName: string;
  workingUntil: string | null; avatarRevision: string;
  requestsTonight: number; requestStatus: "pending" | "acknowledged" | null;
  photos: { id: string; is_primary?: boolean; is_pinned?: boolean; sort_order?: number; like_count?: number }[];
  videos: { id: string; caption: string | null; duration_seconds?: number; like_count?: number; is_pinned?: boolean; published_at?: string; has_poster?: boolean }[];
  socialLinks: { platform: string; handle: string | null; url: string }[];
};

export type InternalRequestAction = { tableLabel: string; busy: boolean; message: string };

/** Host the actual discovery profile viewer; the parent retains roster authorization/polling. */
export function InternalFullProfile({ profile, token, request, onRequest, onClose }: { profile: InternalProfile; token?: string; request?: InternalRequestAction; onRequest?: () => void; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ profile, token, request, onRequest, onClose });
  latest.current = { profile, token, request, onRequest, onClose };
  const send = () => frame.current?.contentWindow?.postMessage({
    type: "mydancr:internal-profile-open", profile: latest.current.profile, token: latest.current.token || "", request: latest.current.request,
  }, window.location.origin);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "mydancr:internal-profile-ready") send();
      if (event.data?.type === "mydancr:internal-profile-shown") setReady(true);
      if (event.data?.type === "mydancr:internal-profile-close") latest.current.onClose();
      if (event.data?.type === "mydancr:internal-table-request" && event.data.profileId === latest.current.profile.id
        && latest.current.token && latest.current.request && !latest.current.request.busy
        && !latest.current.profile.requestStatus) latest.current.onRequest?.();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { send(); }, [profile, token, request]);
  return <>
    {!ready ? <div className="ir-full-profile-loading"><p role="status">Opening full profile…</p><button type="button" onClick={onClose}>Back to roster</button></div> : null}
    <iframe ref={frame} className="ir-full-profile-frame" title={`${profile.stage_name}’s full profile`}
      src={`/internal/profile-viewer?internal_profile=${encodeURIComponent(profile.id)}`} referrerPolicy="no-referrer" allow="autoplay; fullscreen" />
  </>;
}
