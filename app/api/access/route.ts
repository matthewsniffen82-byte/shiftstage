import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  createSiteAccessSession,
  safeSiteAccessReturnPath,
  SITE_ACCESS_COOKIE_NAME,
  siteAccessConfiguration,
  siteAccessConfigurationIsValid,
} from "@/src/lib/dancr/site-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 256;
const MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

export async function POST(request: NextRequest) {
  const configuration = siteAccessConfiguration();
  if (!configuration.enabled) {
    return jsonResponse({ ok: false, error: "Access gate is not enabled." }, 404);
  }
  if (!siteAccessConfigurationIsValid(configuration)) {
    console.error("SITE_ACCESS_GATE_CONFIGURATION_INVALID");
    return jsonResponse(
      { ok: false, error: "Private access is temporarily unavailable." },
      503,
    );
  }
  if (!sameOriginRequest(request)) {
    return jsonResponse({ ok: false, error: "Request origin is not allowed." }, 403);
  }

  let body: { code?: unknown; returnTo?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Enter the access code." }, 400);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > MAX_CODE_LENGTH) {
    return jsonResponse({ ok: false, error: "Enter a valid access code." }, 400);
  }

  const codeIsValid = accessCodeMatches(code, configuration.codeHash);
  const ipHash = hashRequestIp(request, configuration.secret);
  const rateLimit = await recordAccessAttempt(ipHash, codeIsValid);
  if (!rateLimit.ok) {
    console.error("SITE_ACCESS_RATE_LIMIT_UNAVAILABLE", rateLimit.error);
    return jsonResponse(
      { ok: false, error: "Private access is temporarily unavailable." },
      503,
    );
  }
  if (!rateLimit.allowed) {
    console.warn("SITE_ACCESS_RATE_LIMITED", { ipHash: ipHash.slice(0, 12) });
    const response = jsonResponse(
      {
        ok: false,
        error: "Too many attempts. Wait before trying again.",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      429,
    );
    response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
    return response;
  }
  if (!codeIsValid) {
    console.warn("SITE_ACCESS_CODE_REJECTED", { ipHash: ipHash.slice(0, 12) });
    return jsonResponse({ ok: false, error: "That access code is incorrect." }, 401);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt =
    nowSeconds + configuration.sessionDays * 24 * 60 * 60;
  const session = await createSiteAccessSession(configuration.secret, expiresAt);
  const redirectTo = safeSiteAccessReturnPath(
    typeof body.returnTo === "string" ? body.returnTo : "/",
  );
  const response = jsonResponse({ ok: true, redirectTo }, 200);
  response.cookies.set({
    name: SITE_ACCESS_COOKIE_NAME,
    value: session,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: configuration.sessionDays * 24 * 60 * 60,
    expires: new Date(expiresAt * 1000),
  });
  console.info("SITE_ACCESS_GRANTED", { ipHash: ipHash.slice(0, 12) });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!sameOriginRequest(request)) {
    return jsonResponse({ ok: false, error: "Request origin is not allowed." }, 403);
  }
  const response = jsonResponse({ ok: true }, 200);
  response.cookies.set({
    name: SITE_ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

function accessCodeMatches(code: string, expectedHash: string) {
  const submitted = createHash("sha256").update(code, "utf8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === submitted.length && timingSafeEqual(submitted, expected);
}

function sameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function requestIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function hashRequestIp(request: NextRequest, secret: string) {
  const salt = (process.env.DANCR_IP_HASH_SECRET || secret).trim();
  return createHmac("sha256", salt).update(requestIp(request)).digest("hex");
}

async function recordAccessAttempt(ipHash: string, succeeded: boolean) {
  try {
    const admin = createAdminSupabaseClient();
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000,
    ).toISOString();
    const { data: recentAttempts, error: readError } = await admin
      .from("admin_actions")
      .select("action, created_at")
      .eq("target_type", "site_access_gate")
      .eq("notes", ipHash)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(MAX_FAILURES + 1);
    if (readError) return { ok: false as const, error: readError.message };

    const consecutiveFailures: Array<Record<string, unknown>> = [];
    for (const attempt of recentAttempts || []) {
      if (attempt.action === "site_access_granted") break;
      if (
        attempt.action === "site_access_rejected" ||
        attempt.action === "site_access_blocked"
      ) {
        consecutiveFailures.push(attempt);
      }
    }
    const isLocked = consecutiveFailures.length >= MAX_FAILURES;
    const action = isLocked
      ? "site_access_blocked"
      : succeeded
        ? "site_access_granted"
        : "site_access_rejected";
    const { error: writeError } = await admin.from("admin_actions").insert({
      admin_id: null,
      target_type: "site_access_gate",
      target_id: null,
      action,
      notes: ipHash,
    });
    if (writeError) return { ok: false as const, error: writeError.message };

    const oldestFailure = consecutiveFailures.at(-1)?.created_at;
    const retryAfterSeconds = oldestFailure
      ? Math.max(
          1,
          Math.ceil(
            (new Date(String(oldestFailure)).getTime() +
              RATE_LIMIT_WINDOW_SECONDS * 1000 -
              Date.now()) /
              1000,
          ),
        )
      : RATE_LIMIT_WINDOW_SECONDS;
    return {
      ok: true as const,
      allowed: !isLocked,
      retryAfterSeconds,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unknown rate-limit error.",
    };
  }
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
