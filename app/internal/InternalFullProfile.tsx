"use client";

import { useEffect, useRef, useState } from "react";

export type InternalProfile = {
  id: string; slug?: string; stage_name: string; city: string; venueName: string;
  workingUntil: string | null; avatarRevision: string;
  photos: { id: string; is_primary?: boolean; is_pinned?: boolean; sort_order?: number; like_count?: number }[];
  videos: { id: string; caption: string | null; duration_seconds?: number; like_count?: number; is_pinned?: boolean; published_at?: string }[];
  socialLinks: { platform: string; handle: string | null; url: string }[];
};

/** Host the actual discovery profile viewer; the parent retains roster authorization/polling. */
export function InternalFullProfile({ profile, token, onClose }: { profile: InternalProfile; token?: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ profile, token, onClose });
  latest.current = { profile, token, onClose };
  const send = () => frame.current?.contentWindow?.postMessage({
    type: "mydancr:internal-profile-open", profile: latest.current.profile, token: latest.current.token || "",
  }, window.location.origin);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "mydancr:internal-profile-ready") send();
      if (event.data?.type === "mydancr:internal-profile-shown") setReady(true);
      if (event.data?.type === "mydancr:internal-profile-close") latest.current.onClose();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { send(); }, [profile, token]);
  return <>
    {!ready ? <div className="ir-full-profile-loading"><p role="status">Opening full profile…</p><button type="button" onClick={onClose}>Back to roster</button></div> : null}
    <iframe ref={frame} className="ir-full-profile-frame" title={`${profile.stage_name}’s full profile`}
      src={`/internal/profile-viewer?internal_profile=${encodeURIComponent(profile.id)}`} referrerPolicy="no-referrer" allow="autoplay; fullscreen" />
  </>;
}
