import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithServerJob, serverJobRemainingMs } from "../server-job";
import { deliverNotificationRows } from "./notification-delivery";
import { venueNotificationSettings } from "./venue-notification-preferences";
import { notificationPushDelivery } from "./customer-notification-delivery";

type Delivery = { id: string; lease_id: string; recipient_id: string; table_label: string; stage_name: string; event_kind: "requested" | "cancelled" };
export type InternalPushOptions = { event?: Delivery["event_kind"]; deadline?: number };

export async function deliverInternalRequestPush(client: SupabaseClient, requestId?: string, options: InternalPushOptions = {}) {
  const counts = { configured: notificationPushDelivery("").pushAvailable, sent: 0, skipped: 0, retry: 0 };
  const budget = Math.floor(Math.min(50_000, (options.deadline ?? Infinity) - performance.now()));
  if (!counts.configured || budget < 40_000) return counts;
  return runWithServerJob(async () => {
    for (let wave = 0; wave < 3; wave++) {
      // Reserve 5s to claim, 30s to deliver and 5s to acknowledge the next wave.
      // The rest of the queue stays available to other workers.
      if (serverJobRemainingMs() < 40_000) break;
      const { data, error } = await runWithServerJob(async () => await client.rpc("claim_internal_request_alerts", {
        p_request_id: requestId || null, p_limit: 4, p_event_kind: options.event || null,
      }), 5_000);
      if (error) throw error;
      const jobs: Delivery[] = data || [];
      if (!jobs.length) break;
      // Settle every claimed job before returning, including when one receipt fails.
      const finished = await Promise.allSettled(jobs.map(async job => {
        let outcome: "sent" | "skipped" | "retry" = "retry";
        try {
          outcome = await runWithServerJob(async () => {
            const { data: auth, error: authError } = await client.auth.admin.getUserById(job.recipient_id);
            if (authError || !auth.user) throw new Error("Push preferences unavailable.");
            const settings = venueNotificationSettings(auth.user.user_metadata);
            if (!settings.alertsEnabled || !settings.tableRequests || !settings.pushEnabled) return "skipped" as const;
            const cancelled = job.event_kind === "cancelled";
            const result = await deliverNotificationRows(client, [{
              deliveryId: job.id, recipient_id: job.recipient_id, notification_type: "support_message",
              title: cancelled ? "Table request cancelled" : "MyDancr Internal",
              body: cancelled ? `${job.table_label} cancelled the request for ${job.stage_name}.` : `${job.table_label} wants ${job.stage_name}.`,
              payload: { kind: "internal_table_request", ...(cancelled ? { event: "cancelled" } : {}) },
            }], { email: false });
            return result.push === 1 ? "sent" as const : "retry" as const;
          }, 30_000);
        } catch { console.warn("INTERNAL_REQUEST_PUSH_RETRY"); }
        const receipt = await runWithServerJob(async () => await client.rpc("finish_internal_request_push", {
          p_id: job.id, p_lease_id: job.lease_id, p_outcome: outcome,
        }), 5_000);
        if (receipt.error || receipt.data !== true) throw new Error("Push delivery acknowledgement unavailable.");
        counts[outcome] += 1;
      }));
      const failure = finished.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
    return counts;
  }, budget);
}
