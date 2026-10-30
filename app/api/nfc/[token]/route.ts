import { toPublicClubDeal } from "@/src/lib/dancr/public-club-deal";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { resolveApiError } from "@/src/lib/api-error-policy";
import { isVisibilityMode } from "@/src/lib/dancr/visibility-mode";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  broadcastFollowedClubRosterAddition,
  broadcastFollowedDancerWorkingNow,
} from "@/src/lib/dancr/customer-follow-notifications";
import { getActiveClubDealsForVenue } from "@/src/lib/dancr/deals";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import {
  registerDancerFromNfc,
  recordNfcTagScan,
  resolveNfcTag,
} from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NFC_BODY_BYTES = 4_096;

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "nfc_open",
      request,
      subject: token,
      windowSeconds: 5 * 60,
      ipLimit: 180,
      subjectLimit: 1_500,
    });
    const tag = await resolveNfcTag(admin, token);
    if (!tag) return inactiveTag();
    await recordNfcTagScan(admin, tag.id);
    const deals = tag.type === "cashier" ? await getActiveClubDealsForVenue(admin, tag.venueId) : [];
    return noStore({
      ok: true,
      tag: { id: tag.id, type: tag.type, label: tag.label },
      venue: tag.venue,
      deals: deals.map(toPublicClubDeal),
    });
  } catch (error) {
    const limited = nfcRateLimitResponse(error);
    if (limited) return limited;
    return apiError(error, "Unable to open this club tap.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_NFC_BODY_BYTES,
      invalidMessage: "Invalid tap request.",
      tooLargeMessage: "Tap request is too large.",
    });
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!UUID_PATTERN.test(sessionId)) {
      return NextResponse.json({ ok: false, error: "A valid tap session is required." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "nfc_action",
      request,
      subject: `${token}:${sessionId}`,
      windowSeconds: 5 * 60,
      ipLimit: 120,
      subjectLimit: 8,
    });
    const tag = await resolveNfcTag(admin, token);
    if (!tag) return inactiveTag();

    if (tag.type === "dressing_room") {
      if (!isVisibilityMode(body.visibility)) return noStore({ ok: false, error: "Choose Internal only, External only, or Both before confirming your tap." }, 400);
      const authContext = await createRequestSupabaseContext(request, { role: "dancer" });
      const { client, user } = authContext;
      const { data: account, error } = await client
        .from("app_users")
        .select("role, account_state")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (account?.role !== "dancer" || account?.account_state !== "active") {
        return NextResponse.json({ ok: false, error: "Sign in with an active dancer account to use this tag." }, { status: 403 });
      }
      const affiliation = await registerDancerFromNfc(admin, {
        tagId: tag.id,
        dancerUserId: user.id,
        sessionId,
        visibility: body.visibility,
        request,
      });
      const followNotificationTasks: Promise<unknown>[] = [];
      if (affiliation?.visibility !== "internal" && !affiliation?.replayed && affiliation?.affiliationActivated === true && affiliation?.id && affiliation?.dancerId) {
        followNotificationTasks.push(broadcastFollowedClubRosterAddition(admin, {
          dancerId: String(affiliation.dancerId),
          eventId: String(affiliation.id),
          stageName: String(affiliation.stageName || "A new dancer"),
          venueId: tag.venueId,
          venueName: tag.venue.name,
          venueSlug: tag.venue.slug,
        }));
      }
      if (affiliation?.visibility !== "internal" && !affiliation?.replayed && affiliation?.shiftCheckedIn === true && affiliation?.tapApplied === true && affiliation?.shiftId && affiliation?.dancerId) {
        followNotificationTasks.push(broadcastFollowedDancerWorkingNow(admin, {
          dancerId: String(affiliation.dancerId),
          eventId: String(affiliation.shiftId),
          stageName: String(affiliation.stageName || "A dancer you follow"),
          venueId: tag.venueId,
          venueName: tag.venue.name,
          venueSlug: tag.venue.slug,
        }));
      }
      await Promise.all(followNotificationTasks.map((task) => task.catch((notificationError) => {
        console.warn("CUSTOMER_FOLLOW_NOTIFICATION_FAILED", safeErrorMetadata(notificationError));
      })));
      console.info("DANCER_NFC_AUTHORIZATION_COMPLETED", {
        venueId: tag.venueId,
        tagId: tag.id,
        dancerId: affiliation?.dancerId,
        shiftCheckedIn: affiliation?.shiftCheckedIn === true,
        workingUntil: affiliation?.workingUntil || null,
        nextTapAllowedAt: affiliation?.nextTapAllowedAt || null,
        tapApplied: affiliation?.tapApplied === true,
      });
      return noStore({
        ok: true,
        action: "dancer_check_in",
        affiliation,
        session: authContext.session || null,
        message: affiliation?.clubApprovalStatus === "rejected" ? `Your request to join ${tag.venue.name} was declined. Contact this club’s manager. You are not checked in there.`
          : affiliation?.enrollmentStatus === "pending" && affiliation?.checkInStatus === "media_pending" ? `Tap saved. ${tag.venue.name} needs 3 approved photos, including a main photo, and 1 approved video. Check this club’s media in your dashboard. If ready within 6 hours of your tap, check-in completes for the remaining time; otherwise, tap again.`
          : affiliation?.enrollmentStatus === "pending" ? "Tap saved. Approval pending.\n\nYou’re not checked in yet. If approved within 6 hours of your tap, you’ll check in automatically for the remaining time.\n\nOtherwise, tap again once approved."
          : affiliation?.replayed ? "This tap was already processed. It did not change or extend your shift. Open your dashboard for your current status." : `Visibility: ${body.visibility === "internal" ? "Internal only — visible inside the club and to this club’s invited VIP guests; hidden from public discovery" : body.visibility === "external" ? "External only — your full public profile is visible" : "Both — internal roster and external MyDancr"}. ` + (affiliation?.alreadyWorking
             ? `You are already Working Now at ${affiliation?.venueName || tag.venue.name}. This tap did not extend the six-hour session.`
           : affiliation?.cooldownActive
             ? `This club’s cooldown is active. You can return after ${formatTapTime(affiliation?.nextTapAllowedAt)}. After checkout, you can tap into another approved club.`
           : affiliation?.shiftCheckedIn
             ? `You are Working Now at ${tag.venue.name} for six hours. A six-hour cooldown follows at this club. To switch clubs, check out and tap the next club’s tag. Retaps cannot extend this session.`
             : `Verified at ${tag.venue.name}. Your club affiliation and profile are active.`),
      });
    }

    return NextResponse.json({ ok: false, error: "Admission now uses a pass scanned by club staff. Open the club page to get your pass.", replacement: "admission_pass", venueUrl: `/venues/${encodeURIComponent(tag.venue.slug)}` }, { status: 410, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const limited = nfcRateLimitResponse(error);
    if (limited) return limited;
    const message = safeErrorMessage(error);
    const status = /sign in|active dancer|different venue|inactive/i.test(message)
        ? 403
        : /already/i.test(message)
          ? 409
          : /not found|no longer active/i.test(message)
            ? 404
            : /invalid|valid|required|missing|expired|incomplete|choose|does not have|cannot include|expiration/i.test(message)
              ? 400
              : 500;
    const resolved = resolveApiError(error, "Unable to complete this phone tap.", status);
    console.error("NFC_TAP_FAILED", safeErrorMetadata(error));
    return NextResponse.json(resolved.body, {
      status: resolved.status,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }
}

function nfcRateLimitResponse(error: unknown) {
  if (!(error instanceof PublicRequestRateLimitError)) return null;
  return NextResponse.json(
    { ok: false, error: error.message },
    {
      status: 429,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "retry-after": String(error.retryAfterSeconds),
      },
    },
  );
}

function formatTapTime(value: unknown) {
  if (typeof value !== "string") return "the cooldown ends";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "the cooldown ends";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
}

function inactiveTag() {
  return NextResponse.json(
    { ok: false, error: "This tap sticker is inactive. Ask club staff for the current MyDancr sticker." },
    { status: 410, headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0" } });
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unable to complete this phone tap.";
}
