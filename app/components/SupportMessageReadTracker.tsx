"use client";

import { useEffect, type RefObject } from "react";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import { MESSAGES_READ } from "./dashboard-message-unread";

// Observe message bubbles, not the inbox container: scrolling past a conversation
// must not clear unread messages that are still offscreen or inside hidden tabs.
export default function SupportMessageReadTracker({ container, revision, active = true, accountId }: {
  container: RefObject<HTMLElement | null>; revision: unknown; active?: boolean; accountId: string;
}) {
  useEffect(() => {
    if (!active || !container.current || !accountId || typeof IntersectionObserver === "undefined") return;
    const pending = new Set<string>();
    const seen = new Set<string>();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sending = false;
    async function flush() {
      if (sending || controller.signal.aborted || document.visibilityState !== "visible") return;
      const session = readSession();
      if (!session?.accessToken || session.account?.id !== accountId) return;
      const ids = [...pending].slice(0, 100);
      if (!ids.length) return;
      sending = true;
      try {
        await requestDashboardJson("/api/support/unread", {
          method: "PATCH", expectedRole: session.account.role, headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageIds: ids }), signal: controller.signal,
        });
        if (controller.signal.aborted || readSession()?.account?.id !== accountId) return;
        ids.forEach(id => { pending.delete(id); seen.add(id); });
        window.dispatchEvent(new CustomEvent(MESSAGES_READ, { detail: { accountId } }));
        if (pending.size) timer = setTimeout(() => void flush(), 250);
      } catch {
        // Leave the badge intact; retry on the next focus or visibility event.
      } finally { sending = false; }
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.supportMessageId;
        if (!id || seen.has(id)) continue;
        if (entry.isIntersecting && document.visibilityState === "visible") pending.add(id);
        else pending.delete(id);
      }
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 300);
    });
    const observe = () => {
      observer.disconnect(); pending.clear(); clearTimeout(timer);
      if (document.visibilityState === "visible") container.current?.querySelectorAll<HTMLElement>("[data-support-message-id]").forEach(element => observer.observe(element));
    };
    observe();
    document.addEventListener("visibilitychange", observe); window.addEventListener("focus", observe);
    return () => {
      controller.abort(); observer.disconnect(); clearTimeout(timer);
      document.removeEventListener("visibilitychange", observe); window.removeEventListener("focus", observe);
    };
  }, [container, revision, active, accountId]);
  return null;
}
