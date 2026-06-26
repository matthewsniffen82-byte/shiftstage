import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getCustomerSavedItems } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const saved = await getCustomerSavedItems(client, user.id);

    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    return apiError(error, "Unable to load saved customer items.");
  }
}
