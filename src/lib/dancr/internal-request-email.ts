import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithServerJob, serverJobRemainingMs } from "../server-job";
import { deliverNotificationRows } from "./notification-delivery";
import { venueNotificationSettings } from "./venue-notification-preferences";
import type { InternalPushOptions } from "./internal-request-push";

type Delivery = {
  id: string; lease_id: string; recipient_id: string; table_label: string;
  stage_name: string; venue_name: string; event_kind: "requested" | "cancelled";
};

export async function deliverInternalRequestEmail(client: SupabaseClient, requestId?: string, options: InternalPushOptions = {}) {
  const counts = { configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), sent: 0, skipped: 0, retry: 0 };
  const budget = Math.floor(Math.min(50_000, (options.deadline ?? Infinity) - performance.now()));
  if (!counts.configured || budget < 40_000) return counts;
  return runWithServerJob(async () => {
    for (let wave = 0; wave < 3 && serverJobRemainingMs() >= 40_000; wave++) {
      const { data, error } = await runWithServerJob(async () => await client.rpc("claim_internal_request_emails", {
        p_request_id: requestId || null, p_limit: 4, p_event_kind: options.event || null,
      }), 5_000);
      if (error) throw error;
      const jobs: Delivery[] = data || [];
      if (!jobs.length) break;
      const finished = await Promise.allSettled(jobs.map(async job => {
        let outcome: "sent" | "skipped" | "retry" = "retry";
        try {
          outcome = await runWithServerJob(async () => {
            const { data: auth, error: authError } = await client.auth.admin.getUserById(job.recipient_id);
            if (authError || !auth.user) throw new Error("Email preferences unavailable.");
            const settings = venueNotificationSettings(auth.user.user_metadata);
            if (!settings.alertsEnabled || !settings.tableRequests || !settings.emailEnabled) return "skipped" as const;
            const cancelled = job.event_kind === "cancelled";
            const result = await deliverNotificationRows(client, [{
              deliveryId: job.id, recipient_id: job.recipient_id, notification_type: "support_message",
              title: cancelled ? "Table request cancelled" : "New table request",
              body: cancelled
                ? `${job.table_label} at ${job.venue_name} cancelled the request for ${job.stage_name}.`
                : `${job.table_label} at ${job.venue_name} requested ${job.stage_name}. Open your club dashboard for the current status.`,
              payload: { kind: "internal_table_request", ...(cancelled ? { event: "cancelled" } : {}) },
            }], { email: true, push: false });
            return result.email === 1 ? "sent" as const : "retry" as const;
          }, 30_000);
        } catch { console.warn("INTERNAL_REQUEST_EMAIL_RETRY"); }
        const receipt = await runWithServerJob(async () => await client.rpc("finish_internal_request_email", {
          p_id: job.id, p_lease_id: job.lease_id, p_outcome: outcome,
        }), 5_000);
        if (receipt.error || receipt.data !== true) throw new Error("Email delivery acknowledgement unavailable.");
        counts[outcome] += 1;
      }));
      const failure = finished.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
    return counts;
  }, budget);
}
