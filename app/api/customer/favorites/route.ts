import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { favoriteDancer, unfavoriteDancer } from "@/src/lib/dancr/customer";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { requirePublicDancer } from "@/src/lib/dancr/resource-authorization";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CUSTOMER_ACTION_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "customer_favorite",
      request,
      subject: user.id,
      windowSeconds: 60,
      ipLimit: 180,
      subjectLimit: 90,
    });
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_CUSTOMER_ACTION_BODY_BYTES,
      invalidMessage: "Invalid dancer favorite request.",
      tooLargeMessage: "Dancer favorite request is too large.",
    });
    const dancerId = body?.dancerId;
    const favorite = body?.favorite !== false;

    if (typeof dancerId !== "string" || !UUID_PATTERN.test(dancerId)) {
      return NextResponse.json({ ok: false, error: "Invalid dancerId." }, { status: 400 });
    }

    if (favorite) {
      await requirePublicDancer(admin, dancerId);
      await favoriteDancer(client, user.id, dancerId);
    } else {
      await unfavoriteDancer(client, user.id, dancerId);
    }

    return NextResponse.json({ ok: true, favorite });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to update dancer favorite.");
  }
}
