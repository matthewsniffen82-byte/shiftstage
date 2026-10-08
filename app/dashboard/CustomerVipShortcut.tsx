"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DASHBOARD_SESSION_KEY, readSession, requestDashboardJson } from "./dashboard-session";

export default function CustomerVipShortcut({ accountId }: { accountId: string }) {
  const [grantedAccount, setGrantedAccount] = useState("");
  useEffect(() => {
    let controller: AbortController | undefined;
    function isCurrentGuest() {
      const session = readSession();
      return Boolean(session?.accessToken && session.account?.id === accountId && session.account.role === "customer");
    }
    async function refresh() {
      controller?.abort();
      setGrantedAccount("");
      if (!accountId || !isCurrentGuest()) return;
      const request = new AbortController(); controller = request;
      try {
        const data = await requestDashboardJson("/api/vip?view=account", {
          expectedRole: "customer", signal: request.signal, cache: "no-store", timeoutMs: 10000,
          fallbackMessage: "Unable to check VIP access.",
        });
        if (!request.signal.aborted && isCurrentGuest() && Array.isArray(data.venues) && data.venues.length) setGrantedAccount(accountId);
      } catch { /* Optional navigation never blocks the guest dashboard. */ }
    }
    function onStorage(event: StorageEvent) { if (!event.key || event.key === DASHBOARD_SESSION_KEY) void refresh(); }
    function onVisible() { if (document.visibilityState === "visible") void refresh(); }
    void refresh();
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller?.abort(); window.removeEventListener("storage", onStorage); document.removeEventListener("visibilitychange", onVisible); };
  }, [accountId]);
  if (!accountId || grantedAccount !== accountId) return null;
  return <Link className="customer-vip-shortcut" href="/vip"><span><small>Private access</small><strong>VIP Lounge</strong></span><span aria-hidden="true">↗</span></Link>;
}
