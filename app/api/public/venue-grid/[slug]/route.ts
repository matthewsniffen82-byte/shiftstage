import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getVenueProfile } from "@/src/lib/dancr/public";
import { getRankedDirectoryPage } from "@/src/lib/dancr/public-directory";
import { parseDiscoveryCursor } from "@/src/lib/dancr/discovery-pagination";
import { PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const client = createAdminSupabaseClient();
    const venue = await getVenueProfile(client, slug);
    if (!venue) return NextResponse.json({ ok: false, error: "This club is unavailable." }, { status: 404, headers });
    let cursor: string;
    try { cursor = parseDiscoveryCursor(new URL(request.url).searchParams.get("cursor"), venue.city); }
    catch { return NextResponse.json({ ok: false, error: "Invalid discovery cursor." }, { status: 400, headers }); }
    // City, venue and Working Now are derived here, never from iframe query options.
    const page = await getRankedDirectoryPage(client, request, { city: venue.city, venueId: venue.id, filter: "now", cursor });
    const workingIds = new Set(page.tonightDancers.map(dancer => dancer.id));
    const dancers = page.dancers.filter(dancer => dancer.venueId === venue.id && workingIds.has(dancer.id)).map(dancer => ({
      id: dancer.id, slug: dancer.slug, stageName: dancer.stageName,
      primaryPhotoUrl: dancer.primaryPhotoUrl, primaryPhotoSrcSet: dancer.primaryPhotoSrcSet,
    }));
    return NextResponse.json({ ok: true, venue: { id: venue.id, slug: venue.slug, name: venue.name }, dancers, nextCursor: page.nextCursor }, { headers });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before refreshing." },
      { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to load working dancers.", 500);
  }
}
