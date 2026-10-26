import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offerDigestEmail, type OfferDigestItem } from "./venue-campaign-content";
import { publicAppUrl } from "./public-app-url";
import { webPushConfig } from "./web-push-config";
import { deliverWebPush } from "./web-push-delivery";

export function campaignChannels() {
  const worker = Boolean(process.env.CRON_SECRET);
  return { in_app: true, email: worker && Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), push: worker && Boolean(webPushConfig()) };
}
type DeliveryResult = { status: "accepted" | "failed" | "retry" | "skipped"; outcome: string; providerId?: string };
export async function sendOfferDigest(input: { id: string; email: string; token: string; items: OfferDigestItem[] }): Promise<DeliveryResult> {
  if (!campaignChannels().email) return { status: "retry", outcome: "email_unavailable" };
  if (!/^[a-f0-9]{64}$/.test(input.token) || !input.items.length) return { status: "skipped", outcome: "invalid_target" };
  const content = offerDigestEmail(input.items, publicAppUrl(), input.token);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": `club-offer-digest/${input.id}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.email], ...content,
        headers: { "List-Unsubscribe": `<${publicAppUrl()}/api/public/customer-email?token=${input.token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { status: response.status === 429 || response.status >= 500 ? "retry" : "failed", outcome: `provider_${response.status}` };
    }
    const data = await response.json();
    return typeof data.id === "string" && data.id ? { status: "accepted", outcome: "provider_accepted", providerId: data.id } : { status: "retry", outcome: "uncertain_acceptance" };
  } catch { return { status: "retry", outcome: "provider_unavailable" }; }
}
async function rpc(admin: SupabaseClient, name: string, args: Record<string, unknown>) {
  const result = await admin.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}
type Job = { id: string; lease_id: string };
export async function deliverVenueCampaigns(admin: SupabaseClient, budgetMs = 42_000) {
  const channels = campaignChannels();
  const counts = { pushAccepted: 0, emailAccepted: 0, skipped: 0, retry: 0, failed: 0 };
  const deadline = performance.now() + budgetMs;
  for (let wave = 0; wave < 30 && performance.now() < deadline - 18_000; wave++) {
    const digests: Job[] = channels.email ? await rpc(admin, "claim_club_offer_digests", { p_limit: 2 }) || [] : [];
    await Promise.all(digests.map(async job => {
      let result: DeliveryResult;
      try {
        const target = await rpc(admin, "club_offer_digest_target", { p_id: job.id, p_lease: job.lease_id });
        result = target ? await sendOfferDigest({ id: job.id, ...target }) : { status: "skipped", outcome: "preferences_changed" };
      } catch { result = { status: "retry", outcome: "target_unavailable" }; }
      if (!await rpc(admin, "finish_club_offer_digest", { p_id: job.id, p_lease: job.lease_id, p_status: result.status, p_outcome: result.outcome, p_provider_id: result.providerId || null })) throw new Error("Digest receipt unavailable.");
      if (result.status === "accepted") counts.emailAccepted++; else counts[result.status]++;
    }));
    if (performance.now() >= deadline - 10_000) break;
    const pushes: Job[] = channels.push ? await rpc(admin, "claim_venue_offer_push", { p_limit: 4 }) || [] : [];
    await Promise.all(pushes.map(async job => {
      let status: "accepted" | "skipped" | "retry" = "retry";
      try {
        const target = await rpc(admin, "venue_offer_push_target", { p_id: job.id, p_lease: job.lease_id });
        if (!target) status = "skipped";
        else status = await deliverWebPush(admin, target.userId, {
          title: `New offer from ${target.venueName}`, body: "Open MyDancr Alerts to view this club offer.",
          url: `${publicAppUrl()}/dashboard/customer#customer-alerts`, ttl: 3600,
        }, target.notificationId) ? "accepted" : "retry";
      } catch { /* Failed preference reads never permit a send. */ }
      if (!await rpc(admin, "finish_venue_offer_push", { p_id: job.id, p_lease: job.lease_id, p_status: status })) throw new Error("Push receipt unavailable.");
      if (status === "accepted") counts.pushAccepted++; else counts[status]++;
    }));
    if (!digests.length && !pushes.length) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return counts;
}
