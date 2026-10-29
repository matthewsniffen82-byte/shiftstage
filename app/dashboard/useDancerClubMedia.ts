"use client";
import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { ClubMediaState } from "@/src/lib/dancr/club-media-status";

export function useDancerClubMedia(profileId: unknown, refreshKey?: string) {
  const [state, setState] = useState<ClubMediaState & { profileId?: unknown; refreshKey?: string }>({ profileId, refreshKey, statuses: [], error: "", loading: true });
  useEffect(() => {
    setState({ profileId, refreshKey, statuses: [], error: "", activeClub: null, loading: Boolean(profileId) });
    if (!profileId) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const data = await requestDashboardJson("/api/dancer/club-media", { expectedRole: "dancer", cache: "no-store", signal: controller.signal });
        if (!controller.signal.aborted) setState({ profileId, refreshKey, statuses: data.statuses || [], requirements: data.requirements || [], clubs: data.clubs || [], activeClub: data.activeClub || null, error: "", loading: false });
      } catch {
        if (!controller.signal.aborted) setState(current => ({ ...current, loading: false, error: "Club approvals are temporarily unavailable." }));
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
  }, [profileId, refreshKey]);
  return state.profileId === profileId && state.refreshKey === refreshKey ? state : { statuses: [], error: "", loading: Boolean(profileId), activeClub: null };
}
