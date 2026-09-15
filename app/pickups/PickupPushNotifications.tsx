"use client";

import { useEffect, useState } from "react";
import { readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { customerPushDeviceEnabled } from "@/src/lib/dancr/customer-push";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";

export default function PickupPushNotifications({ role }: { role: "customer" | "venue" }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false, revision = 0;
    const refresh = async () => {
      const sequence = ++revision;
      const account = readBrowserAuthSession()?.account;
      const userId = typeof account?.id === "string" && account.role === role ? account.id : "";
      const next = userId ? await customerPushDeviceEnabled(userId) : false;
      if (!cancelled && sequence === revision && readBrowserAuthSession()?.account?.id === account?.id) setEnabled(next);
    };
    void refresh();
    window.addEventListener("mydancr:push-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("mydancr:push-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [role]);

  return <aside aria-label="Pickup notifications">
    <p>{role === "venue"
      ? "Get push alerts for new pickup requests and customer messages, even when you leave this page."
      : "Get push alerts for venue replies and pickup updates, even when you leave this chat."}</p>
    <button type="button" onClick={() => offerPushNotifications("settings")}>
      {enabled ? "Manage pickup notifications" : "Enable pickup notifications"}
    </button>
  </aside>;
}
