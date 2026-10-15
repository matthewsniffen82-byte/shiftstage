import { discoveryCursor, parseDiscoveryCursor } from "@/src/lib/dancr/discovery-pagination";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getLiveDancerDiscovery } from "@/src/lib/dancr/public";
import { PRIVATE_NO_STORE_CACHE_CONTROL, PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import type { DancerCard } from "@/src/lib/dancr/types";
import { orderByPerformance } from "@/src/lib/dancr/performance-placement";

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
    let afterId: string | null;
    try { afterId = parseDiscoveryCursor(url.searchParams.get("cursor"), city); }
    catch { return NextResponse.json({ ok: false, error: "Invalid discovery cursor." }, { status: 400, headers: { "cache-control": "private, no-store" } }); }
    const client = createAdminSupabaseClient();
    const page = await getLiveDancerDiscovery(client, city, afterId);
    const eligible = scope === "tonight" ? page.tonightDancers : page.dancers;
    const dancers = await orderByPerformance(client, eligible, row => ({ dancerId: row.id, venueId: row.venueId }), row => row.id);

    return NextResponse.json(
      { ok: true, city, scope, nextCursor: page.nextAfterId ? discoveryCursor(city, page.nextAfterId) : null, dancers: dancers.map(toPublicDancerCard) },
      { headers: { "Cache-Control": dancers.some(dancer => dancer.metricsUnavailable) ? PRIVATE_NO_STORE_CACHE_CONTROL : PUBLIC_DYNAMIC_CACHE_CONTROL } },
    );
  } catch (error) {
    return apiError(error, "Unable to load dancers.", 500);
  }
}

function toPublicDancerCard(dancer: DancerCard) {
  const { shiftEndsAt, ...publicDancer } = dancer;
  return publicDancer;
}
