import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackRole = "customer" | "dancer" | "venue";
type CallbackUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function GET(request: Request) {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const callbackSession = await readCallbackSession(request);
  const sessionScript = callbackSession
    ? `<script>window.__DANCR_CONFIRMED_SESSION__=${JSON.stringify(callbackSession).replace(/</g, "\\u003c")};</script>`
    : "";
  const withBase = html.replace("<head>", `<head><base href="/outputs/">${sessionScript}`);

  return new Response(withBase, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readCallbackSession(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const roleHint = readCallbackRole(url.searchParams.get("role"));
  if (!code) return null;

  try {
    const client = createServerSupabaseClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user) return null;

    const admin = createAdminSupabaseClient();
    let account = await getAccountByUserId(admin, data.user.id);
    if (roleHint) {
      await ensureCallbackAccount(admin, data.user, roleHint);
      account = await getAccountByUserId(admin, data.user.id);
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
      account,
    };
  } catch {
    return null;
  }
}

async function ensureCallbackAccount(admin: AdminClient, user: CallbackUser, role: CallbackRole) {
  const metadata = user.user_metadata || {};
  const email = user.email?.toLowerCase() || readMetadataText(metadata.email).toLowerCase();
  const displayName =
    readMetadataText(metadata.display_name) ||
    readMetadataText(metadata.stage_name) ||
    readMetadataText(metadata.venue_name) ||
    displayNameFromEmail(email, role);

  const { error: accountError } = await admin.from("app_users").upsert({
    id: user.id,
    role,
    display_name: displayName,
    email,
    account_state: "active",
  });
  if (accountError) throw accountError;

  if (role === "customer") {
    const { error } = await admin.from("customer_profiles").upsert({
      user_id: user.id,
      city: readMetadataText(metadata.city) || "Las Vegas",
    });
    if (error) throw error;
    return;
  }

  if (role === "dancer") {
    await ensureCallbackDancerProfile(admin, user.id, displayName, metadata);
  }
}

async function ensureCallbackDancerProfile(
  admin: AdminClient,
  userId: string,
  displayName: string,
  metadata: Record<string, unknown>,
) {
  const stageName = readMetadataText(metadata.stage_name) || displayName || "New Dancer";
  const realName = readMetadataText(metadata.real_name) || "Verification pending";
  const city = readMetadataText(metadata.city) || "Las Vegas";

  const { data: existingProfile, error: existingProfileError } = await admin
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingProfileError) throw existingProfileError;

  if (existingProfile) {
    const { error } = await admin
      .from("dancer_profiles")
      .update({
        real_name: realName,
        stage_name: stageName,
        city,
        status: "draft",
      })
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  const slug = await uniqueDancerSlug(admin, stageName, userId);
  const { error } = await admin.from("dancer_profiles").insert({
    user_id: userId,
    real_name: realName,
    stage_name: stageName,
    slug,
    city,
    status: "draft",
  });
  if (error) throw error;
}

async function uniqueDancerSlug(admin: AdminClient, stageName: string, userId: string) {
  const baseSlug = slugify(stageName) || `dancer-${userId.slice(0, 8)}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (true) {
    const { data, error } = await admin
      .from("dancer_profiles")
      .select("user_id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.user_id === userId) return candidate;

    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
}

function readCallbackRole(value: string | null): CallbackRole | null {
  return value === "customer" || value === "dancer" || value === "venue" ? value : null;
}

function readMetadataText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function displayNameFromEmail(email: string, role: CallbackRole) {
  const fallback = role === "dancer" ? "Dancer" : role === "venue" ? "Venue" : "Customer";
  return email.split("@")[0]?.trim() || fallback;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
