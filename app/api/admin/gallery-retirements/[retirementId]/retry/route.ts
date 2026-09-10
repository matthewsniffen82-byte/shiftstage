import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { retryGalleryStorageRetirement } from "@/src/lib/dancr/gallery-storage-retry";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ retirementId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const { retirementId } = await context.params;
    const result = await retryGalleryStorageRetirement(createAdminSupabaseClient(), retirementId);
    console.info("GALLERY_STORAGE_RETRY_CONFIRMED", { retirementId: result.retirementId });
    return NextResponse.json({ ok: true, ...result, session: session || null }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Storage cleanup could not be confirmed. The retirement record is preserved for a safe retry.", 503);
  }
}
