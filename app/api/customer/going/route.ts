import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { cancelGoing, markGoing } from "@/src/lib/dancr/customer";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const shiftId = body?.shiftId;
    const going = body?.going !== false;

    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    if (going) {
      await markGoing(client, user.id, shiftId);
    } else {
      await cancelGoing(client, user.id, shiftId);
    }

    const goingCount = await countShiftGoingSignals(shiftId);
    return NextResponse.json({ ok: true, going, goingCount });
  } catch (error) {
    return apiError(error, "Unable to update going signal.");
  }
}

async function countShiftGoingSignals(shiftId: string) {
  const admin = createAdminSupabaseClient();
  const { count, error } = await admin
    .from("going_signals")
    .select("customer_id", { count: "exact", head: true })
    .eq("shift_id", shiftId);

  if (error) throw error;
  return count || 0;
}
