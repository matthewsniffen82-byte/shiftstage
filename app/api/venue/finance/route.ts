import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueFinance } from "@/src/lib/dancr/finance";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    return NextResponse.json({ ok: true, finance: await getVenueFinance(createAdminSupabaseClient(), user.id) });
  } catch (error) {
    return apiError(error, "Unable to load venue finance.");
  }
}
