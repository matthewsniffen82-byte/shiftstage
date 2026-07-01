import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
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
    const email = readRequired(body.email, "Email is required.").toLowerCase();
    const client = createServerSupabaseClient();

    if (mode === "reset_password") {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: safeEmailRedirectTo(body.emailRedirectTo),
      });
      if (error) throw error;

      return NextResponse.json({
        ok: true,
        message: "Password reset email sent.",
      });
    }

    const password = readRequired(body.password, "Password is required.");

    if (mode === "login") {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("Sign in required.");

      return NextResponse.json(await authResponse(data.user.id, role, data.session, false));
    }

    if (role === "admin") {
      throw new Error("Admin signup is not available.");
    }

    const city = readOptional(body.city) || "Las Vegas";
    const displayName =
      role === "customer"
        ? customerDisplayName(email)
        : role === "venue"
          ? readRequired(body.name, "Venue name is required.")
          : readOptional(body.stageName) || dancerDisplayName(email);
    const metadata =
      role === "customer"
        ? { role, display_name: displayName }
        : role === "venue"
          ? { role, display_name: displayName, venue_name: displayName, city }
          : {
              role,
              display_name: displayName,
              stage_name: readOptional(body.stageName) || null,
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

    await upsertAccount(role, data.user.id, email, displayName, city, body);

    if (role === "customer") {
      return NextResponse.json(await authResponse(data.user.id, role, null, true));
    }

    return NextResponse.json(await authResponse(data.user.id, role, data.session, !data.session));
  } catch (error) {
    const rateLimitMessage = authRateLimitMessage(error);
    if (rateLimitMessage) {
      return NextResponse.json({ ok: false, error: rateLimitMessage }, { status: 429 });
    }

    return apiError(error, "Unable to authenticate.", 400);
  }
}

async function authResponse(
  userId: string,
  expectedRole: AuthRole,
  session: { access_token?: string; refresh_token?: string; expires_at?: number } | null,
  requiresEmailConfirmation: boolean,
) {
  const admin = createAdminSupabaseClient();
  const account = await getAccountByUserId(admin, userId);
  if (account?.role && account.role !== expectedRole) {
    throw new Error("Account role does not match this login.");
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

async function upsertAccount(
  role: AuthRole,
  userId: string,
  email: string,
  displayName: string,
  city: string,
  body: Record<string, unknown>,
) {
  const admin = createAdminSupabaseClient();
  const { error: accountError } = await admin.from("app_users").upsert({
    id: userId,
    role,
    display_name: displayName,
    email,
  });
  if (accountError) throw accountError;

  if (role === "customer") {
    const { error } = await admin.from("customer_profiles").upsert({
      user_id: userId,
      city,
    });
    if (error) throw error;
    return;
  }

  if (role === "venue") {
    return;
  }

  const stageName = readOptional(body.stageName) || displayName;
  const realName = readOptional(body.realName) || "Verification pending";
  const slug = slugify(stageName) || `dancer-${userId.slice(0, 8)}`;

  const { error } = await admin
    .from("dancer_profiles")
    .upsert(
      {
        user_id: userId,
        real_name: realName,
        stage_name: stageName,
        slug,
        city,
        status: "draft",
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

function readMode(value: unknown): AuthMode {
  if (value === "login" || value === "signup" || value === "reset_password") return value;
  throw new Error("Auth mode must be login, signup, or reset_password.");
}

function readRole(value: unknown): AuthRole {
  if (value === "customer" || value === "dancer" || value === "venue" || value === "admin") return value;
  throw new Error("Role must be customer, dancer, venue, or admin.");
}

function readRequired(value: unknown, message: string) {
  const text = readOptional(value);
  if (!text) throw new Error(message);
  return text;
}

function readOptional(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function customerDisplayName(email: string) {
  return email.split("@")[0]?.trim() || "Customer";
}

function dancerDisplayName(email: string) {
  return email.split("@")[0]?.trim() || "Dancer";
}

function safeEmailRedirectTo(value: unknown) {
  const fallback = `${getPublicEnv().siteUrl.replace(/\/$/, "")}/auth/callback`;
  const text = readOptional(value);
  if (!text) return fallback;

  try {
    const requested = new URL(text);
    const site = new URL(fallback);
    if (requested.origin !== site.origin) return fallback;
    if (!requested.pathname.startsWith("/auth/callback")) return fallback;
    return requested.toString();
  } catch {
    return fallback;
  }
}

function authRateLimitMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!/rate limit/i.test(message)) return "";

  return "Too many confirmation emails were sent. Please wait a few minutes, then try again, or use the newest confirmation email already in your inbox.";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
