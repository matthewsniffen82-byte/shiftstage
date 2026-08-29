import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { favoriteDancer, unfavoriteDancer } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CUSTOMER_ACTION_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
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
      await favoriteDancer(client, user.id, dancerId);
    } else {
      await unfavoriteDancer(client, user.id, dancerId);
    }

    return NextResponse.json({ ok: true, favorite });
  } catch (error) {
    return apiError(error, "Unable to update dancer favorite.");
  }
}
