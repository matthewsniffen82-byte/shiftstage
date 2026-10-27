import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAppUrl } from "./public-app-url";
import { venueNotificationEnabled } from "./venue-notification-preferences";

type Job = { id: string; lease_id: string };
type Target = { email: string; title: string; body: string; notification_type: string; payload: Record<string, unknown>; metadata: unknown };
type Result = { status: "accepted" | "retry" | "failed" | "skipped"; outcome: string; providerId?: string };

export function venueEmailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }

export function venueEmailContent(target: Target) {
  const review = target.payload.event === "venue_page_review";
  const path = String(review ? "/dashboard/venue#venue-publication" : target.payload.emailPath || "/dashboard/venue");
  // Never follow a caller-provided external URL or include capability links.
  const safePath = /^\/dashboard\/venue(?:#[a-z0-9-]+)?$/.test(path) ? path : "/dashboard/venue";
  const url = `${publicAppUrl()}${safePath}`;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const action = review ? "Review your club page" : "Open your club dashboard";
  return { subject: target.title, text: `${target.body}\n\n${action}:\n${url}`,
    html: `<p>${escape(target.body)}</p><p><a href="${escape(url)}">${action}</a></p>` };
}

export async function sendVenueEmail(job: Job, target: Target): Promise<Result> {
  if (!venueEmailConfigured()) return { status: "retry", outcome: "email_not_configured" };
  if (!venueNotificationEnabled(target.metadata, target, "emailEnabled")) return { status: "skipped", outcome: "preferences_off" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": `venue-email/${job.id}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [target.email], ...venueEmailContent(target) }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { status: response.status === 429 || response.status >= 500 ? "retry" : "failed", outcome: `provider_${response.status}` };
    }
    const data = await response.json();
    return typeof data.id === "string" && data.id ? { status: "accepted", outcome: "provider_accepted", providerId: data.id }
      : { status: "retry", outcome: "uncertain_acceptance" };
  } catch { return { status: "retry", outcome: "provider_unavailable" }; }
}

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const result = await client.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

export async function deliverVenueEmails(client: SupabaseClient, budgetMs = 42_000) {
  const counts = { configured: venueEmailConfigured(), accepted: 0, retry: 0, skipped: 0, failed: 0 };
  const deadline = performance.now() + budgetMs;
  // Queue generation is independent of the delivery provider, including during outages.
  await rpc(client, "prepare_venue_email_alerts");
  if (!counts.configured) return counts;
  while (performance.now() + 14_000 < deadline) {
    const jobs: Job[] = await rpc(client, "claim_venue_emails", { p_limit: 1 }) || [];
    if (!jobs.length) break;
    for (const job of jobs) {
      let result: Result;
      try {
        const target: Target | null = await rpc(client, "venue_email_target", { p_id: job.id, p_lease: job.lease_id });
        result = target ? await sendVenueEmail(job, target) : { status: "skipped", outcome: "recipient_or_access_changed" };
      } catch { result = { status: "retry", outcome: "target_unavailable" }; }
      const finished = await rpc(client, "finish_venue_email", { p_id: job.id, p_lease: job.lease_id,
        p_status: result.status, p_outcome: result.outcome, p_provider_id: result.providerId || null });
      if (!finished) throw new Error("Venue email receipt could not be saved.");
      counts[result.status]++;
    }
  }
  return counts;
}
