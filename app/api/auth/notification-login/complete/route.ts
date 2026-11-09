import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { completeNotificationEmail } from "@/src/lib/dancr/notification-email-link";
import { VENUE_APPROVAL_HEADERS } from "@/src/lib/dancr/venue-approval-link";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { active: true });
    const body = await readBoundedJsonObject(request, { maxBytes: 512, invalidMessage: "Invalid arrival.", tooLargeMessage: "Invalid arrival." });
    await completeNotificationEmail(createAdminSupabaseClient(), user.id, body.id);
    return Response.json({ ok: true, session }, { headers: VENUE_APPROVAL_HEADERS });
  } catch (error) {
    const response = apiError(error, "Unable to finish opening your email link.");
    for (const [key, value] of Object.entries(VENUE_APPROVAL_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
