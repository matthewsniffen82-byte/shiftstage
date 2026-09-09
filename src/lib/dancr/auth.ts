import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import type { AccountState, CustomerProfile, DancrAccount, DancerAccountProfile, Json } from "./types";
import { transitionDancerPublication } from "./profile-publication";

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
) {
  const { data: current, error: currentError } = await publicationClient
    .from("app_users")
    .select("id, role, display_name, email, account_state")
    .eq("id", userId)
    .single();
  if (currentError) throw currentError;

  const { data: authData, error: authError } = await publicationClient.auth.admin.getUserById(userId);
  if (authError) throw authError;
  const originalMetadata = { ...(authData.user.app_metadata || {}) };
  const selfDisabledAt = typeof originalMetadata.mydancr_self_disabled_at === "string"
    ? originalMetadata.mydancr_self_disabled_at
    : "";
  const originalSelfServiceMetadata = {
    mydancr_self_disabled_at: originalMetadata.mydancr_self_disabled_at ?? null,
    mydancr_venue_was_active: originalMetadata.mydancr_venue_was_active ?? null,
  };

  if (current.account_state === "deleted" && accountState !== "deleted") {
    throw new PublicApiError("FORBIDDEN", "Deleted accounts cannot be reactivated.", 403);
  }
  if (current.account_state === "disabled" && !selfDisabledAt && accountState !== "deleted") {
    throw new PublicApiError("FORBIDDEN", "This account was disabled by MyDancr. Contact support to restore access.", 403);
  }

  const { data: ownedVenue, error: venueReadError } = current.role === "venue"
    ? await publicationClient
        .from("venues")
        .select("id, is_active")
        .eq("owner_user_id", userId)
        .maybeSingle()
    : { data: null, error: null };
  if (venueReadError) throw venueReadError;

  const originalVenueActive = ownedVenue?.is_active === true;
  const priorVenueActive = current.account_state === "disabled" && typeof originalMetadata.mydancr_venue_was_active === "boolean"
    ? originalMetadata.mydancr_venue_was_active
    : originalVenueActive;
  const nextAccountUpdate: Record<string, string | null> = { account_state: accountState };
  if (accountState === "deleted") {
    nextAccountUpdate.display_name = null;
    nextAccountUpdate.email = null;
  }

  if (accountState === "disabled") {
    const { error: metadataError } = await publicationClient.auth.admin.updateUserById(userId, {
      app_metadata: {
        mydancr_self_disabled_at: current.account_state === "disabled" ? selfDisabledAt : new Date().toISOString(),
        ...(ownedVenue ? { mydancr_venue_was_active: priorVenueActive } : {}),
      },
    });
    if (metadataError) throw metadataError;
  }

  if (ownedVenue && accountState !== "active") {
    const { error: venueError } = await publicationClient
      .from("venues")
      .update({ is_active: false })
      .eq("id", ownedVenue.id);
    if (venueError) {
      if (accountState === "disabled") {
        await publicationClient.auth.admin.updateUserById(userId, { app_metadata: originalSelfServiceMetadata });
      }
      throw venueError;
    }
  }

  const { data, error } = await publicationClient
    .from("app_users")
    .update(nextAccountUpdate)
    .eq("id", userId)
    .select("id, role, display_name, email, account_state")
    .single();

  if (error) {
    if (ownedVenue && accountState !== "active") {
      await publicationClient.from("venues").update({ is_active: originalVenueActive }).eq("id", ownedVenue.id);
    }
    if (accountState === "disabled") {
      await publicationClient.auth.admin.updateUserById(userId, { app_metadata: originalSelfServiceMetadata });
    }
    throw error;
  }

  if (accountState === "active") {
    const { error: venueError } = ownedVenue
      ? await publicationClient.from("venues").update({ is_active: priorVenueActive }).eq("id", ownedVenue.id)
      : { error: null };
    // Supabase merges metadata updates; null explicitly removes these permissions.
    const restoredMetadata = { mydancr_self_disabled_at: null, mydancr_venue_was_active: null };
    const { error: metadataError } = await publicationClient.auth.admin.updateUserById(userId, {
      app_metadata: restoredMetadata,
    });
    if (venueError || metadataError) {
      if (ownedVenue) await publicationClient.from("venues").update({ is_active: false }).eq("id", ownedVenue.id);
      const { error: rollbackError } = await publicationClient.from("app_users").update({ account_state: "disabled" }).eq("id", userId);
      if (!rollbackError) {
        await publicationClient.auth.admin.updateUserById(userId, { app_metadata: originalSelfServiceMetadata });
      }
      throw venueError || metadataError;
    }
  }

  if (data.role === "dancer") {
    const { data: dancer, error: dancerError } = await publicationClient
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (dancerError) throw dancerError;
    if (dancer?.id) {
      await transitionDancerPublication(
        publicationClient,
        dancer.id,
        accountState === "active" ? "reactivate" : "disable",
        { actorUserId: userId },
      );
    }
  }

  return {
    id: data.id,
    role: data.role,
    displayName: data.display_name,
    email: data.email,
    accountState: data.account_state,
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
