import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import type { AccountState, CustomerProfile, DancrAccount, DancerAccountProfile, Json } from "./types";

type DancrClient = SupabaseClient;

export async function getAccountByUserId(client: DancrClient, userId: string): Promise<DancrAccount | null> {
  const { data, error } = await client
    .from("app_users")
    .select("id, role, display_name, email, account_state")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    role: data.role,
    displayName: data.display_name,
    email: data.email,
    accountState: data.account_state,
  };
}

export async function requireActiveVenueAccount(client: DancrClient, userId: string): Promise<DancrAccount> {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "venue" || account.accountState !== "active") {
    throw new PublicApiError("FORBIDDEN", "Active venue account required.", 403);
  }
  return account;
}

export async function setAccountState(
  client: DancrClient,
  userId: string,
  accountState: AccountState,
  publicationClient: DancrClient = client,
): Promise<DancrAccount> {
  const unavailable = () => new PublicApiError(
    "UNAVAILABLE", "We couldn't confirm the account change. Check your account state before trying again.", 503,
  );
  let result;
  try {
    result = await publicationClient.rpc("transition_own_account_safely", {
      p_user_id: userId, p_account_state: accountState,
    });
  } catch {
    throw unavailable();
  }
  if (result.error) {
    if (result.error.code === "42501") {
      throw new PublicApiError("FORBIDDEN", "This account cannot make that change. Contact support to restore restricted access.", 403);
    }
    if (result.error.code === "22023") {
      throw new PublicApiError("INVALID_REQUEST", "This account change is not available.", 400);
    }
    // A missing function or lost response never triggers independent writes or
    // compensation. Retrying reads the committed state and its private pause.
    throw unavailable();
  }
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || data.id !== userId || data.account_state !== accountState
    || !["customer", "dancer", "venue", "admin"].includes(data.role)
    || (data.display_name !== null && typeof data.display_name !== "string")
    || (data.email !== null && typeof data.email !== "string")) {
    throw unavailable();
  }
  return {
    id: data.id, role: data.role, displayName: data.display_name,
    email: data.email, accountState: data.account_state,
  };
}

export async function getCustomerProfile(client: DancrClient, userId: string): Promise<CustomerProfile | null> {
  const { data, error } = await client
    .from("customer_profiles")
    .select("user_id, city, notification_settings")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    userId: data.user_id,
    city: data.city,
    notificationSettings: data.notification_settings,
  };
}

export async function updateCustomerProfile(
  client: DancrClient,
  userId: string,
  input: { city?: string; notificationSettings?: Record<string, Json> },
): Promise<CustomerProfile> {
  const update: Record<string, string | Record<string, Json>> = {};
  if (typeof input.city === "string") update.city = input.city;
  for (let attempt = 0; attempt < 3; attempt++) {
    let previous: Record<string, Json> | null = null;
    if (input.notificationSettings) {
      const { data, error } = await client.from("customer_profiles").select("notification_settings").eq("user_id", userId).single();
      if (error) throw error;
      previous = data.notification_settings;
      update.notification_settings = { ...(previous || {}), ...input.notificationSettings };
    }
    let query = client.from("customer_profiles").update(update).eq("user_id", userId);
    if (input.notificationSettings) {
      // Compare and retry so older pages and simultaneous device edits cannot
      // erase another preference while updating one switch.
      query = previous === null ? query.is("notification_settings", null) : query.eq("notification_settings", JSON.stringify(previous));
    }
    const { data, error } = await query.select("user_id, city, notification_settings").maybeSingle();
    if (error) throw error;
    if (data) return { userId: data.user_id, city: data.city, notificationSettings: data.notification_settings };
  }
  throw new Error("Your preferences changed on another device. Please try again.");
}

export async function getDancerAccountProfile(client: DancrClient, userId: string): Promise<DancerAccountProfile | null> {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id, user_id, real_name, stage_name, slug, city, status, verification_status, photo_review_status, avatar_storage_path, avatar_updated_at, is_public, venue_approved_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    realName: data.real_name,
    stageName: data.stage_name,
    slug: data.slug,
    city: data.city,
    status: data.status,
    verificationStatus: data.verification_status,
    photoReviewStatus: data.photo_review_status,
    avatarStoragePath: data.avatar_storage_path || null,
    avatarUpdatedAt: data.avatar_updated_at || null,
    isPublic: data.is_public !== false,
    venueApprovedAt: data.venue_approved_at || null,
  };
}
