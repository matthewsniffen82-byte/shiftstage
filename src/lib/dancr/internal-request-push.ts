import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows } from "./notification-delivery";
import { venueNotificationSettings } from "./venue-notification-preferences";
import { notificationPushDelivery } from "./customer-notification-delivery";

type Delivery = { id: string; lease_id: string; recipient_id: string; table_label: string; stage_name: string };

export async function deliverInternalRequestPush(client: SupabaseClient, requestId?: string) {
  // Leave the queue untouched while the provider is unconfigured.
  if (!notificationPushDelivery("").pushAvailable) return { configured: false, sent: 0, skipped: 0, retry: 0 };
  const { data, error } = await client.rpc("claim_internal_request_push", { p_request_id: requestId || null, p_limit: 12 });
  if (error) throw error;
  const counts = { configured: true, sent: 0, skipped: 0, retry: 0 };
  const jobs: Delivery[] = data || [];
  // A 90-second database lease covers this bounded batch (three 10-second waves).
  for (let offset = 0; offset < jobs.length; offset += 4) {
    await Promise.all(jobs.slice(offset, offset + 4).map(async job => {
      let outcome: "sent" | "skipped" | "retry" = "retry";
      try {
        const { data: auth, error: authError } = await client.auth.admin.getUserById(job.recipient_id);
        if (authError || !auth.user) throw new Error("Push preferences unavailable.");
        const settings = venueNotificationSettings(auth.user.user_metadata);
        if (!settings.alertsEnabled || !settings.tableRequests || !settings.pushEnabled) outcome = "skipped";
        else {
          const result = await deliverNotificationRows(client, [{
            deliveryId: job.id, recipient_id: job.recipient_id, notification_type: "support_message",
            title: "MyDancr Internal", body: `${job.table_label} wants ${job.stage_name}.`,
            payload: { kind: "internal_table_request" },
          }], { email: false });
          if (result.push === 1) outcome = "sent";
        }
      } catch { console.warn("INTERNAL_REQUEST_PUSH_RETRY"); }
      // Accepted devices have durable receipts; retries reuse the notification ID.
      const finished = await client.rpc("finish_internal_request_push", { p_id: job.id, p_lease_id: job.lease_id, p_outcome: outcome });
      if (finished.error || finished.data !== true) throw new Error("Push delivery acknowledgement unavailable.");
      counts[outcome] += 1;
    }));
  }
  return counts;
}
