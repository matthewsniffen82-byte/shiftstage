import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithServerJob, serverJobRemainingMs } from "../server-job";
import { deliverNotificationRows } from "./notification-delivery";
import { notificationPushDelivery } from "./customer-notification-delivery";

type Delivery = {
  id: string; lease_id: string; recipient_id: string; channel: "email" | "push";
  table_label: string; venue_name: string;
};

export async function deliverDancerTableRequestAlerts(client: SupabaseClient, requestId?: string, options: { deadline?: number } = {}) {
  const channels = [
    ...(process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? ["email"] : []),
    ...(notificationPushDelivery("").pushAvailable ? ["push"] : []),
  ];
  const counts = { configured: channels.length > 0, sent: 0, skipped: 0, retry: 0 };
  const budget = Math.floor(Math.min(50_000, (options.deadline ?? Infinity) - performance.now()));
  if (!counts.configured || budget < 40_000) return counts;
  return runWithServerJob(async () => {
    for (let wave = 0; wave < 3 && serverJobRemainingMs() >= 40_000; wave++) {
      const { data, error } = await runWithServerJob(async () => await client.rpc("claim_dancer_table_request_alerts", {
        p_request_id: requestId || null, p_limit: 4, p_channels: channels,
      }), 5_000);
      if (error) throw error;
      const jobs: Delivery[] = data || [];
      if (!jobs.length) break;
      const finished = await Promise.allSettled(jobs.map(async job => {
        let outcome: "sent" | "retry" = "retry";
        try {
          const result = await runWithServerJob(() => deliverNotificationRows(client, [{
            deliveryId: job.id, recipient_id: job.recipient_id, notification_type: "support_message",
            title: "New table request",
            body: `${job.table_label} at ${job.venue_name} requested you. Check with club staff for the current status.`,
            payload: { kind: "dancer_table_request" },
          }], { email: job.channel === "email", push: job.channel === "push" }), 30_000);
          if (result[job.channel] === 1) outcome = "sent";
        } catch { console.warn("DANCER_TABLE_REQUEST_ALERT_RETRY"); }
        const receipt = await runWithServerJob(async () => await client.rpc("finish_dancer_table_request_alert", {
          p_id: job.id, p_lease_id: job.lease_id, p_outcome: outcome,
        }), 5_000);
        if (receipt.error || receipt.data !== true) throw new Error("Dancer alert acknowledgement unavailable.");
        counts[outcome] += 1;
      }));
      const failure = finished.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
    return counts;
  }, budget);
}
