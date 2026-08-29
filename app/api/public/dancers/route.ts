import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getApprovedDancersByCity, getTonightShifts } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import type { DancerCard } from "@/src/lib/dancr/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = url.searchParams.get("city") || "Las Vegas";
    const scope = url.searchParams.get("scope") || "all";
    const client = createAdminSupabaseClient();
    const dancers =
      scope === "tonight" ? await getTonightShifts(client, city) : await getApprovedDancersByCity(client, city);

    return NextResponse.json({ ok: true, city, scope, dancers: dancers.map(toPublicDancerCard) });
  } catch (error) {
    return apiError(error, "Unable to load dancers.", 500);
  }
}

function toPublicDancerCard(dancer: DancerCard) {
  const { shiftEndsAt, ...publicDancer } = dancer;
  return publicDancer;
}
