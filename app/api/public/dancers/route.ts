import { directoryVenue, parseDiscoveryCursor } from "@/src/lib/dancr/discovery-pagination";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getRankedDirectoryPage } from "@/src/lib/dancr/public-directory";
import { PRIVATE_NO_STORE_CACHE_CONTROL, PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import type { DancerCard } from "@/src/lib/dancr/types";
import { PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = (url.searchParams.get("city") || "Las Vegas").trim();
    const requestedScope = url.searchParams.get("scope") || "all";
    if (!city || city.length > 80) {
      return NextResponse.json({ ok: false, error: "Choose a valid city." }, { status: 400 });
    }
    const scope = requestedScope === "tonight" ? "tonight" : "all";
    let cursor: string, venueId: string | undefined;
    try { cursor = parseDiscoveryCursor(url.searchParams.get("cursor"), city); venueId = directoryVenue(url.searchParams.get("venue")); }
    catch { return NextResponse.json({ ok: false, error: "Invalid discovery cursor." }, { status: 400, headers: { "cache-control": "private, no-store" } }); }
    const client = createAdminSupabaseClient();
    const page = await getRankedDirectoryPage(client, request, { city, cursor, venueId, filter: scope === "tonight" ? "now" : "all" });
    const dancers = page.dancers;

    return NextResponse.json(
      { ok: true, city, scope, nextCursor: page.nextCursor, dancers: dancers.map(toPublicDancerCard) },
      { headers: { ...(page.cookie ? { "set-cookie": page.cookie } : {}), "Cache-Control": dancers.some(dancer => dancer.metricsUnavailable) ? PRIVATE_NO_STORE_CACHE_CONTROL : PUBLIC_DYNAMIC_CACHE_CONTROL } },
    );
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before refreshing discovery." },
      { status: 429, headers: { "cache-control": PRIVATE_NO_STORE_CACHE_CONTROL, "retry-after": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to load dancers.", 500);
  }
}

function toPublicDancerCard(dancer: DancerCard) {
  const { shiftEndsAt, ...publicDancer } = dancer;
  return publicDancer;
}
