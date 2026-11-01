import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  // Retain a harmless response for old callers; no database or provider access.
  return NextResponse.json({ ok: false, status: "retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
