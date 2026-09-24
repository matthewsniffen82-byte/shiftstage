"use client";

import { useEffect, useRef, useState } from "react";
import { DANCER_ACTIVITY_ALERTS, type DancerNotificationKey, type DancerNotificationSettings } from "@/src/lib/dancr/dancer-notification-preferences";
import { readSession, requestDashboardJson } from "./dashboard-session";

export default function DancerNotificationSettings() {
  const [settings, setSettings] = useState<DancerNotificationSettings | null>(null);
  const [saving, setSaving] = useState<DancerNotificationKey | null>(null);
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const saveAbort = useRef<AbortController | null>(null);
  const userId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    userId.current = readSession()?.account?.id || null;
    setStatus("");
    void requestDashboardJson("/api/dancer/notification-settings", { cache: "no-store", timeoutMs: 15_000, signal: controller.signal, fallbackMessage: "Unable to load notification settings." }).then(data => {
      if (controller.signal.aborted || !mounted.current) return;
      if (!data.settings || data.userId !== userId.current || readSession()?.account?.id !== userId.current) throw new Error("Reopen settings to load your account preferences.");
      setSettings(data.settings);
    }).catch(error => {
      if (!controller.signal.aborted && mounted.current) setStatus(error.message || "Unable to load notification settings.");
    });
    return () => { mounted.current = false; controller.abort(); saveAbort.current?.abort(); };
  }, [attempt]);

  async function save(key: DancerNotificationKey) {
    if (!settings || pending.current || readSession()?.account?.id !== userId.current) return;
    const next = !settings[key];
    const controller = new AbortController();
    saveAbort.current = controller;
    pending.current = true;
    setSaving(key);
    setStatus("");
    try {
      const data = await requestDashboardJson("/api/dancer/notification-settings", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { [key]: next } }),
        timeoutMs: 15_000, signal: controller.signal, fallbackMessage: "Unable to save notification settings.",
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (data.userId !== userId.current || readSession()?.account?.id !== userId.current || data.settings?.[key] !== next) throw new Error("Your preference could not be confirmed. Please try again.");
      setSettings(data.settings);
      setStatus("Preferences saved.");
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Unable to save notification settings.");
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  return <article className="info-panel dancer-notification-settings" id="dancer-notification-settings" aria-labelledby="dancer-notification-preferences-heading" tabIndex={-1}>
    <div className="dancer-preferences-heading">
      <h2 id="dancer-notification-preferences-heading">Notification preferences</h2>
      <p>Choose the activity updates you want.</p>
    </div>
    {settings ? <>
      <div className="dancer-preference-row dancer-preference-master">
        <span><strong>Activity alerts</strong><small id="dancer-notify-activityAlertsEnabled-description">Pause or resume all five activity types.</small></span>
        <DancerNotificationSwitch label="Activity alerts" preferenceKey="activityAlertsEnabled" checked={settings.activityAlertsEnabled} disabled={saving !== null} busy={saving === "activityAlertsEnabled"} onChange={() => void save("activityAlertsEnabled")} />
      </div>
      {!settings.activityAlertsEnabled ? <p className="dancer-preferences-paused">Activity alerts are paused. Your choices below are saved.</p> : null}
      <div className="dancer-notification-options" aria-label="Activity types">
        {DANCER_ACTIVITY_ALERTS.map(({ key, label, description }) => <div className="dancer-preference-row" key={key}>
          <span><strong>{label}</strong><small id={`dancer-notify-${key}-description`}>{description}</small></span>
          <DancerNotificationSwitch label={label} preferenceKey={key} checked={settings[key]} disabled={saving !== null} busy={saving === key} onChange={() => void save(key)} />
        </div>)}
      </div>
    </> : status ? <button className="dancer-preferences-action" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button> : <p role="status">Loading preferences…</p>}
    <div className="dancer-preferences-delivery">
      <h3>Phone notifications</h3>
      <p>Manage push notifications on this device.</p>
      <button className="dancer-preferences-action" type="button" data-push-settings>Manage phone notifications</button>
    </div>
    <p className="dancer-preferences-essential">Club access, review decisions, account updates, and support replies stay on.</p>
    {status ? <p role="status">{status}</p> : null}
  </article>;
}

function DancerNotificationSwitch({ label, preferenceKey, checked, disabled, busy, onChange }: {
  label: string;
  preferenceKey: DancerNotificationKey;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  return <button className="dancer-notification-switch" type="button" role="switch" aria-label={label} aria-describedby={`dancer-notify-${preferenceKey}-description`} aria-checked={checked} aria-busy={busy || undefined} disabled={disabled} onClick={onChange}>
    <span className="dancer-switch-track" aria-hidden="true"><i /></span>
    <span className="dancer-switch-state" aria-hidden="true">{busy ? "Saving…" : checked ? "On" : "Off"}</span>
  </button>;
}
