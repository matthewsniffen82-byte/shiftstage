import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getCustomerProfile, updateCustomerProfile } from "@/src/lib/dancr/auth";
import type { Json } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { parseCustomerNotificationPatch } from "@/src/lib/dancr/customer-notification-preferences";
import { customerNotificationDelivery } from "@/src/lib/dancr/customer-notification-delivery";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { setCustomerEmailPreference } from "@/src/lib/dancr/customer-email-consent";

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

    return NextResponse.json({ ok: true, profile: { ...profile, notificationDelivery: customerNotificationDelivery(user.id, user.email) }, session });
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
      try {
        update.notificationSettings = parseCustomerNotificationPatch(body.notificationSettings);
      } catch (error) {
        return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
      }
      const delivery = customerNotificationDelivery(user.id, user.email);
      if ((update.notificationSettings.emailEnabled === true || update.notificationSettings.followEmailEnabled === true) && !delivery.emailAvailable) {
        return NextResponse.json({ ok: false, error: "Email alerts are not available yet." }, { status: 503 });
      }
      if (update.notificationSettings.pushEnabled === true && !delivery.pushAvailable) {
        return NextResponse.json({ ok: false, error: "Push notifications are not available yet." }, { status: 503 });
      }
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ ok: false, error: "No guest profile updates provided." }, { status: 400 });
    }

    const emailKey = typeof update.notificationSettings?.followEmailEnabled === "boolean" ? "followEmailEnabled" : "emailEnabled";
    const emailEnabled = update.notificationSettings?.[emailKey];
    if (typeof emailEnabled === "boolean" && (update.city !== undefined || Object.keys(update.notificationSettings!).length !== 1)) {
      return NextResponse.json({ ok: false, error: "Change the optional email preference separately from other settings." }, { status: 400 });
    }
    const profile = typeof emailEnabled === "boolean"
      ? await setCustomerEmailPreference(createAdminSupabaseClient(), user.id, emailEnabled, body.emailConsentSource, body.emailConsentVersion, emailKey)
      : await updateCustomerProfile(client, user.id, update);
    return NextResponse.json({ ok: true, profile: { ...profile, notificationDelivery: customerNotificationDelivery(user.id, user.email) }, session });
  } catch (error) {
    return apiError(error, "Unable to update guest profile.");
  }
}
