import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getCustomerProfile, updateCustomerProfile } from "@/src/lib/dancr/auth";
import type { Json } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_CUSTOMER_PROFILE_BODY_BYTES = 16_384;

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const profile = await getCustomerProfile(client, user.id);

    if (!profile) {
      return NextResponse.json({ ok: false, error: "Guest profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, profile, session });
  } catch (error) {
    return apiError(error, "Unable to load guest profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_CUSTOMER_PROFILE_BODY_BYTES,
      invalidMessage: "Invalid guest profile request.",
      tooLargeMessage: "Guest profile request is too large.",
    });
    const update: { city?: string; notificationSettings?: Record<string, Json> } = {};

    if (typeof body?.city === "string") {
      const city = body.city.trim();
      if (!city) {
        return NextResponse.json({ ok: false, error: "City cannot be blank." }, { status: 400 });
      }
      if (city.length > 80) {
        return NextResponse.json({ ok: false, error: "City is too long." }, { status: 400 });
      }
      update.city = city;
    }

    if (body?.notificationSettings !== undefined) {
      if (!isPlainObject(body.notificationSettings)) {
        return NextResponse.json({ ok: false, error: "Notification settings must be an object." }, { status: 400 });
      }
      update.notificationSettings = body.notificationSettings as Record<string, Json>;
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ ok: false, error: "No guest profile updates provided." }, { status: 400 });
    }

    const profile = await updateCustomerProfile(client, user.id, update);
    return NextResponse.json({ ok: true, profile, session });
  } catch (error) {
    return apiError(error, "Unable to update guest profile.");
  }
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
