"use client";

import { useEffect, useState } from "react";
import { readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { customerPushDeviceEnabled } from "@/src/lib/dancr/customer-push";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";
import { requestPickupJson } from "./pickup-session";

type Availability = "loading" | "available" | "unavailable" | "error";

export default function PickupPushNotifications({ role }: { role: "customer" | "venue" }) {
  const [enabled, setEnabled] = useState(false);
  const [availability, setAvailability] = useState<Availability>("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false, revision = 0;
    let controller: AbortController | null = null;
    const refresh = async () => {
      const sequence = ++revision;
      controller?.abort();
      controller = new AbortController();
      setAvailability("loading");
      setEnabled(false);
      const account = readBrowserAuthSession()?.account;
      const userId = typeof account?.id === "string" && account.role === role ? account.id : "";
      if (!userId) return;
      const [next, result] = await Promise.all([
        customerPushDeviceEnabled(userId),
        requestPickupJson("/api/notifications", { expectedRole: role, signal: controller.signal }).catch(() => null),
      ]);
      const current = readBrowserAuthSession()?.account;
      if (!cancelled && sequence === revision && current?.id === userId && current.role === role) {
        setEnabled(next);
        setAvailability(result?.pushUserId !== userId ? "error"
          : result.notificationDelivery?.pushAvailable === true ? "available" : "unavailable");
      }
    };
    void refresh();
    window.addEventListener("mydancr:push-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      controller?.abort();
      window.removeEventListener("mydancr:push-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [role, retry]);

  return <aside aria-label="Pickup notifications">
    <p>{availability === "loading" ? "Checking notification availability…"
      : availability === "unavailable" ? "Push alerts are currently unavailable. Keep checking Pickup chats for new messages."
      : availability === "error" ? "Unable to check push availability. Keep checking Pickup chats for new messages."
      : enabled ? "Push notifications are enabled on this device."
      : role === "venue"
      ? "Get push alerts for new pickup requests and customer messages, even when you leave this page."
      : "Get push alerts for venue replies and pickup updates, even when you leave this chat."}</p>
    {(enabled || availability === "available") && <button type="button" onClick={() => offerPushNotifications("settings")}>
      {enabled ? "Manage pickup notifications" : "Enable pickup notifications"}
    </button>}
    {availability === "error" && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry notification check</button>}
  </aside>;
}
