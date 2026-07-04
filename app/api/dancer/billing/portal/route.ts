import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await createRequestSupabaseContext(request);

    return NextResponse.json({
      ok: true,
      portalUrl: null,
      message: "Dancer profiles are free. No billing portal is required.",
    });
  } catch (error) {
    return apiError(error, "Unable to confirm free dancer access.");
  }
}
