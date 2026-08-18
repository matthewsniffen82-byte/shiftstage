import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "dancr",
    time: new Date().toISOString(),
    ageVerification: {
      provider: "yoti",
      enabled: process.env.YOTI_AGE_VERIFICATION_ENABLED?.trim().toLowerCase() === "true",
      configured: Boolean(
        process.env.YOTI_AGE_API_KEY
        && process.env.YOTI_AGE_SDK_ID
        && (process.env.YOTI_AGE_COOKIE_SECRET?.length || 0) >= 32,
      ),
    },
  });
}
