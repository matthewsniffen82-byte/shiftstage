import { createMediaStatusCoordinator } from "@/src/lib/media-status-coordinator";
import { readSession, requestDashboardJson } from "./dashboard-session";

export const subscribeDancerMediaStatus = createMediaStatusCoordinator({
  read: signal => requestDashboardJson("/api/dancer/media/status", {
    expectedRole: "dancer", cache: "no-store", signal, timeoutMs: 15000,
  }),
  visible: () => document.visibilityState === "visible",
  owner: () => String(readSession()?.account?.id || ""),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: timer => { if (timer !== undefined) window.clearTimeout(timer as number); },
  listen: callback => {
    document.addEventListener("visibilitychange", callback);
    window.addEventListener("focus", callback);
    window.addEventListener("mydancr:dancer-media-changed", callback);
    return () => {
      document.removeEventListener("visibilitychange", callback);
      window.removeEventListener("focus", callback);
      window.removeEventListener("mydancr:dancer-media-changed", callback);
    };
  },
});
