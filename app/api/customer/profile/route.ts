import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getCustomerProfile, updateCustomerProfile } from "@/src/lib/dancr/auth";
import type { Json } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const profile = await getCustomerProfile(client, user.id);

    if (!profile) {
      return NextResponse.json({ ok: false, error: "Customer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return apiError(error, "Unable to load customer profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const update: { city?: string; notificationSettings?: Record<string, Json> } = {};

    if (typeof body?.city === "string") {
      const city = body.city.trim();
      if (!city) {
        return NextResponse.json({ ok: false, error: "City cannot be blank." }, { status: 400 });
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
      return NextResponse.json({ ok: false, error: "No customer profile updates provided." }, { status: 400 });
    }

    const profile = await updateCustomerProfile(client, user.id, update);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return apiError(error, "Unable to update customer profile.");
  }
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
