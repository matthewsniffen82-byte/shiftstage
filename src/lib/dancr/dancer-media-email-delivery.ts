import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAppUrl } from "./public-app-url";

type Job = { id: string; lease_id: string };
type Target = { email: string; title: string; body: string; payload: Record<string, unknown> };
type Result = { status: "accepted" | "retry" | "failed" | "skipped"; outcome: string; providerId?: string };
export function dancerMediaEmailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }

export function dancerMediaEmailContent(target: Target) {
  const path = String(target.payload.emailPath || "");
  const safePath = /^\/dashboard\/dancer#dancer-(?:main-photo|photos-title|videos-title)$/.test(path)
    ? path : "/dashboard/dancer#dancer-photos-title";
  const url = `${publicAppUrl()}${safePath}`;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return { subject: target.title, text: `${target.body}\n\nUpdate your media:\n${url}`,
    html: `<p>${escape(target.body)}</p><p><a href="${escape(url)}">Update your media</a></p>` };
}

export async function sendDancerMediaEmail(job: Job, target: Target): Promise<Result> {
  if (!dancerMediaEmailConfigured()) return { status: "retry", outcome: "email_not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": `dancer-media/${job.id}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [target.email], ...dancerMediaEmailContent(target) }),
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

export async function deliverDancerMediaEmails(client: SupabaseClient, budgetMs = 42_000) {
  const counts = { configured: dancerMediaEmailConfigured(), accepted: 0, retry: 0, skipped: 0, failed: 0 };
  if (!counts.configured) return counts;
  const deadline = performance.now() + budgetMs;
  while (performance.now() + 14_000 < deadline) {
    const jobs: Job[] = await rpc(client, "claim_dancer_media_emails") || [];
    if (!jobs.length) break;
    for (const job of jobs) {
      let result: Result;
      try {
        const target: Target | null = await rpc(client, "dancer_media_email_target", { p_id: job.id, p_lease: job.lease_id });
        result = target ? await sendDancerMediaEmail(job, target) : { status: "skipped", outcome: "recipient_or_review_changed" };
      } catch { result = { status: "retry", outcome: "target_unavailable" }; }
      const finished = await rpc(client, "finish_dancer_media_email", { p_id: job.id, p_lease: job.lease_id,
        p_status: result.status, p_outcome: result.outcome, p_provider_id: result.providerId || null });
      if (!finished) throw new Error("Dancer media email receipt could not be saved.");
      counts[result.status]++;
    }
  }
  return counts;
}
