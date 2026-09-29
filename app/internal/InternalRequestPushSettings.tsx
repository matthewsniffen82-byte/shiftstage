"use client";

import { useEffect, useRef, useState } from "react";
import { readSession, requestDashboardJson } from "@/app/dashboard/dashboard-session";
import { customerPushDeviceEnabled, customerPushSupportMessage, disableCustomerPush, enableCustomerPush, type CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import type { VenueNotificationSettings } from "@/src/lib/dancr/venue-notification-preferences";

export function InternalRequestPushSettings() {
  const [settings, setSettings] = useState<VenueNotificationSettings | null>(null);
  const [delivery, setDelivery] = useState<CustomerNotificationDelivery>({});
  const [enabled, setEnabled] = useState(false);
  const [support, setSupport] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false);
  const pending = useRef(false);
  const userId = useRef<string | null>(null);
  const saveAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const expected = readSession()?.account?.id || null;
    userId.current = expected;
    setSettings(null); setStatus(""); setEnabled(false);
    setSupport(customerPushSupportMessage());
    void requestDashboardJson("/api/venue/notification-settings", {
      cache: "no-store", signal: controller.signal, timeoutMs: 15_000,
      fallbackMessage: "Unable to check phone alerts. Try again.",
    }).then(async data => {
      if (controller.signal.aborted) return;
      if (!expected || data.userId !== expected || readSession()?.account?.id !== expected || !data.settings) throw new Error("Sign in again to manage phone alerts.");
      const deviceEnabled = await customerPushDeviceEnabled(expected);
      if (controller.signal.aborted || readSession()?.account?.id !== expected) return;
      setSettings(data.settings); setDelivery(data.delivery || {}); setEnabled(deviceEnabled);
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message || "Unable to check phone alerts."); });
    const refresh = () => { if (!pending.current) setAttempt(value => value + 1); };
    window.addEventListener("mydancr:push-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      alive.current = false; controller.abort(); saveAbort.current?.abort();
      window.removeEventListener("mydancr:push-changed", refresh); window.removeEventListener("storage", refresh);
    };
  }, [attempt]);

  const on = Boolean(settings?.alertsEnabled && settings.tableRequests && settings.pushEnabled && enabled);
  async function change() {
    const expected = userId.current;
    if (pending.current || !settings || !expected || readSession()?.account?.id !== expected) return;
    pending.current = true; setBusy(true); setStatus("");
    const controller = new AbortController(); saveAbort.current = controller;
    const next = !on;
    const assertCurrent = () => {
      if (!alive.current || controller.signal.aborted || readSession()?.account?.id !== expected) throw new Error("Your account changed. Reopen phone alerts.");
    };
    let confirmed = false;
    try {
      // The permission request runs directly from this click, before any network await.
      if (next) await enableCustomerPush(delivery, expected, assertCurrent);
      assertCurrent();
      const data = await requestDashboardJson("/api/venue/notification-settings", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: next ? { tableRequests: true, pushEnabled: true } : { tableRequests: false } }),
        signal: controller.signal, timeoutMs: 15_000, fallbackMessage: "Unable to save table request alerts.",
      });
      assertCurrent();
      if (data.userId !== expected || data.settings?.tableRequests !== next || (next && data.settings?.pushEnabled !== true)) throw new Error("Your alert setting could not be confirmed. Try again.");
      confirmed = true; setSettings(data.settings); if (next) setEnabled(true);
      setStatus(next ? "Table request alerts enabled on this device." : "Table request alerts turned off for your account.");
    } catch (error) {
      if (!confirmed && next && !enabled && readSession()?.account?.id === expected) await disableCustomerPush();
      if (alive.current && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Unable to update phone alerts.");
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="ir-push-settings" aria-label="Table request phone alerts">
    <div><strong>Phone alerts {on ? "· On" : ""}</strong><p>Get “Table 12 wants Aster” when a customer requests a dancer. Tap the alert to open this inbox.</p></div>
    {support ? <p className="ir-push-help">{support}</p> : <p className="ir-push-help">iPhone: add MyDancr to your Home Screen and open its icon (iOS 16.4+). Android: enable alerts in your browser.</p>}
    {settings ? <>
      {!delivery.pushAvailable ? <p role="status">Phone alerts are temporarily unavailable. Check this inbox for new requests.</p> : null}
      {!settings.alertsEnabled ? <p>Venue alerts are paused. Resume them in <a href="/dashboard/venue#venue-notification-settings">notification preferences</a>.</p> : null}
      <button type="button" disabled={busy || (!on && (!delivery.pushAvailable || Boolean(support) || !settings.alertsEnabled))} onClick={() => void change()}>{busy ? "Saving…" : on ? "Turn off table alerts" : "Enable table alerts"}</button>
    </> : status ? <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry phone alert setup</button> : <p role="status">Checking phone alerts…</p>}
    {status ? <p role="status">{status}</p> : null}
  </div>;
}
