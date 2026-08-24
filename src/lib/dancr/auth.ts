import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import type { AccountState, CustomerProfile, DancrAccount, DancerAccountProfile, Json, UserRole } from "./types";
import { initialDancerApprovalValues } from "./profile-approval";
import { transitionDancerPublication } from "./profile-publication";

type DancrClient = SupabaseClient;

export type CustomerSignupInput = {
  name: string;
  email: string;
  password: string;
  city?: string;
};

export type DancerSignupInput = {
  email: string;
  password: string;
  city?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export async function signUpCustomer(client: DancrClient, input: CustomerSignupInput) {
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        role: "customer",
        display_name: input.name,
      },
    },
  });

  if (error) throw error;
  if (!data.user) return null;

  await createAppUser(client, {
    id: data.user.id,
    role: "customer",
    displayName: input.name,
    email: input.email,
  });

  const { error: profileError } = await client.from("customer_profiles").upsert({
    user_id: data.user.id,
    city: input.city || "Las Vegas",
  });

  if (profileError) throw profileError;
  return data.user;
}

export async function signUpDancer(client: DancrClient, input: DancerSignupInput) {
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        role: "dancer",
        display_name: "Dancer",
        stage_name: null,
        city: input.city || "",
      },
    },
  });

  if (error) throw error;
  if (!data.user) return null;

  await createAppUser(client, {
    id: data.user.id,
    role: "dancer",
    displayName: "Dancer",
    email: input.email,
  });

  const { error: profileError } = await client.from("dancer_profiles").upsert({
    user_id: data.user.id,
    real_name: null,
    stage_name: "",
    slug: `dancer-${data.user.id.slice(0, 8)}`,
    city: input.city || "",
    ...initialDancerApprovalValues(),
  });

  if (profileError) throw profileError;
  return data.user;
}

export async function login(client: DancrClient, input: LoginInput) {
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) throw error;
  return data.user;
}

export async function logout(client: DancrClient) {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getCurrentAccount(client: DancrClient): Promise<DancrAccount | null> {
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError) throw userError;
  if (!user) return null;

  const { data, error } = await client
    .from("app_users")
    .select("id, role, display_name, email, account_state")
    .eq("id", user.id)
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

  if (accountState === "active" && current.account_state === "disabled" && !selfDisabledAt) {
    throw new Error("This account was disabled by MyDancr. Contact support to restore access.");
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
  const priorVenueActive = typeof originalMetadata.mydancr_venue_was_active === "boolean"
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
        ...originalMetadata,
        mydancr_self_disabled_at: selfDisabledAt || new Date().toISOString(),
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
        await publicationClient.auth.admin.updateUserById(userId, { app_metadata: originalMetadata });
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
      await publicationClient.auth.admin.updateUserById(userId, { app_metadata: originalMetadata });
    }
    throw error;
  }

  if (accountState === "active") {
    const { error: venueError } = ownedVenue
      ? await publicationClient.from("venues").update({ is_active: priorVenueActive }).eq("id", ownedVenue.id)
      : { error: null };
    const restoredMetadata = { ...originalMetadata };
    delete restoredMetadata.mydancr_self_disabled_at;
    delete restoredMetadata.mydancr_venue_was_active;
    const { error: metadataError } = await publicationClient.auth.admin.updateUserById(userId, {
      app_metadata: restoredMetadata,
    });
    if (venueError || metadataError) {
      if (ownedVenue) await publicationClient.from("venues").update({ is_active: false }).eq("id", ownedVenue.id);
      await publicationClient.from("app_users").update({ account_state: "disabled" }).eq("id", userId);
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
  if (input.notificationSettings) update.notification_settings = input.notificationSettings;

  const { data, error } = await client
    .from("customer_profiles")
    .update(update)
    .eq("user_id", userId)
    .select("user_id, city, notification_settings")
    .single();

  if (error) throw error;

  return {
    userId: data.user_id,
    city: data.city,
    notificationSettings: data.notification_settings,
  };
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

export function dashboardPathForRole(role: UserRole) {
  if (role === "dancer") return "/dashboard/dancer";
  if (role === "venue") return "/dashboard/venue";
  if (role === "admin") return "/admin";
  return "/dashboard/customer";
}

async function createAppUser(
  client: DancrClient,
  input: { id: string; role: UserRole; displayName: string; email: string },
) {
  const { error } = await client.from("app_users").upsert({
    id: input.id,
    role: input.role,
    display_name: input.displayName,
    email: input.email,
  });

  if (error) throw error;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
