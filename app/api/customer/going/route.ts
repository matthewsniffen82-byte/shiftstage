import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { cancelGoing, markGoing } from "@/src/lib/dancr/customer";
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

    return NextResponse.json({ ok: true, going });
  } catch (error) {
    return apiError(error, "Unable to update going signal.");
  }
}
