"use client";
import { useEffect } from "react";
import { readSession, requestDashboardJson } from "./dashboard-session";

export function useNotificationEmailArrival(accountId: string | null | undefined) {
  useEffect(() => {
    if (!accountId) return;
    const key = "mydancr:email-arrival";
    let snapshot: string | null;
    let arrival: { id: string; accountId: string; to: string };
    try {
      snapshot = window.sessionStorage.getItem(key);
      if (!snapshot) return;
      arrival = JSON.parse(snapshot);
      if (!arrival?.id || arrival.accountId !== accountId) return;
    } catch { return; }
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let busy = false;
    async function confirm() {
      const { pathname, search, hash } = window.location;
      if (busy || controller.signal.aborted || arrival.to !== pathname + search + hash ||
          readSession()?.account?.id !== accountId || window.sessionStorage.getItem(key) !== snapshot) return;
      busy = true;
      try {
        await requestDashboardJson("/api/auth/notification-login/complete", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: arrival.id }),
          cache: "no-store", signal: controller.signal, timeoutMs: 12000,
          fallbackMessage: "Unable to finish opening your email link.",
        });
        if (window.sessionStorage.getItem(key) === snapshot) window.sessionStorage.removeItem(key);
      } catch {
        if (!controller.signal.aborted && ++attempts < 3) retry = setTimeout(confirm, attempts * 2000);
      } finally { busy = false; }
    }
    void confirm();
    window.addEventListener("focus", confirm);
    window.addEventListener("hashchange", confirm);
    return () => {
      controller.abort();
      clearTimeout(retry);
      window.removeEventListener("focus", confirm);
      window.removeEventListener("hashchange", confirm);
    };
  }, [accountId]);
}
