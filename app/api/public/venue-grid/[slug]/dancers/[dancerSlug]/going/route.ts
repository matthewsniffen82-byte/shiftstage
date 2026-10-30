import { NextResponse } from "next/server";
import { GET as getGoing, POST as postGoing } from "@/app/api/customer/going/route";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { restrictClubProfile } from "@/src/lib/dancr/club-media-permissions";
import { getDancerProfile, getVenueProfile } from "@/src/lib/dancr/public";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string; dancerSlug: string }> };
const headers = { "Cache-Control": "private, no-store" };

async function handleGoing(request: Request, context: Context) {
  try {
    const { slug, dancerSlug } = await context.params;
    if (![slug, dancerSlug].every(value => value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) {
      return NextResponse.json({ ok: false, error: "Profile unavailable." }, { status: 404, headers });
    }
    let shiftId: unknown = new URL(request.url).searchParams.get("shiftId");
    if (request.method === "POST") {
      requireSameOriginJsonMutation(request);
      const body = await readBoundedJsonObject(request.clone(), {
        maxBytes: 4096, invalidMessage: "Invalid going request.", tooLargeMessage: "Going request is too large.",
      });
      shiftId = body.shiftId;
    }
    const client = createAdminSupabaseClient();
    const venue = await getVenueProfile(client, slug);
    const unscoped = venue ? await getDancerProfile(client, dancerSlug) : null;
    const profile = venue && unscoped ? await restrictClubProfile(client, unscoped, venue.id) : null;
    const shift = profile?.upcomingShifts.find(item => item.id === shiftId && item.venueId === venue?.id && isActiveNfcPresence(item));
    if (!venue || !profile || profile.venueId !== venue.id || !isActiveNfcPresence(profile) || !shift) {
      return NextResponse.json({ ok: false, error: "This dancer is no longer working here or their profile is unavailable." }, { status: 404, headers });
    }
    // Preserve the existing approval checks, visitor cookie, CSRF protection,
    // rate limits, deduplication, cancellation and authoritative counts.
    return request.method === "POST" ? await postGoing(request) : await getGoing(request);
  } catch (error) {
    return apiError(error, "Unable to load this visit action.", 503);
  }
}

export async function GET(request: Request, context: Context) {
  return handleGoing(request, context);
}

export async function POST(request: Request, context: Context) {
  return handleGoing(request, context);
}
