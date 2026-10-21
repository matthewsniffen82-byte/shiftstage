import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { SESSION_RESPONSE_HEADERS } from "@/src/lib/supabase/session-transport";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";
import { canDownloadGuide, findGuideDocument, GUIDE_DOCUMENTS } from "@/src/lib/dancr/operations-guides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    const { data: account, error } = await context.client.from("app_users")
      .select("id, role, account_state").eq("id", context.user.id).maybeSingle();
    if (error) throw error;
    if (!account || account.id !== context.user.id || account.account_state !== "active") {
      throw new PublicApiError("FORBIDDEN", "An active account is required to download guides.", 403);
    }
    const venue = account.role === "venue"
      ? await getVenueAccess(createAdminSupabaseClient(), context.user.id) : null;
    const access = { role: String(account.role), accountState: String(account.account_state), venueRole: venue?.role };
    const id = new URL(request.url).searchParams.get("document");
    if (id !== null) {
      const document = findGuideDocument(id);
      if (!document) throw new PublicApiError("NOT_FOUND", "Guide not found.", 404);
      if (!canDownloadGuide(access, document)) {
        throw new PublicApiError("FORBIDDEN", "This guide requires an authorized dancer, club owner, manager or platform admin account.", 403);
      }
      const pdf = await readFile(path.join(process.cwd(), "output/pdf/mydancr-operations", document.file));
      const headers = new Headers({ ...privateHeaders,
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${document.file}"`,
      });
      if (context.session?.accessToken) headers.set(SESSION_RESPONSE_HEADERS.access, context.session.accessToken);
      if (context.session?.refreshToken) headers.set(SESSION_RESPONSE_HEADERS.refresh, context.session.refreshToken);
      if (context.session?.expiresAt) headers.set(SESSION_RESPONSE_HEADERS.expires, String(context.session.expiresAt));
      return new Response(new Uint8Array(pdf), { headers });
    }
    return NextResponse.json({ ok: true, accountId: context.user.id, role: account.role,
      venueName: venue?.venueName || null,
      documents: GUIDE_DOCUMENTS.filter(document => canDownloadGuide(access, document)).map(document => document.id),
      session: context.session || null,
    }, { headers: privateHeaders });
  } catch (error) {
    const response = apiError(error, "Unable to load the operations guides.");
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  }
}
