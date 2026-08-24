import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  getAdminDancerRoster,
  parseAdminDancerRosterQuery,
} from "@/src/lib/dancr/admin-dancers";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const roster = await getAdminDancerRoster(
      createAdminSupabaseClient(),
      parseAdminDancerRosterQuery(request.url),
    );
    return NextResponse.json({ ok: true, roster });
  } catch (error) {
    return apiError(error, "Unable to load dancer management roster.");
  }
}
