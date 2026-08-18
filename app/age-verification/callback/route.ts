import { NextRequest, NextResponse } from "next/server";
import {
  ageVerificationCookieLifetimeSeconds,
  ageVerificationCookieOptions,
  AGE_VERIFICATION_COOKIE_NAME,
  createAgeVerificationCookieValue,
} from "@/src/lib/dancr/age-verification-cookie";
import {
  finalizeYotiAgeVerification,
  safeReturnTo,
  yotiAgeCookieSecret,
  YotiAgeVerificationError,
} from "@/src/lib/dancr/yoti-age-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const sessionId = request.nextUrl.searchParams.get("sessionId") || "";

  try {
    const result = await finalizeYotiAgeVerification(sessionId);
    if (result.state === "passed") {
      const response = NextResponse.redirect(new URL(returnTo, request.url));
      response.cookies.set(
        AGE_VERIFICATION_COOKIE_NAME,
        await createAgeVerificationCookieValue(
          result.referenceId,
          yotiAgeCookieSecret(),
          ageVerificationCookieLifetimeSeconds(),
        ),
        ageVerificationCookieOptions(),
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const gate = new URL("/age-verification", request.url);
    gate.searchParams.set("state", result.state);
    gate.searchParams.set("returnTo", returnTo);
    if (result.state === "processing") gate.searchParams.set("sessionId", sessionId);
    return noStoreRedirect(gate);
  } catch (error) {
    if (!(error instanceof YotiAgeVerificationError)) {
      console.error("Unexpected Yoti callback error", error);
    }
    const gate = new URL("/age-verification", request.url);
    gate.searchParams.set("state", "error");
    gate.searchParams.set("returnTo", returnTo);
    return noStoreRedirect(gate);
  }
}

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
