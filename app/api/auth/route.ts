import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthError } from "@supabase/supabase-js";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { provisionAppAccount } from "@/src/lib/dancr/account-provisioning";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getVenueForAccount } from "@/src/lib/dancr/venue";
import {
  redeemVenueSignupCode,
  resolveVenueSignupCode,
} from "@/src/lib/dancr/venue-claims";
import { redeemVenueTeamInvitation, resolveVenueTeamInvitation } from "@/src/lib/dancr/venue-team";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import {
  AccountRecoveryRateLimitError,
  enforceAccountRecoveryRateLimit,
} from "@/src/lib/dancr/account-recovery";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthRole = "customer" | "dancer" | "venue" | "admin";
type AuthMode = "login" | "signup" | "reset_password";

const MAX_AUTH_BODY_BYTES = 8_192;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let requestedMode: AuthMode | null = null;
  let requestedRole: AuthRole | null = null;
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_AUTH_BODY_BYTES,
      invalidMessage: "Invalid authentication request.",
      tooLargeMessage: "Authentication request is too large.",
    });
    const mode = readMode(body.mode);
    const role = readRole(body.role);
    requestedMode = mode;
    requestedRole = role;
    const credential = readAuthCredential(body, role);
    const email = credential.email;
    const client = createServerSupabaseClient();

    if (mode === "reset_password") {
      const admin = createAdminSupabaseClient();
      await enforceAccountRecoveryRateLimit(admin, {
        eventType: "password_reset",
        role,
        request,
        subject: email,
      });
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: safeEmailRedirectTo(body.emailRedirectTo),
      });
      if (error) {
        const rateLimitMessage = authRateLimitMessage(error);
        if (rateLimitMessage) throw error;
        console.error("ACCOUNT_PASSWORD_RESET_DELIVERY_FAILED", {
          role,
          errorCode: typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "provider_error",
        });
      }

      return NextResponse.json({
        ok: true,
        message: "If that email has a MyDancr account, a secure reset link is on the way.",
      });
    }

    await enforceAuthAttemptRateLimit(request, mode, role, email);
    const password = readRequired(body.password, "Password is required.", 1_024);

    if (mode === "login") {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("Authentication provider returned no user.");

      const venueInvitationToken = role === "venue" && typeof body.venueCode === "string" && body.venueCode.startsWith("vti_")
        ? body.venueCode
        : "";
      if (venueInvitationToken) {
        await redeemVenueTeamInvitation(createAdminSupabaseClient(), {
          token: venueInvitationToken,
          userId: data.user.id,
          email,
        });
      }

      const expectedRole = role === "admin" ? "admin" : null;
      return NextResponse.json(await authResponse(data.user.id, expectedRole, data.session, false));
    }

    if (password.length < 8) {
      throw invalid("Password must be at least 8 characters.");
    }

    if (role === "admin") {
      validateAdminSignupCode(body.adminCode);

      const admin = createAdminSupabaseClient();
      const displayName = credential.username || "Admin";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          mydancr_provisioned_role: "admin",
        },
        user_metadata: {
          role,
          display_name: displayName,
          admin_username: credential.username,
        },
      });

      if (error) throw error;
      if (!data.user) throw new Error("Unable to create admin account.");

      await provisionAppAccount(createAdminSupabaseClient(), {
        role,
        userId: data.user.id,
        email,
        displayName,
        city: "Las Vegas",
      });

      const { data: sessionData, error: sessionError } = await client.auth.signInWithPassword({ email, password });
      if (sessionError) throw sessionError;

      return NextResponse.json(await authResponse(data.user.id, role, sessionData.session, false));
    }

    if (role === "venue") {
      return NextResponse.json(await createVenueSignupAccount({
        client,
        email,
        password,
        venueCode: readRequired(body.venueCode, "Venue access code is required.", 256),
      }));
    }

    const city = role === "dancer" ? "" : readOptional(body.city) || "Las Vegas";
    const submittedStageName = "";
    const displayName =
      role === "customer"
        ? customerDisplayName(email)
        : submittedStageName || "Dancer";
    const metadata =
      role === "customer"
        ? { role, display_name: displayName }
        : {
            role,
            display_name: displayName,
            stage_name: submittedStageName || null,
          };

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: safeEmailRedirectTo(body.emailRedirectTo),
      },
    });

    if (error) throw error;
    if (!data.user) throw new Error("Unable to create account.");

    await provisionAppAccount(createAdminSupabaseClient(), {
      role,
      userId: data.user.id,
      email,
      displayName,
      city,
      existingDancerLogEvent: "EXISTING_DANCER_PROFILE_PRESERVED_DURING_SIGNUP",
    });

    if (role === "customer") {
      return NextResponse.json(await authResponse(data.user.id, role, null, true));
    }

    return NextResponse.json(await authResponse(data.user.id, role, data.session, !data.session));
  } catch (error) {
    if (error instanceof AccountRecoveryRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many sign-in or signup attempts. Please wait and try again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    const rateLimitMessage = authRateLimitMessage(error);
    if (rateLimitMessage) {
      return NextResponse.json({ ok: false, error: rateLimitMessage }, { status: 429 });
    }

    if (isAuthError(error)) {
      console.warn("AUTH_PROVIDER_REQUEST_REJECTED", {
        mode: requestedMode,
        role: requestedRole,
        code: error.code || "auth_error",
      });
      const message = requestedMode === "login"
        ? "Email or password is incorrect."
        : "Unable to create this account. Check the information or sign in if you already have an account.";
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    return apiError(error, "Unable to authenticate.");
  }
}

async function authResponse(
  userId: string,
  expectedRole: AuthRole | null,
  session: { access_token?: string; refresh_token?: string; expires_at?: number } | null,
  requiresEmailConfirmation: boolean,
) {
  const admin = createAdminSupabaseClient();
  const account = await getAccountByUserId(admin, userId);
  if (!account?.role) {
    throw conflict("This account is not ready for sign in. Contact support for help.");
  }
  if (account.accountState === "deleted") {
    throw forbidden("This account has been deleted.");
  }
  if (expectedRole && account.role !== expectedRole) {
    throw forbidden("Account role does not match this login.");
  }
  if (account.role === "venue" && account.accountState === "active") {
    const venue = await getVenueForAccount(admin, userId);
    if (!venue) {
      throw conflict("No venue is connected to this account. Use your venue access code during sign up.");
    }
  }

  return {
    ok: true,
    requiresEmailConfirmation,
    user: { id: userId },
    account,
    session: session
      ? {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
        }
      : null,
  };
}

async function createVenueSignupAccount(input: {
  client: ReturnType<typeof createServerSupabaseClient>;
  email: string;
  password: string;
  venueCode: string;
}) {
  const admin = createAdminSupabaseClient();
  const teamInvitation = input.venueCode.startsWith("vti_")
    ? await resolveVenueTeamInvitation(admin, input.venueCode, input.email)
    : null;
  const ownerAccess = teamInvitation ? null : await resolveVenueSignupCode(admin, input.venueCode);
  const venue = teamInvitation?.venue || ownerAccess?.venue;
  if (!venue) throw invalid("This venue access invitation is invalid.");
  let createdUserId = "";
  let accessRedeemed = false;

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: {
        mydancr_provisioned_role: "venue",
      },
      user_metadata: {
        role: "venue",
        display_name: venue.name,
        venue_name: venue.name,
        city: venue.city,
        venue_access_invitation: true,
        venue_team_role: teamInvitation?.role || "owner",
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error("Unable to create venue account.");
    createdUserId = data.user.id;

    await provisionAppAccount(admin, {
      role: "venue",
      userId: data.user.id,
      email: input.email,
      displayName: venue.name,
      city: venue.city,
    });

    const { data: sessionData, error: sessionError } = await input.client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (sessionError) throw sessionError;
    if (!sessionData.session) throw new Error("Unable to start venue dashboard session.");

    const account = await getAccountByUserId(admin, data.user.id);
    if (!account || account.role !== "venue") throw new Error("Unable to create venue account.");

    if (teamInvitation) {
      await redeemVenueTeamInvitation(admin, {
        token: input.venueCode,
        userId: data.user.id,
        email: input.email,
      });
    } else if (ownerAccess) {
      await redeemVenueSignupCode(admin, {
        codeId: ownerAccess.codeId,
        userId: data.user.id,
      });
    }
    accessRedeemed = true;

    return {
      ok: true,
      requiresEmailConfirmation: false,
      user: { id: data.user.id },
      account,
      venue,
      session: {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
        expiresAt: sessionData.session.expires_at,
      },
    };
  } catch (error) {
    if (createdUserId && !accessRedeemed) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) {
        console.error("VENUE_SIGNUP_ORPHAN_ACCOUNT_CLEANUP_FAILED", {
          userId: createdUserId,
          message: cleanupError.message,
        });
      }
    }
    throw error;
  }
}

