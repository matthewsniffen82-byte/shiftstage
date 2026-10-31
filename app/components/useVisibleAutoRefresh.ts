"use client";
import { useEffect, useRef } from "react";
import { readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { startVisibleAutoRefresh } from "@/src/lib/visible-auto-refresh";

const accountIdentity = () => {
  const account = readBrowserAuthSession()?.account;
  return account?.id ? `${account.id}:${account.role}` : null;
};

export function useVisibleAutoRefresh({ active = true, scopeKey = "", intervalMs = 30_000, refresh }: {
  active?: boolean;
  scopeKey?: string;
  intervalMs?: number;
  refresh: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>;
}) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; });
  useEffect(() => {
    if (!active) return;
    return startVisibleAutoRefresh({ intervalMs, refresh: async signal => {
      const identity = accountIdentity();
      if (!identity) return;
      await latest.current(signal, () => !signal.aborted && identity === accountIdentity());
    } });
  }, [active, scopeKey, intervalMs]);
}
