import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { followDancer, setDancerNotifications, unfollowDancer } from "@/src/lib/dancr/customer";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const dancerId = body?.dancerId;
    const following = body?.following !== false;
    const notificationsEnabled = body?.notificationsEnabled !== false;

    if (typeof dancerId !== "string" || !UUID_PATTERN.test(dancerId)) {
      return NextResponse.json({ ok: false, error: "A valid dancerId is required." }, { status: 400 });
    }

    if (!following) {
      await unfollowDancer(client, user.id, dancerId);
      const followerCount = await countDancerFollowers(dancerId);
      return NextResponse.json({ ok: true, following: false, notificationsEnabled: false, followerCount });
    }

    if (notificationsEnabled) {
      await followDancer(client, user.id, dancerId);
    } else {
      await setDancerNotifications(client, user.id, dancerId, false);
    }

    const followerCount = await countDancerFollowers(dancerId);
    return NextResponse.json({ ok: true, following: true, notificationsEnabled, followerCount });
  } catch (error) {
    return apiError(error, "Unable to update dancer follow.");
  }
}

async function countDancerFollowers(dancerId: string) {
  const admin = createAdminSupabaseClient();
  const { count, error } = await admin
    .from("follows")
    .select("customer_id", { count: "exact", head: true })
    .eq("dancer_id", dancerId);

  if (error) throw error;
  return count || 0;
}
