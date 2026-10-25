"use client";

import { useEffect, useRef, useState } from "react";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import "./email-notification-guidance.css";

const GUIDANCE_ENDPOINT = "/api/account/email-guidance";
const storageKey = (accountId: string) => `mydancr:email-guidance:acknowledged:v1:${accountId}`;

function wasAcknowledged(accountId: string) {
  try { return window.localStorage.getItem(storageKey(accountId)) === "1"; }
  catch { return false; }
}

function rememberAcknowledgment(accountId: string) {
  try { window.localStorage.setItem(storageKey(accountId), "1"); }
  catch { /* The account preference still persists when browser storage is unavailable. */ }
}

const ACCOUNT_ALERT_REASONS = {
  customer: "We’ll email you when dancers you follow are working and about new club deals.",
  dancer: "Table requests, VIP selections and approvals.",
  venue: "Table and VIP requests.",
  vip: "VIP requests and confirmed visits.",
  admin: "Support messages needing your attention.",
};

export default function EmailNotificationGuidance({
  accountId,
  accountRole,
  clubApplication = false,
}: {
  accountId: string;
  accountRole: keyof typeof ACCOUNT_ALERT_REASONS;
  clubApplication?: boolean;
}) {
  const [status, setStatus] = useState<{ accountId: string; acknowledged: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && readSession()?.account?.id === accountId;
    setStatus(null);
    setSaving(false);
    setError("");
    const acknowledge = () => setStatus({ accountId, acknowledged: true });
    const onStorage = (event: StorageEvent) => {
      if (current() && event.key === storageKey(accountId) && event.newValue === "1") acknowledge();
    };
    window.addEventListener("storage", onStorage);
    if (accountId && current()) {
      if (wasAcknowledged(accountId)) acknowledge();
      else void requestDashboardJson(GUIDANCE_ENDPOINT, {
        cache: "no-store", signal: controller.signal, timeoutMs: 10_000,
        fallbackMessage: "Unable to check email alert acknowledgment.",
      }).then(data => {
        if (!current()) return;
        if (data.userId !== accountId || typeof data.acknowledged !== "boolean") throw new Error("Invalid acknowledgment response.");
        if (data.acknowledged) rememberAcknowledgment(accountId);
        setStatus({ accountId, acknowledged: data.acknowledged || wasAcknowledged(accountId) });
      }).catch(() => {
        if (current()) setStatus({ accountId, acknowledged: wasAcknowledged(accountId) });
      });
    }
    return () => {
      controller.abort();
      saveRequest.current?.abort();
      saveRequest.current = null;
      window.removeEventListener("storage", onStorage);
    };
  }, [accountId]);

  async function acknowledge() {
    if (saveRequest.current || readSession()?.account?.id !== accountId) return;
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true);
    setError("");
    const current = () => !controller.signal.aborted && readSession()?.account?.id === accountId;
    try {
      const data = await requestDashboardJson(GUIDANCE_ENDPOINT, {
        method: "PATCH", cache: "no-store", signal: controller.signal, timeoutMs: 10_000,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ acknowledged: true }),
        fallbackMessage: "Unable to save your acknowledgment. Please try again.",
      });
      if (!current()) return;
      if (data.userId !== accountId || data.acknowledged !== true) throw new Error("Unable to save your acknowledgment. Please try again.");
      rememberAcknowledgment(accountId);
      setStatus({ accountId, acknowledged: true });
    } catch {
      if (current()) setError("Unable to save your acknowledgment. Please try again.");
    } finally {
      if (saveRequest.current === controller) {
        saveRequest.current = null;
        setSaving(false);
      }
    }
  }

  // Wait for the account preference so an acknowledged box never flashes on reload.
  if (!accountId || status?.accountId !== accountId || status.acknowledged) return null;

  const reason = accountRole === "venue" && clubApplication
    ? "Updates on your club application."
    : ACCOUNT_ALERT_REASONS[accountRole];
  const instructions = accountRole === "customer"
    ? "For phone alerts, turn on notifications in your email app for the address you used to sign up."
    : "Email is on by default. Enable alerts in your email app for your MyDancr address.";

  return <aside className="email-notification-guidance" aria-label="Email alerts">
    <div className="email-guidance-heading">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m4 7 8 6 8-6" />
      </svg>
      <h2>Email alerts</h2>
    </div>
    <button className="email-guidance-acknowledge" type="button" disabled={saving} onClick={() => void acknowledge()}>
      {saving ? "Saving…" : "Got it"}
    </button>
    <p><strong>{reason}</strong> {instructions}</p>
    {error ? <p className="email-guidance-error" role="alert">{error}</p> : null}
  </aside>;
}
