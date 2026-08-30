import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { followDancer, setDancerNotifications, unfollowDancer } from "@/src/lib/dancr/customer";
import {
  createDancerEngagementNotification,
  resolvePublicDancerEngagementTarget,
} from "@/src/lib/dancr/engagement-notifications";
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
      namespace: "customer_follow",
      request,
      subject: user.id,
      windowSeconds: 60,
      ipLimit: 180,
      subjectLimit: 90,
    });
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_CUSTOMER_ACTION_BODY_BYTES,
      invalidMessage: "Invalid dancer follow request.",
      tooLargeMessage: "Dancer follow request is too large.",
    });
    const dancerId = body?.dancerId;
    const following = body?.following !== false;
    const notificationsEnabled = body?.notificationsEnabled !== false;

    if (typeof dancerId !== "string" || !UUID_PATTERN.test(dancerId)) {
      return NextResponse.json({ ok: false, error: "A valid dancerId is required." }, { status: 400 });
    }

    if (!following) {
      await unfollowDancer(client, user.id, dancerId);
      const counts = await countDancerFollowPreferences(dancerId);
      return NextResponse.json({
        ok: true,
        following: false,
        notificationsEnabled: false,
        ...counts,
      });
    }

    await requirePublicDancer(admin, dancerId);
    const [{ data: existingFollow, error: existingFollowError }, recipient] = await Promise.all([
      admin
        .from("follows")
        .select("customer_id")
        .eq("customer_id", user.id)
        .eq("dancer_id", dancerId)
        .maybeSingle(),
      resolvePublicDancerEngagementTarget(admin, "profile", dancerId),
    ]);
    if (existingFollowError) throw existingFollowError;
    if (notificationsEnabled) {
      await followDancer(client, user.id, dancerId);
    } else {
      await setDancerNotifications(client, user.id, dancerId, false);
    }
    if (!existingFollow && recipient) {
      await createDancerEngagementNotification(admin, recipient, {
        engagementType: "follow",
        targetType: "profile",
        targetId: dancerId,
        dedupeSubject: user.id,
      });
    }

    const counts = await countDancerFollowPreferences(dancerId);
    return NextResponse.json({ ok: true, following: true, notificationsEnabled, ...counts });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to update dancer follow.");
  }
}

async function countDancerFollowPreferences(dancerId: string) {
  const admin = createAdminSupabaseClient();
  const [followers, notifications] = await Promise.all([
    admin
      .from("follows")
      .select("customer_id", { count: "exact", head: true })
      .eq("dancer_id", dancerId),
    admin
      .from("follows")
      .select("customer_id", { count: "exact", head: true })
      .eq("dancer_id", dancerId)
      .eq("notifications_enabled", true),
  ]);

  if (followers.error) throw followers.error;
  if (notifications.error) throw notifications.error;
  return {
    followerCount: followers.count || 0,
    notificationCount: notifications.count || 0,
  };
}
