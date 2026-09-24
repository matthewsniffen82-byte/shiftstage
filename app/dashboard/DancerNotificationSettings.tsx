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
      setStatus("Saved.");
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Unable to save notification settings.");
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  return <section className="dancer-notification-settings" id="dancer-notification-settings" aria-label="Notification settings">
    <p>Choose which new activity appears in your inbox.</p>
    {settings ? <div className="dancer-notification-options">
      {DANCER_ACTIVITY_ALERTS.map(({ key, label }) => <label key={key}>
        <span>{label}</span>
        <input type="checkbox" role="switch" checked={settings[key]} disabled={saving !== null} aria-busy={saving === key} onChange={() => void save(key)} />
      </label>)}
    </div> : status ? <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button> : <p role="status">Loading settings…</p>}
    <p>Profile reviews, account updates, and support replies stay on. Existing notifications stay in your inbox.</p>
    <button type="button" data-push-settings>Push notifications on this device</button>
    {status ? <p role="status">{status}</p> : null}
  </section>;
}
