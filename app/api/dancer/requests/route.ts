import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getOwnDancerRequests, getOwnPendingRequestSummary, parseDancerRequestQuery } from "@/src/lib/dancr/dancer-request-results";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const params = new URL(request.url).searchParams;
    if (params.get("summary") === "pending") {
      const summary = await getOwnPendingRequestSummary(createAdminSupabaseClient(), user.id);
      return NextResponse.json({ ok: true, summary }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const query = parseDancerRequestQuery(params);
    const page = await getOwnDancerRequests(createAdminSupabaseClient(), user.id, query);
    return NextResponse.json({ ok: true, ...page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load requests. Try again.");
  }
}
