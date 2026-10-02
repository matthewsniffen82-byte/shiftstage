import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { siteLockPage } from "./site-lock-page";

export const SITE_ACCESS_COOKIE = "__Host-mydancr_site_access";
export const SITE_ACCESS_SECONDS = 7 * 24 * 60 * 60;
export const SITE_LOCK_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  // Native password form posts need their same-origin Origin header for CSRF
  // validation. no-referrer makes browsers send Origin: null on these posts.
  "referrer-policy": "same-origin",
};
// Only a salted verifier is checked in; the password never enters client code.
const passwordVerifier = {
  salt: "b71d1beb9dbf56c98b689d57d24d0f8f5f5719756e640159",
  hash: "583bc1382e0438f89de53d50f136d8e8234088be0c39de4e51c3a34f27049ae5",
  iterations: 210_000,
};
const encoder = new TextEncoder();
const workerPaths = new Set([
  "/api/cron/internal-request-push", "/api/cron/image-moderation",
  "/api/cron/video-moderation", "/api/cron/dmca-restoration",
  "/api/cron/shift-checkins", "/api/cron/finance",
]);

export function siteLockEnabled() {
  return process.env.DANCR_SITE_LOCK_ENABLED !== "false";
}

export function bypassSiteLock(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "") || "/";
  if (path === "/site-unlock") return true;
  // Machine endpoints retain their existing cron/signature authentication.
  if (request.method === "GET" && workerPaths.has(path)) return true;
  if (request.method === "POST" && ["/api/stripe/webhook", "/api/ondato/webhook"].includes(path)) return true;
  return ["GET", "HEAD"].includes(request.method) && ["/api/health", "/api/health/supabase"].includes(path);
}

function cookieSecret() {
  // Derive a separate key below, so this works with the existing production
  // secret without reusing another feature's signatures or publishing a key.
  const secret = process.env.DANCR_SITE_LOCK_SECRET || process.env.DANCR_PUBLIC_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Site access security is not configured.");
  return secret;
}

async function cookieKey(secret: string) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("mydancr-site-lock"), info: encoder.encode("access-cookie-v1") }, material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function matchesSitePassword(password: string, verifier = passwordVerifier) {
  if (!password || password.length > 128) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const digest = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(verifier.salt), iterations: verifier.iterations }, key, 256));
  let difference = digest.length ^ verifier.hash.length;
  for (let index = 0; index < digest.length; index++) difference |= digest.charCodeAt(index) ^ verifier.hash.charCodeAt(index);
  return difference === 0;
}

export async function createSiteAccessCookie(now = Date.now(), secret = cookieSecret()) {
  const expires = Math.floor(now / 1000) + SITE_ACCESS_SECONDS;
  const payload = `v1.${expires}`;
  const signature = await crypto.subtle.sign("HMAC", await cookieKey(secret), encoder.encode(`${payload}.${passwordVerifier.hash}`));
  return `${payload}.${hex(signature)}`;
}

export async function validSiteAccessCookie(value: string | undefined, now = Date.now(), secret?: string) {
  const match = value?.match(/^v1\.(\d{10,12})\.([a-f0-9]{64})$/);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + SITE_ACCESS_SECONDS + 60) return false;
  try {
    const signature = Uint8Array.from(match[2].match(/../g)!, byte => parseInt(byte, 16));
    return await crypto.subtle.verify("HMAC", await cookieKey(secret || cookieSecret()), signature, encoder.encode(`v1.${expires}.${passwordVerifier.hash}`));
  } catch { return false; }
}

export function siteReturnPath(value: string | null) {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  const pathname = value.split(/[?#]/, 1)[0];
  if (/%(?:2f|5c|0a|0d)/i.test(pathname)) return "/";
  try {
    const url = new URL(value, "https://site.invalid");
    if (url.origin !== "https://site.invalid" || url.pathname.replace(/\/$/, "") === "/site-unlock") return "/";
    return url.pathname + url.search + url.hash;
  } catch { return "/"; }
}

export function siteLockResponse(returnTo: string, error = "", status = 200) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  return new NextResponse(siteLockPage(siteReturnPath(returnTo), nonce, error), {
    status,
    headers: { ...SITE_LOCK_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` },
  });
}

export async function enforceSiteLock(request: NextRequest) {
  if (!siteLockEnabled() || bypassSiteLock(request)) return null;
  if (await validSiteAccessCookie(request.cookies.get(SITE_ACCESS_COOKIE)?.value)) return null;
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) {
    return NextResponse.json({ ok: false, code: "SITE_LOCKED", error: "Enter the site password to continue." }, { status: 401, headers: SITE_LOCK_HEADERS });
  }
  return siteLockResponse(path + request.nextUrl.search);
}
