import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { client, user } = authContext;
    await requireActiveVenueAccount(client, user.id);
    if (new URL(request.url).searchParams.get("access") === "1") {
      return NextResponse.json({
        ok: true,
        access: { active: true },
        session: authContext.session || null,
      }, { headers: { "cache-control": "private, no-store" } });
    }
    return NextResponse.json({
      ok: true,
      billingModel: "subscription",
      finance: null,
      session: authContext.session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to load venue finance.");
  }
}
