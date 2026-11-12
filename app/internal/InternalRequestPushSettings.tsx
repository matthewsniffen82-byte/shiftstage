"use client";

import { useEffect, useRef, useState } from "react";
import { readSession, requestDashboardJson } from "@/app/dashboard/dashboard-session";
import { customerPushDeviceEnabled, customerPushSupportMessage, disableCustomerPush, enableCustomerPush, type CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import type { VenueNotificationSettings } from "@/src/lib/dancr/venue-notification-preferences";

export function InternalRequestPushSettings() {
  const [settings, setSettings] = useState<VenueNotificationSettings | null>(null);
  const [delivery, setDelivery] = useState<CustomerNotificationDelivery>({});
  const [enabled, setEnabled] = useState<boolean | null>(null);
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
    setSettings(null); setStatus(""); setEnabled(null);
    setSupport(customerPushSupportMessage());
    void requestDashboardJson("/api/venue/notification-settings", {
      cache: "no-store", signal: controller.signal, timeoutMs: 15_000,
      fallbackMessage: "Unable to check phone alerts. Try again.",
    }).then(async data => {
      if (controller.signal.aborted) return;
      if (!expected || data.userId !== expected || readSession()?.account?.id !== expected || !data.settings) throw new Error("Sign in again to manage phone alerts.");
      setSettings(data.settings); setDelivery(data.delivery || {});
      const deviceEnabled = await customerPushDeviceEnabled(expected);
      if (controller.signal.aborted || readSession()?.account?.id !== expected) return;
      setEnabled(deviceEnabled);
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message || "Unable to check phone alerts."); });
    const refresh = () => { if (!pending.current) setAttempt(value => value + 1); };
    window.addEventListener("mydancr:push-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      alive.current = false; controller.abort(); saveAbort.current?.abort();
      window.removeEventListener("mydancr:push-changed", refresh); window.removeEventListener("storage", refresh);
    };
  }, [attempt]);

  const on = Boolean(settings?.alertsEnabled && settings.tableRequests);
  const phoneOn = Boolean(on && settings?.pushEnabled && enabled);
  async function change(key: "tableRequests" | "pushEnabled") {
    const expected = userId.current;
    if (pending.current || !settings || !expected || readSession()?.account?.id !== expected) return;
    pending.current = true; setBusy(true); setStatus("");
    const controller = new AbortController(); saveAbort.current = controller;
    const phone = key === "pushEnabled";
    const next = phone || !settings.tableRequests;
    const assertCurrent = () => {
      if (!alive.current || controller.signal.aborted || readSession()?.account?.id !== expected) throw new Error("Your account changed. Reopen phone alerts.");
    };
    let confirmed = false;
    try {
      // The permission request runs directly from this click, before any network await.
      if (phone) await enableCustomerPush(delivery, expected, assertCurrent);
      assertCurrent();
      const data = await requestDashboardJson("/api/venue/notification-settings", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { [key]: next } }),
        signal: controller.signal, timeoutMs: 15_000, fallbackMessage: "Unable to save table request alerts.",
      });
      assertCurrent();
      if (data.userId !== expected || data.settings?.[key] !== next) throw new Error("Your alert setting could not be confirmed. Try again.");
      confirmed = true; setSettings(data.settings); if (phone) setEnabled(true);
      setStatus(phone ? "Phone alerts enabled on this device." : next ? "Table alerts turned on." : "Table alerts turned off.");
    } catch (error) {
      if (!confirmed && phone && !enabled && readSession()?.account?.id === expected) await disableCustomerPush();
      if (alive.current && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Unable to update phone alerts.");
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="ir-push-settings" aria-label="Table request alerts">
    <div className="ir-alert-summary"><strong>Table alerts</strong><span className={on ? "ir-alert-state is-on" : "ir-alert-state"}>{!settings ? status ? "Unavailable" : "Checking…" : on ? "● On" : "Off"}</span></div>
    <details className="ir-alert-controls"><summary>Manage alerts</summary>
    <p>New table requests appear in your club dashboard.</p>
    <details className="ir-alert-help"><summary>How alerts work</summary><p>Tap an alert to open the request inbox.</p>
    {support ? <p className="ir-push-help">{support}</p> : <p className="ir-push-help">iPhone: add MyDancr to your Home Screen and open its icon (iOS 16.4+). Android: enable alerts in your browser.</p>}
    </details>
    {settings ? <>
      {!delivery.pushAvailable ? <p role="status">Phone alerts are temporarily unavailable. Check this inbox for new requests.</p> : null}
      {!settings.alertsEnabled ? <p>Club alerts are paused. Resume them in <a href="/dashboard/venue#venue-notification-settings">notification preferences</a>.</p> : null}
      <button type="button" disabled={busy || !settings.alertsEnabled} onClick={() => void change("tableRequests")}>{on ? "Turn off table alerts" : "Turn on table alerts"}</button>
      {on && (enabled === null ? <p>Checking phone alerts…</p> : phoneOn ? <p>Phone alerts are on for this device.</p> : <button type="button" disabled={busy || !delivery.pushAvailable || Boolean(support)} onClick={() => void change("pushEnabled")}>Enable phone alerts on this device</button>)}
    </> : status ? <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry phone alert setup</button> : <p role="status">Checking phone alerts…</p>}
    {status ? <p role="status">{status}</p> : null}
    </details>
  </div>;
}
