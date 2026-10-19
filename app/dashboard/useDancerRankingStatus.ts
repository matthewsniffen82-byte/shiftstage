"use client";

import { useEffect, useState } from "react";
import type { DancerRankingStatus } from "@/src/lib/dancr/external-ranking-progress";
import { requestDashboardJson } from "./dashboard-session";

/** Refresh earned scores without blocking shift management or showing stale success on failure. */
export function useDancerRankingStatus(refreshKey: string) {
  const [result, setResult] = useState<{ key: string; status: DancerRankingStatus | null; error: boolean } | null>(null);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (disposed || controller || document.visibilityState !== "visible") return;
      const request = new AbortController();
      controller = request;
      try {
        const status = await requestDashboardJson("/api/dancer/discovery", {
          cache: "no-store", expectedRole: "dancer", signal: request.signal,
          timeoutMs: 15000, fallbackMessage: "Unable to load discovery placement.",
        });
        if (!disposed && !request.signal.aborted) setResult({ key: refreshKey, status: status as unknown as DancerRankingStatus, error: false });
      } catch {
        if (!disposed && !request.signal.aborted) setResult({ key: refreshKey, status: null, error: true });
      } finally {
        controller = null;
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
    };
  }, [refreshKey]);
  const current = result?.key === refreshKey ? result : null;
  return { status: current?.status ?? null, error: current?.error ?? false };
}
