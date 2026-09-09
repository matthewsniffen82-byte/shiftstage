import { androidDeviceClassScript } from "./android-device-script.mjs";

export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.onesignal.com https://onesignal.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' https://www.google.com https://onesignal.com",
  "img-src 'self' data: blob: https:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.onesignal.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");


// These pages render per request. Unknown paths use Next's static 404 and
// must retain its existing policy; a fresh nonce cannot match cached HTML.
const privateDocumentPaths = new Set([
  "/admin", "/admin/operations",
  "/dashboard/dancer", "/dashboard/dancer/tv",
  "/dashboard/venue", "/dashboard/agent",
  "/dashboard/customer", "/dashboard/customer/saved", "/dashboard/customer/offers",
  "/account", "/account/reset-password",
]);

export function isPrivateDocumentPath(pathname) {
  return privateDocumentPaths.has(pathname.replace(/\/$/, ""));
}

export async function createPrivateDocumentPolicy() {
  // Fresh per response. Never accept a request-supplied nonce or CSP.
  const nonce = base64(crypto.getRandomValues(new Uint8Array(24)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(androidDeviceClassScript));
  const deviceHash = base64(new Uint8Array(digest));
  const scriptSources = "script-src 'self' 'nonce-" + nonce + "' 'sha256-" + deviceHash + "' https://cdn.onesignal.com";
  return { nonce, policy: contentSecurityPolicy.replace(/script-src [^;]+/, scriptSources) };
}

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
