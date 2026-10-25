"use client";

import { useCallback, useEffect, useRef } from "react";
import { createInternalFollowReturn } from "@/src/lib/dancr/internal-profile-auth-return";
import type { DancerScorePeriod } from "@/src/lib/dancr/venue-dancer-scores";

export type TableRequestContext = { id: string; tableLabel: string; state: "pending" | "acknowledged" | "arrived" | "closed"; sample?: boolean };
export type RosterStatus = "Internal only" | "External only" | "Internal + External" | "Affiliated";
export type PerformanceScoreContext = { value: number | null; period: DancerScorePeriod; early: boolean };

export type InternalProfile = {
  initialPhotoUrl?: string; id: string; slug?: string; stage_name: string; city: string; venueName: string;
  internalAccent?: string | null;
  venueSlug?: string;
  tableRequest?: TableRequestContext;
  rosterStatus?: RosterStatus | null;
  performanceScore?: PerformanceScoreContext;
  workingUntil: string | null; avatarRevision: string;
  requestId?: string | null; requestsTonight: number; requestStatus: "pending" | "acknowledged" | null;
  photos: { id: string; is_primary?: boolean; is_pinned?: boolean; sort_order?: number; like_count?: number }[];
  videos: { id: string; caption: string | null; duration_seconds?: number; like_count?: number; is_pinned?: boolean; published_at?: string; has_poster?: boolean }[];
  socialLinks: { platform: string; handle: string | null; url: string }[];
};

export type InternalRequestAction = { tableLabel: string; busy: boolean; confirmed?: boolean; message: string };
export type PublicProfileActions = { following: boolean; notificationsEnabled: boolean; going: boolean };
export type VipProfileRequestAction = { added: boolean; disabled: boolean; message: string };

/** Host the actual discovery profile viewer; the parent retains roster authorization/polling. */
export function InternalFullProfile({ hidden = false, publicSlug, vipVenueId, publicActions, vipRequest, onVipRequest, profile, profileId = profile?.id || "", token, request, onRequest, onCancel, onReady, onError, onClose }: { hidden?: boolean; publicSlug?: string; vipVenueId?: string; publicActions?: PublicProfileActions; vipRequest?: VipProfileRequestAction; onVipRequest?: () => void; profile: InternalProfile | null; profileId?: string; token?: string; request?: InternalRequestAction; onRequest?: () => void; onCancel?: () => void; onReady?: () => void; onError?: () => void; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ profile, token, request, vipRequest, onVipRequest, onRequest, onCancel, onReady, onError, onClose });
  latest.current = { profile, token, request, vipRequest, onVipRequest, onRequest, onCancel, onReady, onError, onClose };
  const send = useCallback(() => {
    if (!profileId) {
      frame.current?.contentWindow?.postMessage({ type: "mydancr:internal-profile-clear" }, window.location.origin);
      return;
    }
    if (publicSlug) {
      frame.current?.contentWindow?.postMessage({ type: "mydancr:public-profile-open", profileId, slug: publicSlug, vipVenueId, actions: publicActions, vipRequest: latest.current.vipRequest }, window.location.origin);
      return;
    }
    if (latest.current.profile?.id !== profileId) return;
    frame.current?.contentWindow?.postMessage({
      type: "mydancr:internal-profile-open", profile: latest.current.profile, token: latest.current.token || "", request: latest.current.request,
    }, window.location.origin);
  }, [profileId, publicSlug, vipVenueId, publicActions]);
  useEffect(() => {
    const timer = profileId ? window.setTimeout(() => latest.current.onError?.(), 20000) : undefined;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "mydancr:internal-profile-ready") send();
      if (!profileId || event.data?.profileId !== profileId) return;
      if (event.data?.type === "mydancr:internal-profile-shown" && (publicSlug || latest.current.profile?.id === profileId)) {
        window.clearTimeout(timer); latest.current.onReady?.();
      }
      if (event.data?.type === "mydancr:internal-profile-error") { window.clearTimeout(timer); latest.current.onError?.(); }
      if (event.data?.type === "mydancr:internal-profile-close") latest.current.onClose();
      if (publicSlug && event.data?.type === "mydancr:vip-profile-request" && latest.current.vipRequest
        && !latest.current.vipRequest.added && !latest.current.vipRequest.disabled) latest.current.onVipRequest?.();
      if (publicSlug && event.data?.type === "mydancr:internal-profile-auth" && ["signup", "login"].includes(event.data.mode)) {
        const returnTo = `/?profile=${encodeURIComponent(publicSlug)}`;
        window.location.assign(`/account?role=customer&mode=${event.data.mode}&return_to=${encodeURIComponent(returnTo)}`);
      }
      if (event.data?.type === "mydancr:internal-profile-auth" && latest.current.profile && event.data.profileId === latest.current.profile.id
        && ["signup", "login"].includes(event.data.mode)) {
        try {
          const returnTo = createInternalFollowReturn(latest.current.profile.id, latest.current.token || "");
          const signupVenue = latest.current.profile.venueSlug;
          window.location.assign(`/account?role=customer&mode=${event.data.mode}&return_to=${encodeURIComponent(returnTo)}${signupVenue ? `&signup_venue=${encodeURIComponent(signupVenue)}` : ""}`);
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
  }, [profileId, publicSlug, send]);
  useEffect(() => { send(); }, [profile, token, request, vipRequest, send]);
  return <iframe style={hidden ? { visibility: "hidden" } : undefined} ref={frame} className="ir-full-profile-frame" title={profile ? `${profile.stage_name}’s full profile` : "Dancer profile"}
    src="/internal/profile-viewer?internal_profile=viewer" referrerPolicy="no-referrer" allow="autoplay; fullscreen" />;
}
