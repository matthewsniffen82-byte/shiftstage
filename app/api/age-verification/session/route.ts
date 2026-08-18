import { NextResponse } from "next/server";
import {
  createYotiAgeVerificationSession,
  YotiAgeVerificationError,
} from "@/src/lib/dancr/yoti-age-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new YotiAgeVerificationError("JSON is required.", "invalid_request", 415);
    }
    const body = await request.json().catch(() => ({})) as { returnTo?: unknown };
    const session = await createYotiAgeVerificationSession(request, body.returnTo);
    return NextResponse.json(session, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return ageVerificationErrorResponse(error);
  }
}

function enforceSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (new URL(origin).origin !== expected) {
    throw new YotiAgeVerificationError("Request origin is not allowed.", "invalid_origin", 403);
  }
}

function ageVerificationErrorResponse(error: unknown) {
  const known = error instanceof YotiAgeVerificationError;
  if (!known) console.error("Unexpected Yoti age-session error", error);
  return NextResponse.json(
    {
      error: known ? error.message : "Age verification is temporarily unavailable.",
      code: known ? error.code : "unexpected_error",
    },
    {
      status: known ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
