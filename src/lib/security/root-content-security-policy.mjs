import { createHash } from "node:crypto";

const INLINE_SCRIPT_PATTERN = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;

export function createActiveEditProfileScript(liveShellSha256) {
  return `console.log("ACTIVE_EDIT_PROFILE_VERSION", "canonical-profile-approval-v14");document.documentElement.setAttribute("data-active-edit-profile-version","canonical-profile-approval-v14");document.documentElement.setAttribute("data-live-shell-version","${liveShellSha256}");`;
}

export function createRootContentSecurityPolicy(html, additionalInlineScripts = []) {
  const scriptHashes = [...new Set([
    ...[...html.matchAll(INLINE_SCRIPT_PATTERN)].map((match) => sha256Source(match[1] || "")),
    ...additionalInlineScripts.map(sha256Source),
  ])];

  if (!scriptHashes.length) {
    throw new Error("The production home shell must contain an allowlisted inline script.");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "font-src 'self' data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https://www.google.com",
    "img-src 'self' data: blob: https:",
    "manifest-src 'self'",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    `script-src 'self' ${scriptHashes.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function sha256Source(value) {
  return `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
}
