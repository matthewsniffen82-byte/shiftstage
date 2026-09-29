import "server-only";
import { createHash, randomUUID } from "node:crypto";
import webPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { webPushConfig } from "./web-push-config";
import { webPushSubscription } from "./web-push-subscriptions";

type PushMessage = { title: string; body: string; url: string; ttl: number };

export async function deliverWebPush(client: SupabaseClient, userId: string, message: PushMessage, deliveryId?: string) {
  const config = webPushConfig();
  if (!config) return false;
  const { data, error } = await client.from("web_push_subscriptions")
    .select("endpoint_hash, endpoint, p256dh, auth").eq("user_id", userId).eq("vapid_public_key", config.publicKey).limit(12);
  if (error) throw error;
  if (!data?.length) return false;
  const messageId = deliveryId || randomUUID();
  let received = new Set<string>();
  if (deliveryId) {
    const result = await client.from("web_push_receipts").select("endpoint_hash").eq("delivery_id", deliveryId);
    if (result.error) throw result.error;
    received = new Set((result.data || []).map(row => row.endpoint_hash));
  }
  // Independent devices are sent concurrently within one bounded queue lease.
  const outcomes = await Promise.all(data.map(async device => {
    if (received.has(device.endpoint_hash)) return "accepted";
    try {
      const subscription = webPushSubscription({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } });
      const payload = JSON.stringify({ id: messageId, accountId: userId, title: message.title.slice(0, 120), body: message.body.slice(0, 600), url: message.url, expiresAt: Date.now() + message.ttl * 1000 });
      const details = webPush.generateRequestDetails(subscription, payload, {
        vapidDetails: config, TTL: message.ttl, urgency: "high", contentEncoding: "aes128gcm",
        topic: createHash("sha256").update(messageId).digest("base64url").slice(0, 32),
      });
      // Use fetch for a total deadline and to reject redirects to untrusted hosts.
      const response = await fetch(details.endpoint, {
        method: "POST", headers: details.headers as Record<string, string>, body: new Uint8Array(details.body!),
        redirect: "error", signal: AbortSignal.timeout(8_000), cache: "no-store",
      });
      try {
        if (response.status === 404 || response.status === 410) {
          const removed = await client.from("web_push_subscriptions").delete().eq("endpoint_hash", device.endpoint_hash).eq("user_id", userId);
          if (removed.error) return "retry";
          return "expired";
        }
        if (!response.ok) return "retry";
        if (deliveryId) {
          const saved = await client.from("web_push_receipts").upsert({ delivery_id: deliveryId, endpoint_hash: device.endpoint_hash }, { onConflict: "delivery_id,endpoint_hash", ignoreDuplicates: true });
          if (saved.error) return "retry";
        }
        return "accepted";
      } finally { try { void response.body?.cancel().catch(() => {}); } catch { /* Cleanup cannot undo acceptance. */ } }
    } catch {
      // Subscription URLs, encryption keys and provider response bodies are private.
      console.warn("WEB_PUSH_DELIVERY_RETRY");
      return "retry";
    }
  }));
  return outcomes.includes("accepted") && !outcomes.includes("retry");
}
