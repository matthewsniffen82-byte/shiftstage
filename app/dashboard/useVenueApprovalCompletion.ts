"use client";
import { useEffect } from "react";
import { readSession, requestDashboardJson } from "./dashboard-session";

// Run after React displays a successfully loaded club dashboard, including a
// password sign-in. Failed/aborted loads and pending clubs never reach this hook.
export function useVenueApprovalCompletion(accountId: string | undefined, venueId: string | undefined) {
  useEffect(() => {
    if (!accountId || !venueId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let completed = false;
    let busy = false;
    const complete = async () => {
      if (busy || completed || controller.signal.aborted || readSession()?.account?.id !== accountId) return;
      busy = true;
      attempts++;
      try {
        await requestDashboardJson("/api/venue/approval-login/complete", {
          method: "POST", expectedRole: "venue", cache: "no-store", signal: controller.signal, timeoutMs: 12000,
          fallbackMessage: "Unable to finish securing your dashboard sign-in.",
        });
        completed = true;
      } catch {
        if (!controller.signal.aborted && attempts < 3) retry = setTimeout(() => void complete(), attempts * 2000);
      } finally { busy = false; }
    };
    const onFocus = () => { if (retry) clearTimeout(retry); attempts = 0; void complete(); };
    void complete();
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); if (retry) clearTimeout(retry); window.removeEventListener("focus", onFocus); };
  }, [accountId, venueId]);
}
