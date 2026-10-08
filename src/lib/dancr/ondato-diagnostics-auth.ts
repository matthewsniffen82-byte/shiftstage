import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// A separate read-only capability derived from the existing database operator key.
// The actual service-role credential is never sent to this endpoint.
export function authorizeOndatoDiagnostics(request: Request) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) return NextResponse.json({ ok: false, error: "Diagnostics unavailable." }, { status: 503 });
  const token = createHmac("sha256", secret).update("mydancr:ondato:read-only-diagnostics:v1").digest("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const provided = Buffer.from(request.headers.get("authorization") || "");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
