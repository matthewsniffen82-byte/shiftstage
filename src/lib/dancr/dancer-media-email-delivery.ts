import "server-only";
import { emailHeaders } from "./email-routing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAppUrl } from "./public-app-url";
import { dancerVisibilityAlertPath } from "./dancer-visibility-alert-link";
import { notificationEmailUrl } from "./notification-email-link";

type Job = { id: string; lease_id: string };
type Target = { email: string; title: string; body: string; payload: Record<string, unknown> };
type Result = { status: "accepted" | "retry" | "failed" | "skipped"; outcome: string; providerId?: string };
export function dancerMediaEmailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }

function dancerEmailLink(payload: Target["payload"]) {
  if (payload.kind === "dancer_visibility_blocked") {
    return { action: "Review club media", path: dancerVisibilityAlertPath(payload) };
  }
  const summary = payload.kind === "dancer_media_review_summary" || payload.kind === "dancer_media_batch_result";
  const path = String(payload.emailPath || "");
  if (summary && (payload.action === "Review club media" || payload.action === "View club results")) {
    const mediaType = path === "/dashboard/dancer#dancer-videos-title" ? "videos" : "photos";
    return { action: payload.action, path: dancerVisibilityAlertPath({ venueId: payload.venueId, mediaType }) };
  }
  if (payload.kind === "dancer_profile_approved" || payload.kind === "dancer_club_request_declined" || (summary && payload.outcome === "approved")) {
    return { action: "Open dancer dashboard", path: "/dashboard/dancer" };
  }
  const actions = ["View results", "Choose main photo", "Upload main photo", "Replace media", "Continue setup"];
  const safePath = (summary && path === "/dashboard/dancer") || /^\/dashboard\/dancer#dancer-(?:main-photo|photos-title|videos-title)$/.test(path);
  const editorPath = safePath ? path : "/dashboard/dancer#dancer-photos-title";
  const venueId = typeof payload.venueId === "string" ? payload.venueId : "";
  const scoped = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(venueId) && editorPath.includes("#");
  return { action: summary && actions.includes(String(payload.action)) ? String(payload.action) : "Update your media",
    path: scoped ? editorPath.replace("#", `?mediaClub=${venueId}#`) : editorPath };
}

export function dancerMediaEmailContent(target: Target, alertUrl?: string) {
  const { action, path } = dancerEmailLink(target.payload);
  const url = alertUrl || `${publicAppUrl()}${path}`;
  const note = alertUrl?.includes("#link=") ? "This private link signs you in. Keep it to yourself." : "";
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return { subject: target.title, text: `${target.body}\n\n${action}:\n${url}${note ? "\n\n"+note : ""}`,
    html: `${target.body.split(/\n\s*\n/).map(paragraph => `<p>${escape(paragraph)}</p>`).join("")}<p><a href="${escape(url)}">${action}</a></p>${note ? "<p>"+note+"</p>" : ""}` };
}

export async function sendDancerMediaEmail(job: Job, target: Target, client: SupabaseClient): Promise<Result> {
  if (!dancerMediaEmailConfigured()) return { status: "retry", outcome: "email_not_configured" };
  try {
    const url = await notificationEmailUrl(client, { source: "dancer", deliveryId: job.id, role: "dancer", email: target.email }, dancerEmailLink(target.payload).path);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": `dancer-media/${job.id}` },
      body: JSON.stringify({ ...emailHeaders("notification"), to: [target.email], ...dancerMediaEmailContent(target, url) }),
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
        result = target ? await sendDancerMediaEmail(job, target, client) : { status: "skipped", outcome: "recipient_or_review_changed" };
      } catch { result = { status: "retry", outcome: "target_unavailable" }; }
      const finished = await rpc(client, "finish_dancer_media_email", { p_id: job.id, p_lease: job.lease_id,
        p_status: result.status, p_outcome: result.outcome, p_provider_id: result.providerId || null });
      if (!finished) throw new Error("Dancer media email receipt could not be saved.");
      counts[result.status]++;
    }
  }
  return counts;
}
