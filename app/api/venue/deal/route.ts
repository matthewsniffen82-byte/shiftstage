import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueDealsForAccount } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MYDANCR_MANAGED_DEAL_MESSAGE = "Club Deals are created and published by MyDancr from the signed venue agreement.";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const result = await getVenueDealsForAccount(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, deals: result?.deals || [] });
  } catch (error) {
    return apiError(error, "Unable to load the venue Club Deal.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    return NextResponse.json({ ok: false, error: MYDANCR_MANAGED_DEAL_MESSAGE }, { status: 403 });
  } catch (error) {
    return apiError(error, "Unable to verify the venue Club Deal request.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    return NextResponse.json({ ok: false, error: MYDANCR_MANAGED_DEAL_MESSAGE }, { status: 403 });
  } catch (error) {
    return apiError(error, "Unable to verify the venue Club Deal request.");
  }
}
