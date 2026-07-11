import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  clearUserNotifications,
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/src/lib/dancr/notifications";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const body = await request.json();

    if (body?.all === true) {
      const result = await markAllNotificationsRead(client, user.id);
      return NextResponse.json({ ok: true, ...result });
    }

    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    if (!notificationId) {
      return NextResponse.json({ ok: false, error: "Missing notificationId." }, { status: 400 });
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
