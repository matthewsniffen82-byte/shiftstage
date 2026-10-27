"use client";
import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { ClubMediaState } from "@/src/lib/dancr/club-media-status";

export function useDancerClubMedia(profileId: unknown) {
  const [state, setState] = useState<ClubMediaState>({ statuses: [], error: "" });
  useEffect(() => {
    setState({ statuses: [], error: "" });
    if (!profileId) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const data = await requestDashboardJson("/api/dancer/club-media", { expectedRole: "dancer", cache: "no-store", signal: controller.signal });
        if (!controller.signal.aborted) setState({ statuses: data.statuses || [], error: "" });
      } catch {
        if (!controller.signal.aborted) setState(current => ({ ...current, error: "Club approvals are temporarily unavailable." }));
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [profileId]);
  return state;
}
