import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const { data, error } = await createAdminSupabaseClient()
      .from("dancer_profiles")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const billing = {
      dancerStatus: data?.status || "pending",
      subscription: {
        status: "free",
        currentPeriodEnd: null,
        hasStripeCustomer: false,
        hasStripeSubscription: false,
      },
    };

    return NextResponse.json({ ok: true, billing });
  } catch (error) {
    return apiError(error, "Unable to load dancer free access status.");
  }
}