function readMode(value: unknown): AuthMode {
  if (value === "login" || value === "signup" || value === "reset_password") return value;
  throw invalid("Auth mode must be login, signup, or reset_password.");
}

function readRole(value: unknown): AuthRole {
  if (value === "customer" || value === "dancer" || value === "venue" || value === "admin") return value;
  throw invalid("Role must be customer, dancer, venue, or admin.");
}

function readAuthCredential(body: Record<string, unknown>, role: AuthRole) {
  if (role !== "admin") {
    return { email: readEmail(body.email), username: "" };
  }

  const username = readOptional(body.username, 120) || readOptional(body.email, 254);
  if (!username) throw invalid("Admin username is required.");

  return {
    email: adminAuthEmail(username),
    username: username.includes("@") ? username.split("@")[0] || "admin" : username,
  };
}

function validateAdminSignupCode(value: unknown) {
  const expected = process.env.DANCR_ADMIN_SIGNUP_CODE || process.env.DANCR_ADMIN_SEED_KEY;
  if (!expected) throw new Error("Admin signup code is not configured.");
  const provided = readRequired(value, "Admin code is required.", 256);
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  if (!timingSafeEqual(expectedDigest, providedDigest)) {
    throw forbidden("Admin code is invalid.");
  }
}

function readRequired(value: unknown, message: string, maxLength = 2_048) {
  const text = readOptional(value, maxLength);
  if (!text) throw invalid(message);
  return text;
}

