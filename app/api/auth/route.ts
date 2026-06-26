import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthRole = "customer" | "dancer";
type AuthMode = "login" | "signup";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = readMode(body.mode);
    const role = readRole(body.role);
    const email = readRequired(body.email, "Email is required.").toLowerCase();
    const password = readRequired(body.password, "Password is required.");
    const client = createServerSupabaseClient();

    if (mode === "login") {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("Sign in required.");

      return NextResponse.json(await authResponse(data.user.id, role, data.session, false));
    }

    const city = readOptional(body.city) || "Las Vegas";
    const displayName =
      role === "customer"
        ? readRequired(body.name, "Name is required.")
        : readRequired(body.stageName, "Stage name is required.");
    const metadata =
      role === "customer"
        ? { role, display_name: displayName }
        : {
            role,
            display_name: displayName,
            real_name: readRequired(body.realName, "Legal name is required."),
            stage_name: displayName,
            city,
          };

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });

    if (error) throw error;
    if (!data.user) throw new Error("Unable to create account.");

    await upsertAccount(role, data.user.id, email, displayName, city, body);

    return NextResponse.json(await authResponse(data.user.id, role, data.session, !data.session));
  } catch (error) {
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

  const { error } = await admin.from("dancer_profiles").upsert({
    user_id: userId,
    real_name: readRequired(body.realName, "Legal name is required."),
    stage_name: displayName,
    slug: slugify(displayName),
    city,
    status: "draft",
  });
  if (error) throw error;
}

function readMode(value: unknown): AuthMode {
  if (value === "login" || value === "signup") return value;
  throw new Error("Auth mode must be login or signup.");
}

function readRole(value: unknown): AuthRole {
  if (value === "customer" || value === "dancer") return value;
  throw new Error("Role must be customer or dancer.");
}

function readRequired(value: unknown, message: string) {
  const text = readOptional(value);
  if (!text) throw new Error(message);
  return text;
}

function readOptional(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
