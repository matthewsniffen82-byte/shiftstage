import "server-only";
import { createHash, ECDH } from "node:crypto";
import { PublicApiError } from "../api-error-policy";

export function webPushEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw invalidSubscription();
  try {
    const url = new URL(value);
    const host = url.hostname;
    // Only browser-operated push services are eligible outbound destinations.
    const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com"
      || host === "web.push.apple.com" || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(host);
    if (!allowed || url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.pathname === "/") throw invalidSubscription();
    return url.href;
  } catch { throw invalidSubscription(); }
}

export function webPushSubscription(value: unknown) {
  const input = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = webPushEndpoint(input?.endpoint);
  const p256dh = readKey(input?.keys?.p256dh, 65);
  const auth = readKey(input?.keys?.auth, 16);
  try { ECDH.convertKey(Buffer.from(p256dh, "base64url"), "prime256v1"); } catch { throw invalidSubscription(); }
  return { endpoint, keys: { p256dh, auth } };
}

export const webPushEndpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
function readKey(value: unknown, length: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 100) throw invalidSubscription();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value.replace(/=+$/, "")) throw invalidSubscription();
  return bytes.toString("base64url");
}
function invalidSubscription() { return new PublicApiError("INVALID_REQUEST", "This browser's notification subscription is invalid. Try enabling alerts again.", 400); }
