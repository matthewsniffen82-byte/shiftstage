import { NextRequest, NextResponse } from "next/server";
import {
  ageVerificationCookieLifetimeSeconds,
  ageVerificationCookieOptions,
  AGE_VERIFICATION_COOKIE_NAME,
  createAgeVerificationCookieValue,
} from "@/src/lib/dancr/age-verification-cookie";
import {
  finalizeYotiAgeVerification,
  yotiAgeCookieSecret,
  YotiAgeVerificationError,
} from "@/src/lib/dancr/yoti-age-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId") || "";
    const result = await finalizeYotiAgeVerification(sessionId);
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    if (result.state === "passed") {
      response.cookies.set(
        AGE_VERIFICATION_COOKIE_NAME,
        await createAgeVerificationCookieValue(
          result.referenceId,
          yotiAgeCookieSecret(),
          ageVerificationCookieLifetimeSeconds(),
        ),
        ageVerificationCookieOptions(),
      );
    }
    return response;
  } catch (error) {
    const known = error instanceof YotiAgeVerificationError;
    if (!known) console.error("Unexpected Yoti age-result error", error);
    return NextResponse.json(
      {
        state: "error",
        error: known ? error.message : "Age verification is temporarily unavailable.",
        code: known ? error.code : "unexpected_error",
      },
      {
        status: known ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
