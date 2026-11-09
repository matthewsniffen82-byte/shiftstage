import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { readNotificationEmailToken, redeemNotificationEmail } from "@/src/lib/dancr/notification-email-link";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { VENUE_APPROVAL_HEADERS } from "@/src/lib/dancr/venue-approval-link";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request,{maxBytes:2048,invalidMessage:"Invalid email link.",tooLargeMessage:"Invalid email link."});
    const claim = readNotificationEmailToken(body.link,body.to);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin,{namespace:"notification_email_login",request,subject:claim.id,windowSeconds:600,ipLimit:40,subjectLimit:12});
    const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    const result = await redeemNotificationEmail(admin,claim,bearer,body.attempt);
    return Response.json({ok:true,...result},{headers:VENUE_APPROVAL_HEADERS});
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return Response.json({ok:false,error:"Please wait before opening this link again."},
      {status:429,headers:{...VENUE_APPROVAL_HEADERS,"retry-after":String(error.retryAfterSeconds)}});
    const response = apiError(error,"Unable to open this email link.");
    for (const [key,value] of Object.entries(VENUE_APPROVAL_HEADERS)) response.headers.set(key,value);
    return response;
  }
}
