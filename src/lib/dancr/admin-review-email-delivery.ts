import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAppUrl } from "./public-app-url";
import { adminReviewEmailPath } from "./admin-review-email-links";

type Job = { id: string; lease_id: string };
type Target = { email: string; kind: string; title: string; body: string; sourceId: string };
type Result = { status: "accepted" | "retry" | "failed" | "skipped"; outcome: string; providerId?: string };
export function adminReviewEmailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }

export function adminReviewEmailContent(target: Target) {
  const url = `${publicAppUrl()}${adminReviewEmailPath(target.kind)}`;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const reference = `Reference: ${target.sourceId}`;
  return { subject: `${target.title} | MyDancr`, text: `${target.body}\n\n${reference}\n\nReview in Site Admin:\n${url}`,
    html: `<p>${escape(target.body)}</p><p>${escape(reference)}</p><p><a href="${escape(url)}">Review in Site Admin</a></p>` };
}

export async function sendAdminReviewEmail(job: Job, target: Target): Promise<Result> {
  if (!adminReviewEmailConfigured()) return { status: "retry", outcome: "email_not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": `admin-review-email/${job.id}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [target.email], ...adminReviewEmailContent(target) }),
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

export async function deliverAdminReviewEmails(client: SupabaseClient, budgetMs = 42_000) {
  const counts = { configured: adminReviewEmailConfigured(), accepted: 0, retry: 0, skipped: 0, failed: 0 };
  if (!counts.configured) return counts;
  const deadline = performance.now() + budgetMs;
  while (performance.now() + 14_000 < deadline) {
    const jobs: Job[] = await rpc(client, "claim_admin_review_emails", { p_limit: 1 }) || [];
    if (!jobs.length) break;
    for (const job of jobs) {
      let result: Result;
      try {
        const target: Target | null = await rpc(client, "admin_review_email_target", { p_id: job.id, p_lease: job.lease_id });
        result = target ? await sendAdminReviewEmail(job, target) : { status: "skipped", outcome: "recipient_or_access_changed" };
      } catch { result = { status: "retry", outcome: "target_unavailable" }; }
      const finished = await rpc(client, "finish_admin_review_email", { p_id: job.id, p_lease: job.lease_id,
        p_status: result.status, p_outcome: result.outcome, p_provider_id: result.providerId || null });
      if (!finished) throw new Error("Admin email receipt could not be saved.");
      counts[result.status]++;
    }
  }
  return counts;
}
