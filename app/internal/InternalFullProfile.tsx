"use client";

import { useCallback, useEffect, useRef } from "react";
import { createInternalFollowReturn } from "@/src/lib/dancr/internal-profile-auth-return";

export type InternalProfile = {
  id: string; slug?: string; stage_name: string; city: string; venueName: string;
  workingUntil: string | null; avatarRevision: string;
  requestId?: string | null; requestsTonight: number; requestStatus: "pending" | "acknowledged" | null;
  photos: { id: string; is_primary?: boolean; is_pinned?: boolean; sort_order?: number; like_count?: number }[];
  videos: { id: string; caption: string | null; duration_seconds?: number; like_count?: number; is_pinned?: boolean; published_at?: string; has_poster?: boolean }[];
  socialLinks: { platform: string; handle: string | null; url: string }[];
};

export type InternalRequestAction = { tableLabel: string; busy: boolean; confirmed?: boolean; message: string };

/** Host the actual discovery profile viewer; the parent retains roster authorization/polling. */
export function InternalFullProfile({ profile, profileId = profile?.id || "", token, request, onRequest, onCancel, onReady, onError, onClose }: { profile: InternalProfile | null; profileId?: string; token?: string; request?: InternalRequestAction; onRequest?: () => void; onCancel?: () => void; onReady?: () => void; onError?: () => void; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ profile, token, request, onRequest, onCancel, onReady, onError, onClose });
  latest.current = { profile, token, request, onRequest, onCancel, onReady, onError, onClose };
  const send = useCallback(() => {
    if (latest.current.profile?.id !== profileId) return;
    frame.current?.contentWindow?.postMessage({
      type: "mydancr:internal-profile-open", profile: latest.current.profile, token: latest.current.token || "", request: latest.current.request,
    }, window.location.origin);
  }, [profileId]);
  useEffect(() => {
    const timer = window.setTimeout(() => latest.current.onError?.(), 20000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "mydancr:internal-profile-ready") send();
      if (event.data?.type === "mydancr:internal-profile-shown" && latest.current.profile?.id === profileId) {
        window.clearTimeout(timer); latest.current.onReady?.();
      }
      if (event.data?.type === "mydancr:internal-profile-error") { window.clearTimeout(timer); latest.current.onError?.(); }
      if (event.data?.type === "mydancr:internal-profile-close") latest.current.onClose();
      if (event.data?.type === "mydancr:internal-profile-auth" && latest.current.profile && event.data.profileId === latest.current.profile.id
        && ["signup", "login"].includes(event.data.mode)) {
        try {
          const returnTo = createInternalFollowReturn(latest.current.profile.id, latest.current.token || "");
          window.location.assign(`/account?role=customer&mode=${event.data.mode}&return_to=${encodeURIComponent(returnTo)}`);
        } catch {
          frame.current?.contentWindow?.postMessage({ type: "mydancr:internal-profile-auth-error", message: "Sign-in could not open. Use the club's guest link and allow browser storage, then try again." }, window.location.origin);
        }
      }
      if (event.data?.type === "mydancr:internal-table-request" && latest.current.profile && event.data.profileId === latest.current.profile.id
        && latest.current.token && latest.current.request && !latest.current.request.busy
        && !latest.current.profile.requestStatus) latest.current.onRequest?.();
      if (event.data?.type === "mydancr:internal-table-cancel" && latest.current.profile && event.data.profileId === latest.current.profile.id
        && event.data.requestId === latest.current.profile.requestId && latest.current.profile.requestId
        && latest.current.token && latest.current.request && !latest.current.request.busy && !latest.current.request.confirmed
        && ["pending", "acknowledged"].includes(latest.current.profile.requestStatus || "")) latest.current.onCancel?.();
    };
    window.addEventListener("message", receive);
    return () => { window.clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [profileId, send]);
  useEffect(() => { send(); }, [profile, token, request, send]);
  return <iframe ref={frame} className="ir-full-profile-frame" title={profile ? `${profile.stage_name}’s full profile` : "Dancer profile"}
    src={`/internal/profile-viewer?internal_profile=${encodeURIComponent(profileId)}`} referrerPolicy="no-referrer" allow="autoplay; fullscreen" />;
}
