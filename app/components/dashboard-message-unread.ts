"use client";

import { useEffect, useState } from "react";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import { DASHBOARD_HELP_UPDATED } from "./dashboard-help-events";
import { ADMIN_INBOX_ARCHIVE_CHANGED } from "../admin/admin-data-events";

export const MESSAGES_READ = "dancr:messages-read";

export function useSupportUnreadCount(accountId: string | null | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ accountId: string; count: number } | null>(null);
  useEffect(() => {
    if (!accountId || !enabled) return;
    let controller: AbortController | null = null;
    let disposed = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const session = readSession();
      if (!session?.accessToken || session.account?.id !== accountId) { setResult(null); return; }
      const request = new AbortController(); controller = request;
      try {
        const data = await requestDashboardJson("/api/support/unread", { cache: "no-store", expectedRole: session.account.role, signal: request.signal });
        if (disposed || request.signal.aborted || readSession()?.account?.id !== accountId) return;
        if (!Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0) throw new Error("Invalid message count.");
        setResult({ accountId, count: data.unreadCount });
      } catch {
        if (!disposed && !request.signal.aborted) setResult(null);
      }
    };
    const updated = (event: Event) => {
      if ((event as CustomEvent<{ accountId?: string }>).detail?.accountId === accountId) void refresh();
    };
    const load = () => { void refresh(); };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    window.addEventListener("storage", load);
    document.addEventListener("visibilitychange", load);
    window.addEventListener(MESSAGES_READ, updated);
    window.addEventListener(DASHBOARD_HELP_UPDATED, updated);
    window.addEventListener(ADMIN_INBOX_ARCHIVE_CHANGED, load);
    return () => {
      disposed = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", load); window.removeEventListener("storage", load);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener(MESSAGES_READ, updated); window.removeEventListener(DASHBOARD_HELP_UPDATED, updated);
      window.removeEventListener(ADMIN_INBOX_ARCHIVE_CHANGED, load);
    };
  }, [accountId, enabled]);
  return enabled && result && result.accountId === accountId ? result.count : null;
}
