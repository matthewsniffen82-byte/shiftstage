import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  clearUserNotifications,
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/src/lib/dancr/notifications";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_NOTIFICATION_BODY_BYTES = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const unreadOnly = new URL(request.url).searchParams.get("unread") === "true";
    const notifications = await getUserNotifications(client, user.id, unreadOnly);

    return NextResponse.json({ ok: true, notifications });
  } catch (error) {
    return apiError(error, "Unable to load notifications.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_NOTIFICATION_BODY_BYTES,
      invalidMessage: "Invalid notification request.",
      tooLargeMessage: "Notification request is too large.",
    });

    if (body?.all === true) {
      const result = await markAllNotificationsRead(client, user.id);
      return NextResponse.json({ ok: true, ...result });
    }

    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    if (!UUID_PATTERN.test(notificationId)) {
      return NextResponse.json({ ok: false, error: "Valid notificationId is required." }, { status: 400 });
    }

    const notification = await markNotificationRead(client, user.id, notificationId);
    return NextResponse.json({ ok: true, notification });
  } catch (error) {
    return apiError(error, "Unable to update notification.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const result = await clearUserNotifications(client, user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "Unable to clear notifications.");
  }
}