function readOptional(value: unknown, maxLength = 2_048) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength) throw invalid("Authentication field is too long.");
  return text;
}

function readEmail(value: unknown) {
  const email = readRequired(value, "Email is required.", 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw invalid("Enter a valid email address.");
  return email;
}

function adminAuthEmail(username: string) {
  const normalized = username.trim().toLowerCase();
  if (normalized.includes("@")) return normalized;

  const slug = normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw invalid("Admin username is required.");

  return `${slug}@admin.mydancr.local`;
}

function customerDisplayName(email: string) {
  return email.split("@")[0]?.trim() || "Guest";
}

function safeEmailRedirectTo(value: unknown) {
  const fallback = `${publicAppUrl()}/auth/callback`;
  const text = readOptional(value, 2_048);
  if (!text) return fallback;

  try {
    const requested = new URL(text);
    const site = new URL(fallback);
    if (!allowedAuthRedirectOrigins(site.origin).has(requested.origin)) return fallback;
    if (!requested.pathname.startsWith("/auth/callback")) return fallback;
    return requested.toString();
  } catch {
    return fallback;
  }
}

function allowedAuthRedirectOrigins(configuredOrigin: string) {
  return new Set([
    configuredOrigin,
    "https://mydancr.com",
    "https://www.mydancr.com",
    "https://shiftstage.vercel.app",
  ]);
}

function authRateLimitMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!/rate limit/i.test(message)) return "";

  return "Too many confirmation emails were sent. Please wait a few minutes, then try again, or use the newest confirmation email already in your inbox.";
}

async function enforceAuthAttemptRateLimit(
  request: Request,
  mode: Exclude<AuthMode, "reset_password">,
  role: AuthRole,
  email: string,
) {
  const limits = mode === "login"
    ? { windowSeconds: 15 * 60, ipLimit: 60, subjectLimit: 15 }
    : { windowSeconds: 60 * 60, ipLimit: 20, subjectLimit: 5 };
  await enforcePublicRequestRateLimit(createAdminSupabaseClient(), {
    namespace: `auth_${mode}`,
    request,
    subject: `${role}:${email}`,
    ...limits,
  });
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}

function forbidden(message: string) {
  return new PublicApiError("FORBIDDEN", message, 403);
}

function conflict(message: string) {
  return new PublicApiError("CONFLICT", message, 409);
}
