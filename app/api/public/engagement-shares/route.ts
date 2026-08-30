import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createDancerEngagementNotification,
  type EngagementTargetType,
  resolvePublicDancerEngagementTarget,
} from "@/src/lib/dancr/engagement-notifications";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "dancr_media_like_visitor";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SHARE_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_SHARE_BODY_BYTES,
      invalidMessage: "Invalid engagement share request.",
      tooLargeMessage: "Engagement share request is too large.",
    });
    const targetType = isTargetType(body?.targetType) ? body.targetType : null;
    const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
    if (!targetType || !UUID_PATTERN.test(targetId)) {
      return NextResponse.json({ ok: false, error: "A valid public profile or media ID is required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const recipient = await resolvePublicDancerEngagementTarget(admin, targetType, targetId);
    if (!recipient) {
      return NextResponse.json({ ok: false, error: "This content is not available." }, { status: 404 });
    }

    const existingToken = readCookie(request, VISITOR_COOKIE);
    const visitorToken = existingToken || randomBytes(32).toString("base64url");
    const visitorHash = createHash("sha256").update(visitorToken).digest("hex");
    await enforcePublicRequestRateLimit(admin, {
      namespace: "public_engagement_share",
      request,
      subject: `${targetType}:${targetId}:${visitorHash}`,
      windowSeconds: 60 * 60,
      ipLimit: 240,
      subjectLimit: 30,
    });

    const day = new Date().toISOString().slice(0, 10);
    await createDancerEngagementNotification(admin, recipient, {
      engagementType: "share",
      targetType,
      targetId,
      dedupeSubject: `${visitorHash}:${day}`,
    });
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    if (!existingToken) {
      response.cookies.set(VISITOR_COOKIE, visitorToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to record this share.");
  }
}

function isTargetType(value: unknown): value is EngagementTargetType {
  return value === "profile" || value === "photo" || value === "video";
}

function readCookie(request: Request, name: string) {
  const pair = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!pair) return null;
  try {
    const value = decodeURIComponent(pair.slice(name.length + 1));
    return VISITOR_TOKEN_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}
