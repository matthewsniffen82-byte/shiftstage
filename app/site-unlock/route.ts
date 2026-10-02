import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedRequestBytes } from "@/src/lib/bounded-json-body";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { requestClientAddress } from "@/src/lib/security/request-client-address";
import { createSiteAccessCookie, matchesSitePassword, SITE_ACCESS_COOKIE, SITE_ACCESS_SECONDS, SITE_LOCK_HEADERS, siteLockEnabled, siteLockResponse, siteReturnPath } from "@/src/lib/security/site-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!siteLockEnabled()) return NextResponse.redirect(new URL("/", request.url), 303);
  return siteLockResponse(new URL(request.url).searchParams.get("returnTo") || "/");
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return siteLockResponse("/", "Please enter the password from this site.", 403);
  }
  if (!siteLockEnabled()) return NextResponse.redirect(new URL("/", origin), 303);
  let returnTo = "/";
  try {
    await enforcePublicRequestRateLimit(createAdminSupabaseClient(), { namespace: "site_unlock", request, subject: requestClientAddress(request), windowSeconds: 300, ipLimit: 10, subjectLimit: 10 });
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return siteLockResponse("/", "Please use the password form.", 415);
    const bytes = await readBoundedRequestBytes(request, 4096, "Password form is too large.", 5000);
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    returnTo = siteReturnPath(form.get("returnTo"));
    if (!await matchesSitePassword(form.get("password") || "")) return siteLockResponse(returnTo, "Incorrect password. Try again.", 401);
    const token = await createSiteAccessCookie();
    const response = NextResponse.redirect(new URL(returnTo, origin), 303);
    for (const [key, value] of Object.entries(SITE_LOCK_HEADERS)) response.headers.set(key, value);
    response.cookies.set(SITE_ACCESS_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SITE_ACCESS_SECONDS });
    return response;
  } catch (error) {
    const limited = error instanceof PublicRequestRateLimitError;
    const response = siteLockResponse(returnTo, limited ? "Too many attempts. Please wait a few minutes and try again." : "Unable to unlock right now. Please try again shortly.", limited ? 429 : 503);
    if (limited) response.headers.set("retry-after", String(error.retryAfterSeconds));
    return response;
  }
}
