import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getCustomerSavedItems } from "@/src/lib/dancr/customer";
import { getCustomerDealRedemptions } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const [savedItems, dealRedemptions] = await Promise.all([
      getCustomerSavedItems(client, user.id),
      getCustomerDealRedemptions(createAdminSupabaseClient(), user.id),
    ]);
    const saved = { ...savedItems, dealRedemptions };

    return NextResponse.json({ ok: true, saved, session });
  } catch (error) {
    return apiError(error, "Unable to load saved customer items.");
  }
}
