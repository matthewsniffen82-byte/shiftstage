import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/src/lib/server-env";

// A browser deterrent, never a login credential or proof of a physical device.
export const NFC_BROWSER_ACCOUNT_COOKIE = "mydancr_nfc_account_v1";
export const NFC_BROWSER_ACCOUNT_MESSAGE = "This browser is already linked to a dancer account. Sign in to your original dancer account to use this sticker.";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const TOKEN_PATTERN = /^v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/;

function digest(value: string) {
  return createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`mydancr-nfc-browser-account-v1:${value}`)
    .digest("hex");
}

export function createNfcBrowserAccountToken(userId: string) {
  const account = digest(`account:${userId}`);
  return `v1.${account}.${digest(`signature:${account}`)}`;
}

export function readNfcBrowserAccountToken(request: Request): string | null {
  const cookie = (request.headers.get("cookie") || "").split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${NFC_BROWSER_ACCOUNT_COOKIE}=`));
  const token = cookie?.slice(NFC_BROWSER_ACCOUNT_COOKIE.length + 1) || "";
  if (!TOKEN_PATTERN.test(token)) return null;
  const [, account, signature] = token.split(".");
  const expected = digest(`signature:${account}`);
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? token : null;
}

export function nfcBrowserAccountMatches(token: string, userId: string) {
  const expected = createNfcBrowserAccountToken(userId);
  return token.length === expected.length
    && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function rememberNfcBrowserAccount(response: NextResponse, token: string) {
  response.cookies.set(NFC_BROWSER_ACCOUNT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

export function nfcBrowserAccountConflict() {
  return NextResponse.json({
    ok: false,
    code: "NFC_BROWSER_ACCOUNT_CONFLICT",
    error: NFC_BROWSER_ACCOUNT_MESSAGE,
  }, { status: 409, headers: { "cache-control": "private, no-store, max-age=0" } });
}
