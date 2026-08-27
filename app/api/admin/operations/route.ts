import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { getAdminOperationsCenter } from "@/src/lib/dancr/admin-operations";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const operations = await getAdminOperationsCenter(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, operations, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load live admin operations.");
  }
}
