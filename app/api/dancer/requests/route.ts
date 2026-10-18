import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getOwnDancerRequests, parseDancerRequestQuery } from "@/src/lib/dancr/dancer-request-results";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const query = parseDancerRequestQuery(new URL(request.url).searchParams);
    const page = await getOwnDancerRequests(createAdminSupabaseClient(), user.id, query);
    return NextResponse.json({ ok: true, ...page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load requests. Try again.");
  }
}
