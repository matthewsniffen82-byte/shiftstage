import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Scheduled worker security is not configured." },
      { status: 503 },
    );
  }

  const expected = `Bearer ${secret}`;
  const provided = request.headers.get("authorization") || "";
  if (!constantTimeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

function constantTimeEqual(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}
