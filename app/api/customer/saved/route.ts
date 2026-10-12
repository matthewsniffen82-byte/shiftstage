import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getCustomerSavedClubDeals, getCustomerSavedItems } from "@/src/lib/dancr/customer";
import { getCustomerDealRedemptions } from "@/src/lib/dancr/deals";
import { getCustomerClubEntryDeals, getCustomerPlanEntryDeals } from "@/src/lib/dancr/customer-plan-entry";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    const [savedItems, dealRedemptions, dealSaves] = await Promise.all([
      getCustomerSavedItems(client, user.id, admin),
      getCustomerDealRedemptions(admin, user.id),
      getCustomerSavedClubDeals(admin, user.id),
    ]);
    const [planEntryDeals, clubEntryDeals] = await Promise.all([
      getCustomerPlanEntryDeals(admin, savedItems.goingSignals),
      getCustomerClubEntryDeals(admin, savedItems.venueFollows),
    ]);
    const saved = { ...savedItems, dealRedemptions, dealSaves, planEntryDeals, clubEntryDeals };

    return NextResponse.json({ ok: true, saved, session });
  } catch (error) {
    return apiError(error, "Unable to load saved customer items.");
  }
}
