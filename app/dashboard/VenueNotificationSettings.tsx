"use client";

import { useEffect, useRef, useState } from "react";
import { VENUE_NOTIFICATION_ALERTS, type VenueNotificationKey, type VenueNotificationSettings as Settings } from "@/src/lib/dancr/venue-notification-preferences";
import { customerPushDeviceEnabled, customerPushSupportMessage, disableCustomerPush, enableCustomerPush, type CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import { readSession, requestDashboardJson } from "./dashboard-session";
import "./venue-notification-settings.css";

export default function VenueNotificationSettings({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [delivery, setDelivery] = useState<CustomerNotificationDelivery>({});
  const [saving, setSaving] = useState<VenueNotificationKey | null>(null);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pushDeviceEnabled, setPushDeviceEnabled] = useState(false);
  const [pushSupportMessage, setPushSupportMessage] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  const saveAbort = useRef<AbortController | null>(null);
  const userId = useRef<string | null>(null);

  useEffect(() => {
    const refreshPush = (event: Event) => {
      if ((event as CustomEvent).detail?.userId === userId.current && !pending.current) setAttempt(value => value + 1);
    };
    window.addEventListener("mydancr:push-changed", refreshPush);
    return () => window.removeEventListener("mydancr:push-changed", refreshPush);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const expectedUser = readSession()?.account?.id || null;
    userId.current = expectedUser;
    setSettings(null);
    setStatus("");
    setFailed(false);
    setPushSupportMessage(customerPushSupportMessage());
    void requestDashboardJson("/api/venue/notification-settings", { cache: "no-store", timeoutMs: 15_000, signal: controller.signal, fallbackMessage: "Unable to load notification preferences." }).then(async data => {
      if (controller.signal.aborted || !mounted.current) return;
      if (!data.settings || !expectedUser || data.userId !== expectedUser || readSession()?.account?.id !== expectedUser) throw new Error("Reopen settings to load your account preferences.");
      setSettings(data.settings);
      setDelivery(data.delivery || {});
      const enabled = await customerPushDeviceEnabled(expectedUser);
      if (!controller.signal.aborted && mounted.current) setPushDeviceEnabled(enabled);
    }).catch(error => {
      if (!controller.signal.aborted && mounted.current) { setFailed(true); setStatus(error.message || "Unable to load notification preferences."); }
    });
    return () => { mounted.current = false; controller.abort(); saveAbort.current?.abort(); };
  }, [attempt]);

  async function save(key: VenueNotificationKey, next = !settings?.[key]) {
    const expectedUser = userId.current;
    if (!settings || pending.current || !expectedUser || readSession()?.account?.id !== expectedUser) return;
    const controller = new AbortController();
    saveAbort.current = controller;
    pending.current = true;
    setSaving(key);
    setStatus("");
    setFailed(false);
    const assertCurrent = () => {
      if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedUser) throw new Error("Your session changed. Reopen notification preferences.");
    };
    let confirmed = false;
    try {
      if (key === "pushEnabled" && next) await enableCustomerPush(delivery, expectedUser, assertCurrent);
      assertCurrent();
      const data = await requestDashboardJson("/api/venue/notification-settings", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { [key]: next } }),
        timeoutMs: 15_000, signal: controller.signal, fallbackMessage: "Unable to save notification preferences.",
      });
      assertCurrent();
      if (data.userId !== expectedUser || data.settings?.[key] !== next) throw new Error("Your preference could not be confirmed. Please try again.");
      confirmed = true;
      setSettings(data.settings);
      if (key === "pushEnabled") {
        if (!next) await disableCustomerPush();
        assertCurrent();
        setPushDeviceEnabled(next);
      }
      setStatus("Preferences saved.");
      onSaved?.();
    } catch (error) {
      if (!confirmed && key === "pushEnabled" && next && readSession()?.account?.id === expectedUser) await disableCustomerPush();
      if (mounted.current && !controller.signal.aborted) { setFailed(true); setStatus(error instanceof Error ? error.message : "Unable to save notification preferences."); }
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  const row = (key: VenueNotificationKey, title: string, description: string, unavailable = false) => <div className="venue-preference-row" key={key}>
    <span><strong>{title}</strong><small>{description}</small></span>
    <button className="venue-notification-switch" type="button" role="switch" aria-label={title} aria-checked={Boolean(settings?.[key])}
      aria-busy={saving === key || undefined} disabled={saving !== null || unavailable} onClick={() => void save(key)}>
      <span className="venue-switch-track" aria-hidden="true"><i /></span>
      <span className="venue-switch-state" aria-hidden="true">{saving === key ? "…" : settings?.[key] ? "On" : "Off"}</span>
    </button>
  </div>;

  return <article className="info-panel venue-notification-preferences" id="venue-notification-settings" tabIndex={-1} aria-label="Notification preferences">
    <header><h2>Notification preferences</h2><p>Choose the updates you want about your club. These settings apply to your account.</p></header>
    {settings ? <>
      {row("alertsEnabled", "Venue alerts", "Pause or resume your optional venue notifications.")}
      {!settings.alertsEnabled ? <p>Venue alerts are paused. Your individual choices are saved below.</p> : null}
      <div className="venue-preference-list" aria-label="Venue alert types">
        {VENUE_NOTIFICATION_ALERTS.map(({ key, title, description }) => row(key, title, description))}
      </div>
      <div className="venue-delivery-heading"><h3>Delivery options</h3><p>Your selected alerts appear here. Email and push are optional.</p></div>
      <div className="venue-preference-list">
        {row("emailEnabled", "Email", delivery.emailAvailable ? "Send selected alerts to your account email." : "Email alerts are not available right now.", !delivery.emailAvailable && !settings.emailEnabled)}
        {row("pushEnabled", "Push notifications", !delivery.pushAvailable ? "Push notifications are not available right now." : pushSupportMessage || (pushDeviceEnabled ? "Enabled on this device." : "Allow alerts from your browser, even when MyDancr is closed."), (!delivery.pushAvailable || Boolean(pushSupportMessage)) && !settings.pushEnabled)}
      </div>
      {settings.pushEnabled && !pushDeviceEnabled && delivery.pushAvailable && !pushSupportMessage ? <button type="button" disabled={saving !== null} onClick={() => void save("pushEnabled", true)}>Enable push on this device</button> : null}
      <p>Essential account, security, and legal messages stay on. Muted alerts are hidden from your inbox, not deleted.</p>
    </> : failed ? <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button> : <p role="status">Loading preferences…</p>}
    {status ? <p className="venue-preferences-status" role={failed ? "alert" : "status"}>{status}</p> : null}
  </article>;
}
