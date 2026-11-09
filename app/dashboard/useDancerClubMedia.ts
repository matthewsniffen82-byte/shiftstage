"use client";
import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { ClubMediaState } from "@/src/lib/dancr/club-media-status";

type Snapshot = ClubMediaState & { profileId: unknown; venueId?: string | null };

function emptySnapshot(profileId: unknown, venueId?: string | null): Snapshot {
  return { profileId, venueId, statuses: [], error: "", activeClub: null, loading: Boolean(profileId) };
}

function sameScope(snapshot: Snapshot, profileId: unknown, venueId?: string | null) {
  return snapshot.profileId === profileId
    && (snapshot.venueId === venueId || venueId === undefined || (snapshot.activeClub?.id ?? null) === venueId);
}

export function useDancerClubMedia(profileId: unknown, venueId?: string | null) {
  const [state, setState] = useState<Snapshot>(emptySnapshot(profileId, venueId));
  useEffect(() => {
    const empty = emptySnapshot(profileId, venueId);
    setState(current => sameScope(current, profileId, venueId) ? current : empty);
    if (!profileId) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const data = await requestDashboardJson("/api/dancer/club-media", { expectedRole: "dancer", cache: "no-store", signal: controller.signal });
        if (!controller.signal.aborted) setState({ profileId, venueId, statuses: data.statuses || [], requirements: data.requirements || [], clubs: data.clubs || [], activeClub: data.activeClub || null, error: "", loading: false });
      } catch (error) {
        const status = Number((error as { status?: number })?.status);
        if (!controller.signal.aborted) setState(current => {
          const retain = sameScope(current, profileId, venueId) && Boolean(current.clubs) && (!status || status === 408 || status === 429 || status >= 500);
          return { ...(retain ? current : empty), stale: retain, loading: false, error: "Club approvals are temporarily unavailable." };
        });
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("mydancr:dancer-media-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("mydancr:dancer-media-changed", refresh);
    };
  }, [profileId, venueId]);
  return sameScope(state, profileId, venueId) ? state : emptySnapshot(profileId, venueId);
}
