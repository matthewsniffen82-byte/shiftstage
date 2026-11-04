import { createMediaStatusCoordinator } from "@/src/lib/media-status-coordinator";
import { readSession, requestDashboardJson } from "./dashboard-session";

let previewRefreshOwner = "", previewRefreshAfter = 0;
export function refreshDancerPhotoPreviews() {
  const owner = String(readSession()?.account?.id || "");
  if (!owner || document.visibilityState !== "visible") return;
  const now = Date.now();
  // Coalesce thumbnail failures into one authenticated refresh, with a cooldown
  // so a persistent image failure cannot flood profile reads.
  if (owner === previewRefreshOwner && now < previewRefreshAfter) return;
  previewRefreshOwner = owner;
  previewRefreshAfter = now + 15_000;
  window.dispatchEvent(new Event("mydancr:dancer-media-changed"));
}

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
