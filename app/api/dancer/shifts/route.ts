import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const dancer = await getOwnDancerProfile(client as any, user.id);
    const { data, error } = await (client as any)
      .from("shifts")
      .select("id, venue_id, starts_at, ends_at, timezone, status, broadcast_sent_at, broadcast_recipients, venues(name, slug, city)")
      .eq("dancer_id", dancer.id)
      .order("starts_at", { ascending: false })
      .limit(25);

    if (error) throw error;

    return NextResponse.json({ ok: true, shifts: data || [] });
  } catch (error) {
    return apiError(error, "Unable to load dancer shifts.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const dancer = await getOwnDancerProfile(client as any, user.id);

    if (dancer.status !== "approved") {
      return NextResponse.json({ ok: false, error: "Profile approval required before posting shifts." }, { status: 403 });
    }

    if (!body?.venueId || !body?.startsAt || !body?.endsAt) {
      return NextResponse.json({ ok: false, error: "Missing venueId, startsAt, or endsAt." }, { status: 400 });
    }

    const { data, error } = await (client as any)
      .from("shifts")
      .insert({
        dancer_id: dancer.id,
        venue_id: body.venueId,
        starts_at: body.startsAt,
        ends_at: body.endsAt,
        timezone: body.timezone || "America/Los_Angeles",
        status: "posted",
      })
      .select("id")
      .single();

    if (error) throw error;

    const broadcastRecipients = await broadcastShiftPosted(dancer, data.id, body.venueId, body.startsAt);
    const { error: updateError } = await (client as any)
      .from("shifts")
      .update({
        broadcast_sent_at: new Date().toISOString(),
        broadcast_recipients: broadcastRecipients,
      })
      .eq("id", data.id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, shiftId: data.id, broadcastRecipients });
  } catch (error) {
    return apiError(error, "Unable to post dancer shift.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();

    if (!body?.shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    const dancer = await getOwnDancerProfile(client as any, user.id);
    const update: Record<string, string> = {};
    if (typeof body.venueId === "string") update.venue_id = body.venueId;
    if (typeof body.startsAt === "string") update.starts_at = body.startsAt;
    if (typeof body.endsAt === "string") update.ends_at = body.endsAt;
    if (typeof body.timezone === "string") update.timezone = body.timezone;
    if (["posted", "cancelled", "draft"].includes(body.status)) update.status = body.status;

    const { error } = await (client as any)
      .from("shifts")
      .update(update)
      .eq("id", body.shiftId)
      .eq("dancer_id", dancer.id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update dancer shift.");
  }
}

async function getOwnDancerProfile(client: any, userId: string) {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id, stage_name, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");

  return data;
}

async function broadcastShiftPosted(
  dancer: { id: string; stage_name: string },
  shiftId: string,
  venueId: string,
  startsAt: string,
) {
  const admin = createAdminSupabaseClient() as any;
  const { data: followers, error: followersError } = await admin
    .from("follows")
    .select("customer_id")
    .eq("dancer_id", dancer.id)
    .eq("notifications_enabled", true);

  if (followersError) throw followersError;

  const rows = (followers || []).map((follow: { customer_id: string }) => ({
    recipient_id: follow.customer_id,
    notification_type: "shift_posted",
    channel: "in_app",
    title: `${dancer.stage_name} posted a shift`,
    body: `${dancer.stage_name} posted a new schedule. Tap to view details.`,
    payload: { dancerId: dancer.id, shiftId, venueId, startsAt },
    sent_at: new Date().toISOString(),
  }));

  if (!rows.length) return 0;

  const { error } = await admin.from("notifications").insert(rows);
  if (error) throw error;

  return rows.length;
}
