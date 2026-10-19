"use client";

import { useEffect, useState } from "react";
import { customerPushDeviceEnabled } from "@/src/lib/dancr/customer-push";
import { readSession, requestDashboardJson } from "./dashboard-session";
import "./dashboard-phone-notifications.css";

export default function DashboardPhoneNotifications({ role = "dancer", refreshKey = 0 }: {
  role?: "dancer" | "venue";
  refreshKey?: number;
}) {
  const [status, setStatus] = useState<{ deviceEnabled: boolean; venuePushEnabled: boolean | null } | null>(null);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      const account = readSession()?.account;
      setStatus(null);
      if (!account?.id || account.role !== role) return;
      const deviceEnabled = await customerPushDeviceEnabled(account.id);
      let venuePushEnabled: boolean | null = null;
      if (role === "venue" && deviceEnabled && active && request === sequence && readSession()?.account?.id === account.id) {
        try {
          const data = await requestDashboardJson("/api/venue/notification-settings", { cache: "no-store", timeoutMs: 15_000 });
          if (data.userId === account.id && data.settings) {
            venuePushEnabled = data.settings.alertsEnabled === true && data.settings.pushEnabled === true;
          }
        } catch { /* Keep a settings link when saved preferences cannot be confirmed. */ }
      }
      if (active && request === sequence && readSession()?.account?.id === account.id) {
        setStatus({ deviceEnabled, venuePushEnabled });
      }
    };
    const sync = () => { void refresh(); };
    sync();
    window.addEventListener("mydancr:push-changed", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("storage", sync);
    return () => {
      active = false;
      window.removeEventListener("mydancr:push-changed", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("storage", sync);
    };
  }, [role, refreshKey]);

  const enabled = status?.deviceEnabled ?? null;
  // Avoid flashing an enrollment prompt before the current device is checked.
  if (!status || (enabled && (role === "dancer" || status.venuePushEnabled))) return null;
  const reviewPreferences = role === "venue" && enabled;
  return <section className="dashboard-notification-prompt" id={`${role}-overview-notifications`} aria-labelledby={`${role}-overview-notifications-heading`}>
    <div className="dashboard-notification-prompt-copy">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <div><h2 id={`${role}-overview-notifications-heading`}>{reviewPreferences ? "Review notification settings" : "Enable notifications"}</h2>
        <p>{role === "dancer" ? "Get alerts for table and VIP requests. You’ll also receive them by email." : "Get alerts for table and VIP requests and important venue updates."}</p>
        {role === "venue" ? <p>Manage email alerts and request preferences in Account &amp; support.</p> : null}
      </div>
    </div>
    {reviewPreferences ? <a className="primary-link" href="#venue-notification-settings">Review settings</a>
      : <button className="primary-link" type="button" data-push-settings>Enable notifications</button>}
  </section>;
}
