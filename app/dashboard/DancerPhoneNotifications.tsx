"use client";

import { useEffect, useState } from "react";
import { customerPushDeviceEnabled } from "@/src/lib/dancr/customer-push";
import { readSession } from "./dashboard-session";

export default function DancerPhoneNotifications() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      const account = readSession()?.account;
      setEnabled(null);
      if (!account?.id || account.role !== "dancer") return;
      const deviceEnabled = await customerPushDeviceEnabled(account.id);
      if (active && request === sequence && readSession()?.account?.id === account.id) {
        setEnabled(deviceEnabled);
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
  }, []);

  return <section className="dancer-notification-priority" id="dancer-phone-notifications" aria-labelledby="dancer-phone-notifications-heading">
    <div className="dancer-notification-priority-heading">
      <span className="dancer-notification-priority-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>
      <div><h2 id="dancer-phone-notifications-heading">Don’t miss a request</h2><p>Get phone notifications for table and VIP requests.</p></div>
    </div>
    <p className="dancer-notification-device-status" role="status">{enabled === null ? "Checking phone notifications…" : enabled ? "Phone notifications are enabled on this device." : "Phone notifications are off on this device."}</p>
    <button className="primary-link dancer-notification-priority-action" type="button" data-push-settings>{enabled === null ? "Notification settings" : enabled ? "Manage notifications" : "Enable notifications"}</button>
    <div className="dancer-notification-email-note">
      <h3>You’ll also get email alerts</h3>
      <p>Table and VIP requests are also sent to your account email.</p>
      <p>Turn on notifications for your email app to see these alerts on your phone.</p>
    </div>
  </section>;
}
