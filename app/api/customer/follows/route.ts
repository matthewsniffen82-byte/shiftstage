import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { followDancer, setDancerNotifications, unfollowDancer } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const dancerId = body?.dancerId;
    const following = body?.following !== false;
    const notificationsEnabled = body?.notificationsEnabled !== false;

    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Missing dancerId." }, { status: 400 });
    }

    if (!following) {
      await unfollowDancer(client, user.id, dancerId);
      return NextResponse.json({ ok: true, following: false, notificationsEnabled: false });
    }

    if (notificationsEnabled) {
      await followDancer(client, user.id, dancerId);
    } else {
      await setDancerNotifications(client, user.id, dancerId, false);
    }

    return NextResponse.json({ ok: true, following: true, notificationsEnabled });
  } catch (error) {
    return apiError(error, "Unable to update dancer follow.");
  }
}
