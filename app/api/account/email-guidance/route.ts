import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACKNOWLEDGED_KEY = "mydancr_email_guidance_acknowledged_v1";
const privateHeaders = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

function failure(error: unknown) {
  const response = apiError(error, "Unable to save email alert acknowledgment. Please try again.");
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    return NextResponse.json({
      ok: true, userId: user.id, acknowledged: user.user_metadata?.[ACKNOWLEDGED_KEY] === true, session,
    }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 256, invalidMessage: "Invalid acknowledgment.", tooLargeMessage: "Invalid acknowledgment.",
    });
    if (body.acknowledged !== true || Object.keys(body).some(key => key !== "acknowledged")) {
      return NextResponse.json({ ok: false, error: "Invalid acknowledgment." }, { status: 400, headers: privateHeaders });
    }
    if (user.user_metadata?.[ACKNOWLEDGED_KEY] !== true) {
      // Patch only this UI preference; notification delivery settings stay unchanged.
      const { data, error } = await createAdminSupabaseClient().auth.admin.updateUserById(user.id, {
        user_metadata: { [ACKNOWLEDGED_KEY]: true },
      });
      if (error || data.user?.user_metadata?.[ACKNOWLEDGED_KEY] !== true) {
        throw error || new Error("Acknowledgment was not saved.");
      }
    }
    return NextResponse.json({ ok: true, userId: user.id, acknowledged: true, session }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
