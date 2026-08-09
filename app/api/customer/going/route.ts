import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  cancelAnonymousGoing,
  cancelGoing,
  markAnonymousGoing,
  markGoing,
} from "@/src/lib/dancr/customer";
import { isPublicDancerProfileEligible } from "@/src/lib/dancr/profile-approval";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  createRequestSupabaseContext,
  getBearerToken,
} from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "dancr_going_visitor";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type GoingIdentity = {
  customerId: string | null;
  visitorTokenHash: string | null;
  newVisitorToken: string | null;
};

export async function GET(request: Request) {
  try {
    const shiftId = new URL(request.url).searchParams.get("shiftId")?.trim() || "";
    if (!UUID_PATTERN.test(shiftId)) {
      return NextResponse.json({ ok: false, error: "Valid shiftId is required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    await requirePublicShift(admin, shiftId);
    const identity = await resolveGoingIdentity(request, false);
    const [going, goingCount] = await Promise.all([
      identity.customerId || identity.visitorTokenHash
        ? isIdentityGoing(admin, identity, shiftId)
        : Promise.resolve(false),
      countShiftGoingSignals(admin, shiftId),
    ]);

    return NextResponse.json(
      { ok: true, going, goingCount, anonymous: !identity.customerId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error, "Unable to load going signal.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
    const going = body?.going !== false;

    if (!UUID_PATTERN.test(shiftId)) {
      return NextResponse.json({ ok: false, error: "Valid shiftId is required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    await requirePublicShift(admin, shiftId);
    const identity = await resolveGoingIdentity(request, true);

    if (identity.customerId) {
      if (going) await markGoing(admin, identity.customerId, shiftId);
      else await cancelGoing(admin, identity.customerId, shiftId);
    } else if (identity.visitorTokenHash) {
      if (going) await markAnonymousGoing(admin, identity.visitorTokenHash, shiftId);
      else await cancelAnonymousGoing(admin, identity.visitorTokenHash, shiftId);
    } else {
      throw new Error("Unable to identify this visitor.");
    }

    const goingCount = await countShiftGoingSignals(admin, shiftId);
    const response = NextResponse.json(
      { ok: true, going, goingCount, anonymous: !identity.customerId },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (identity.newVisitorToken) {
      response.cookies.set(VISITOR_COOKIE, identity.newVisitorToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch (error) {
    return apiError(error, "Unable to update going signal.");
  }
}

async function resolveGoingIdentity(request: Request, createAnonymous: boolean): Promise<GoingIdentity> {
  if (getBearerToken(request)) {
    try {
      const { user } = await createRequestSupabaseContext(request);
      return { customerId: user.id, visitorTokenHash: null, newVisitorToken: null };
    } catch {
      // An expired session can still use the public action as an anonymous visitor.
    }
  }

  const existingToken = readCookie(request, VISITOR_COOKIE);
  const visitorToken = existingToken || (createAnonymous ? randomBytes(32).toString("base64url") : null);
  return {
    customerId: null,
    visitorTokenHash: visitorToken ? hashVisitorToken(visitorToken) : null,
    newVisitorToken: visitorToken && !existingToken ? visitorToken : null,
  };
}

async function requirePublicShift(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  shiftId: string,
) {
  const { data, error } = await admin
    .from("shifts")
    .select(
      "id, status, ends_at, dancer_profiles(status, approved_at, venue_approved_at, disabled_at, verification_status, photo_review_status, is_public)",
    )
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw error;

  const dancer = Array.isArray(data?.dancer_profiles)
    ? data.dancer_profiles[0]
    : data?.dancer_profiles;
  const endsAt = data?.ends_at ? new Date(data.ends_at).getTime() : 0;
  if (
    !data ||
    data.status !== "posted" ||
    !isPublicDancerProfileEligible(dancer) ||
    !Number.isFinite(endsAt) ||
    endsAt <= Date.now()
  ) {
    throw new Error("This shift is not available.");
  }
}

async function isIdentityGoing(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  identity: GoingIdentity,
  shiftId: string,
) {
  let query = admin
    .from("going_signals")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId);
  query = identity.customerId
    ? query.eq("customer_id", identity.customerId)
    : query.eq("visitor_token_hash", identity.visitorTokenHash);
  const { count, error } = await query;
  if (error) throw error;
  return (count || 0) > 0;
}

async function countShiftGoingSignals(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  shiftId: string,
) {
  const { count, error } = await admin
    .from("going_signals")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId);
  if (error) throw error;
  return count || 0;
}

function readCookie(request: Request, name: string) {
  const pair = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!pair) return null;
  const encoded = pair.slice(name.length + 1);
  try {
    const value = decodeURIComponent(encoded);
    return VISITOR_TOKEN_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function hashVisitorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
