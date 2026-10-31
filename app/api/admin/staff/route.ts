import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { addAdminStaff, readStaffDetails, resendAdminStaffSetup } from "@/src/lib/dancr/admin-staff";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "owner");
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid staff details.", tooLargeMessage: "Request too large." });
    const details = body.action === "add" ? readStaffDetails(body) : null;
    if (!details && (body.action !== "resend" || typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id))) {
      throw new PublicApiError("INVALID_REQUEST", "Choose a valid staff action.", 400);
    }
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "admin_staff_setup", request, subject: user.id,
      windowSeconds: 3600, ipLimit: 100, subjectLimit: 30 });
    const result = details ? await addAdminStaff(admin, user.id, details) : await resendAdminStaffSetup(admin, body.id as string);
    return NextResponse.json({ ok: true, ...result, session }, { headers });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, {
      status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) },
    });
    const response = apiError(error, "Unable to add staff or send their setup email. Check Staff access before retrying.");
    response.headers.set("cache-control", headers["cache-control"]);
    return response;
  }
}
