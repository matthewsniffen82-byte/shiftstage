import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { provisionAppAccount } from "@/src/lib/dancr/account-provisioning";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getVenueForAccount } from "@/src/lib/dancr/venue";
import {
  hasVenueOwnershipClaim,
  redeemVenueSignupCode,
  resolveVenueSignupCode,
} from "@/src/lib/dancr/venue-claims";
import { redeemVenueTeamInvitation, resolveVenueTeamInvitation } from "@/src/lib/dancr/venue-team";
import {
  AccountRecoveryRateLimitError,
  enforceAccountRecoveryRateLimit,
} from "@/src/lib/dancr/account-recovery";
import { requireDancerSignupCity } from "@/src/lib/dancr/signup-cities";
import { getPublicEnv } from "@/src/lib/env";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthRole = "customer" | "dancer" | "venue" | "admin";
type AuthMode = "login" | "signup" | "reset_password";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = readMode(body.mode);
    const role = readRole(body.role);
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

    const password = readRequired(body.password, "Password is required.");

    if (mode === "login") {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("Sign in required.");

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
      throw new Error("Password must be at least 8 characters.");
    }

    if (role === "admin") {
      validateAdminSignupCode(body.adminCode);

      const admin = createAdminSupabaseClient();
      const displayName = credential.username || "Admin";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
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
        venueCode: readRequired(body.venueCode, "Venue access code is required."),
      }));
    }

    const city = role === "dancer"
      ? await requireDancerSignupCity(createAdminSupabaseClient(), body.city)
      : readOptional(body.city) || "Las Vegas";
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
            city,
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
    const rateLimitMessage = authRateLimitMessage(error);
    if (rateLimitMessage) {
      return NextResponse.json({ ok: false, error: rateLimitMessage }, { status: 429 });
    }

    return apiError(error, "Unable to authenticate.", 400);
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
    throw new Error("This account is not ready for sign in. Contact support for help.");
  }
  if (expectedRole && account.role !== expectedRole) {
    throw new Error("Account role does not match this login.");
  }
  if (account.role === "venue") {
    const [venue, hasLegacyClaim] = await Promise.all([
      getVenueForAccount(admin, userId),
      hasVenueOwnershipClaim(admin, userId),
    ]);
    if (!venue && !hasLegacyClaim) {
      throw new Error("No venue is connected to this account. Use your venue access code during sign up.");
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
  if (!venue) throw new Error("This venue access invitation is invalid.");
  let createdUserId = "";
  let accessRedeemed = false;

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
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
  throw new Error("Auth mode must be login, signup, or reset_password.");
}

function readRole(value: unknown): AuthRole {
  if (value === "customer" || value === "dancer" || value === "venue" || value === "admin") return value;
  throw new Error("Role must be customer, dancer, venue, or admin.");
}

function readAuthCredential(body: Record<string, unknown>, role: AuthRole) {
  if (role !== "admin") {
    return { email: readRequired(body.email, "Email is required.").toLowerCase(), username: "" };
  }

  const username = readOptional(body.username) || readOptional(body.email);
  if (!username) throw new Error("Admin username is required.");

  return {
    email: adminAuthEmail(username),
    username: username.includes("@") ? username.split("@")[0] || "admin" : username,
  };
}

function validateAdminSignupCode(value: unknown) {
  const expected = process.env.DANCR_ADMIN_SIGNUP_CODE || process.env.DANCR_ADMIN_SEED_KEY;
  if (!expected) throw new Error("Admin signup code is not configured.");
  if (readRequired(value, "Admin code is required.") !== expected) {
    throw new Error("Admin code is invalid.");
  }
}

function readRequired(value: unknown, message: string) {
  const text = readOptional(value);
  if (!text) throw new Error(message);
  return text;
}

function readOptional(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function adminAuthEmail(username: string) {
  const normalized = username.trim().toLowerCase();
  if (normalized.includes("@")) return normalized;

  const slug = normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Admin username is required.");

  return `${slug}@admin.mydancr.local`;
}

function customerDisplayName(email: string) {
  return email.split("@")[0]?.trim() || "Customer";
}

function safeEmailRedirectTo(value: unknown) {
  const fallback = `${getPublicEnv().siteUrl.replace(/\/$/, "")}/auth/callback`;
  const text = readOptional(value);
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
    "https://stackeddbets.com",
    "https://www.stackeddbets.com",
    "https://shiftstage.vercel.app",
  ]);
}

function authRateLimitMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!/rate limit/i.test(message)) return "";

  return "Too many confirmation emails were sent. Please wait a few minutes, then try again, or use the newest confirmation email already in your inbox.";
}
