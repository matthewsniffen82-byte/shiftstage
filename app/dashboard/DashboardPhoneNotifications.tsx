"use client";

import { useEffect, useRef, useState } from "react";
import { customerPushDeviceEnabled, customerPushSupportMessage, disableCustomerPush, enableCustomerPush, type CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import { readSession, requestDashboardJson } from "./dashboard-session";
import "./dashboard-phone-notifications.css";

export default function DashboardPhoneNotifications({ role = "dancer", refreshKey = 0 }: {
  role?: "dancer" | "venue";
  refreshKey?: number;
}) {
  const [status, setStatus] = useState<{
    userId: string; deviceEnabled: boolean; venuePushEnabled: boolean | null;
    delivery: CustomerNotificationDelivery | null; support: string; error: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<string | null>(null);
  const sequence = useRef(0);
  const scope = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const refresh = async () => {
      const request = ++sequence.current;
      const account = readSession()?.account;
      setStatus(null); setMessage("");
      if (!account?.id || account.role !== role) return;
      const current = () => !controller.signal.aborted && request === sequence.current && readSession()?.account?.id === account.id && readSession()?.account?.role === role;
      const deviceEnabled = await customerPushDeviceEnabled(account.id);
      if (!current()) return;
      let venuePushEnabled: boolean | null = null;
      let delivery: CustomerNotificationDelivery | null = null;
      let error = "";
      const support = customerPushSupportMessage();
      if (role === "venue" && deviceEnabled) {
        try {
          const data = await requestDashboardJson("/api/venue/notification-settings", { cache: "no-store", timeoutMs: 15_000, signal: controller.signal, expectedRole: role });
          if (data.userId === account.id && data.settings) {
            venuePushEnabled = data.settings.alertsEnabled === true && data.settings.pushEnabled === true;
          }
        } catch { /* Keep a settings link when saved preferences cannot be confirmed. */ }
      } else if (!deviceEnabled && !support) {
        try {
          // Prepare configuration before the tap so browser permission can be
          // requested directly from that gesture, without another app prompt.
          const data = await requestDashboardJson("/api/notifications", { cache: "no-store", timeoutMs: 15_000, signal: controller.signal, expectedRole: role });
          if (data.pushUserId !== account.id) throw new Error("Sign in again to enable notifications.");
          delivery = data.notificationDelivery || {};
        } catch (reason) { error = reason instanceof Error ? reason.message : "Unable to prepare notifications. Try again."; }
      }
      if (current()) {
        setStatus({ userId: account.id, deviceEnabled, venuePushEnabled, delivery, support, error });
      }
    };
    const sync = () => {
      // The native permission dialog can focus the page again mid-enrollment.
      if (pending.current && pending.current === readSession()?.account?.id) return;
      void refresh();
    };
    sync();
    window.addEventListener("mydancr:push-changed", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("storage", sync);
    return () => {
      controller.abort();
      window.removeEventListener("mydancr:push-changed", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("storage", sync);
    };
  }, [role, refreshKey, attempt]);

  async function enable() {
    const controller = scope.current;
    if (pending.current || !status?.delivery || !controller || status.deviceEnabled || status.support) return;
    const expectedUser = status.userId;
    const sameAccount = () => readSession()?.account?.id === expectedUser && readSession()?.account?.role === role;
    const assertCurrent = () => {
      if (controller.signal.aborted || !sameAccount()) throw new Error("Your account changed. Reopen notifications.");
    };
    pending.current = expectedUser;
    sequence.current += 1;
    setBusy(true); setMessage("");
    let enrolled = false;
    try {
      // Keep this first: the helper requests browser permission before any await.
      await enableCustomerPush(status.delivery, expectedUser, assertCurrent);
      enrolled = true;
      assertCurrent();
      let venuePushEnabled: boolean | null = null;
      if (role === "venue") {
        const saved = await requestDashboardJson("/api/venue/notification-settings", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ settings: { pushEnabled: true } }),
          timeoutMs: 15_000, signal: controller.signal, expectedRole: role,
        });
        assertCurrent();
        if (saved.userId !== expectedUser || saved.settings?.pushEnabled !== true) throw new Error("Your notification preference was not confirmed. Please try again.");
        venuePushEnabled = saved.settings.alertsEnabled === true;
      }
      setStatus({ ...status, deviceEnabled: true, venuePushEnabled });
      window.dispatchEvent(new CustomEvent("mydancr:push-changed", { detail: { userId: expectedUser } }));
    } catch (reason) {
      // The shared helper cleans up failed enrollment. Roll back a completed
      // device enrollment if saving its venue preference subsequently fails.
      if (enrolled && sameAccount()) await disableCustomerPush().catch(() => {});
      if (!controller.signal.aborted && sameAccount()) {
        setMessage(reason instanceof Error ? reason.message : "Unable to enable notifications. Please try again.");
        setStatus({ ...status, support: customerPushSupportMessage() });
      }
    } finally {
      pending.current = null;
      if (scope.current && !scope.current.signal.aborted) setBusy(false);
    }
  }

  const enabled = status?.deviceEnabled ?? null;
  // Avoid flashing an enrollment prompt before the current device is checked.
  if (!status || (enabled && (role === "dancer" || status.venuePushEnabled))) return null;
  const reviewPreferences = role === "venue" && enabled;
  const unavailable = !status.delivery?.pushAvailable || !status.delivery?.pushPublicKey;
  return <section className="dashboard-notification-prompt" id={`${role}-overview-notifications`} aria-labelledby={`${role}-overview-notifications-heading`}>
    <div className="dashboard-notification-prompt-copy">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <div><h2 id={`${role}-overview-notifications-heading`}>{reviewPreferences ? "Review notification settings" : "Enable notifications"}</h2>
        <p>{role === "dancer" ? "Get alerts for table and VIP requests. You’ll also receive them by email." : "Get alerts for table and VIP requests and important venue updates."}</p>
        {role === "venue" ? <p>Manage email alerts and request preferences in Account &amp; support.</p> : null}
        {message || status.error || status.support || (!reviewPreferences && unavailable) ? <p role="status">{status.support || message || status.error || "Phone alerts are temporarily unavailable. Check MyDancr for new requests."}</p> : null}
      </div>
    </div>
    {reviewPreferences ? <a className="primary-link" href="#venue-notification-settings">Review settings</a>
      : status.error ? <button className="primary-link" type="button" onClick={() => setAttempt(value => value + 1)}>Retry notification setup</button>
      : <button className="primary-link" type="button" disabled={busy || unavailable || Boolean(status.support)} aria-busy={busy} onClick={() => void enable()}>{busy ? "Enabling…" : "Enable notifications"}</button>}
  </section>;
}
