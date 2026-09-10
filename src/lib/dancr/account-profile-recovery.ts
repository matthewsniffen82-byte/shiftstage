import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { getAccountByUserId } from "./auth";
import type { DancrAccount } from "./types";

/** Supplied only after Supabase has verified the user, never from a request body. */
export type VerifiedAccountIdentity = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

export async function recoverVerifiedPublicAccount(
  admin: SupabaseClient,
  user: VerifiedAccountIdentity,
  account: DancrAccount | null,
): Promise<DancrAccount> {
  if (account && account.id !== user.id) throw setupConflict();
  // Recovery never resumes a disabled/deleted account or grants professional authority.
  if (account && (account.accountState !== "active" || !isPublicRole(account.role))) return account;
  const publicHint = readText(user.user_metadata?.role).toLowerCase();
  const trustedHint = readText(user.app_metadata?.mydancr_provisioned_role).toLowerCase();
  if (!account && [publicHint, trustedHint].some(role => role === "admin" || role === "venue")) throw setupConflict();
  const role = account?.role || (publicHint === "dancer" ? "dancer" : "customer");
  if (!isPublicRole(role)) throw setupConflict();
  if (account && await hasOwnedProfile(admin, role, user.id)) return account;

  const email = readText(user.email) || account?.email || "";
  if (!email) throw setupConflict();
  // The existing RPC locks the account and inserts only missing rows. Do not use
  // the legacy multi-write fallback or retry an unconfirmed result during login.
  const { data, error } = await admin.rpc("provision_app_account_safely", {
    p_user_id: user.id,
    p_role: role,
    p_email: email,
    p_display_name: role === "dancer" ? "Dancer" : account?.displayName || readText(user.user_metadata?.display_name) || email.split("@")[0],
    p_city: role === "customer" ? readText(user.user_metadata?.city) || "Las Vegas" : "",
  });
  if (error) throw error;
  if (data !== true) throw setupUnavailable();
  const recovered = await getAccountByUserId(admin, user.id);
  if (!recovered || recovered.id !== user.id || recovered.role !== role) throw setupUnavailable();
  if (recovered.accountState === "active" && !await hasOwnedProfile(admin, role, user.id)) throw setupUnavailable();
  return recovered;
}

async function hasOwnedProfile(admin: SupabaseClient, role: "customer" | "dancer", userId: string) {
  const { data, error } = await admin.from(role === "dancer" ? "dancer_profiles" : "customer_profiles")
    .select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (data && data.user_id !== userId) throw setupUnavailable();
  return Boolean(data);
}

function isPublicRole(role: string): role is "customer" | "dancer" {
  return role === "customer" || role === "dancer";
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function setupConflict() {
  return new PublicApiError("CONFLICT", "Your account setup needs help from MyDancr support.", 409);
}

function setupUnavailable() {
  return new PublicApiError("UNAVAILABLE", "We couldn't confirm your account setup. Please try signing in again.", 503);
}
