import { NextResponse } from "next/server";
import { completeBitsafeOnboarding } from "@/src/lib/dancr/bitsafe";
import { syncBitsafePayoutAccount } from "@/src/lib/dancr/payout-account-store";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const fallback = configuredDashboardUrl(requestUrl);
  const code = requestUrl.searchParams.get("code")?.trim();
  const state = requestUrl.searchParams.get("state")?.trim();
  const providerError = requestUrl.searchParams.get("error")?.trim();
  if (!code || !state || providerError) {
    return secureRedirect(fallback, "setup_error");
  }

  try {
    const admin = createAdminSupabaseClient();
    const onboarding = await completeBitsafeOnboarding(admin, {
      code,
      state,
      callbackUrl: configuredCallbackUrl(requestUrl),
    });
    await syncBitsafePayoutAccount(admin, onboarding.dancerId, onboarding.account);
    const returnUrl = safeReturnUrl(onboarding.returnUrl, requestUrl.origin);
    return secureRedirect(returnUrl, onboarding.account.payoutEligibility === "eligible" ? "connected" : "review");
  } catch {
    return secureRedirect(fallback, "setup_error");
  }
}

function configuredCallbackUrl(requestUrl: URL) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return new URL("/api/bitsafe/callback", configured || requestUrl.origin).toString();
}

function configuredDashboardUrl(requestUrl: URL) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = (configured || requestUrl.origin).replace(/\/$/, "");
  return new URL("/dashboard", origin);
}

function safeReturnUrl(value: string, requestOrigin: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const allowedOrigin = new URL(configured || requestOrigin).origin;
  const returnUrl = new URL(value, allowedOrigin);
  if (returnUrl.origin !== allowedOrigin || returnUrl.pathname !== "/dashboard") {
    return new URL("/dashboard", allowedOrigin);
  }
  return returnUrl;
}

function secureRedirect(url: URL, financeStatus: string) {
  url.searchParams.set("finance", financeStatus);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
