import { NextRequest, NextResponse } from "next/server";
import {
  AGE_VERIFICATION_COOKIE_NAME,
  isYotiAgeVerificationEnabled,
  verifyAgeVerificationCookieValue,
} from "@/src/lib/dancr/age-verification-cookie";

export async function middleware(request: NextRequest) {
  if (!isYotiAgeVerificationEnabled() || isAgeGateExempt(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.YOTI_AGE_COOKIE_SECRET || "";
  const verified = await verifyAgeVerificationCookieValue(
    request.cookies.get(AGE_VERIFICATION_COOKIE_NAME)?.value,
    secret,
  );
  if (verified) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Age verification required.", code: "age_verification_required" },
      { status: secret.length >= 32 ? 403 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const gate = request.nextUrl.clone();
  gate.pathname = "/age-verification";
  gate.search = "";
  gate.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (secret.length < 32) gate.searchParams.set("state", "error");
  return NextResponse.redirect(gate);
}

function isAgeGateExempt(pathname: string) {
  return pathname === "/age-verification"
    || pathname.startsWith("/age-verification/")
    || pathname.startsWith("/api/age-verification/")
    || pathname === "/api/health"
    || pathname.startsWith("/api/health/")
    || pathname.startsWith("/api/cron/")
    || pathname === "/api/stripe/webhook"
    || pathname === "/auth/callback"
    || pathname.startsWith("/_next/")
    || pathname === "/favicon.ico"
    || pathname === "/manifest.webmanifest"
    || pathname === "/robots.txt"
    || isPublicAsset(pathname);
}

function isPublicAsset(pathname: string) {
  if (pathname.startsWith("/api/")) return false;
  return /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|webm|webmanifest|webp|woff2?|xml)$/i.test(pathname);
}

export const config = {
  matcher: "/:path*",
};
