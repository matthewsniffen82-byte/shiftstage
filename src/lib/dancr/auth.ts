import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountState, CustomerProfile, DancrAccount, DancerAccountProfile, UserRole } from "./types";

type DancrClient = SupabaseClient;

export type CustomerSignupInput = {
  name: string;
  email: string;
  password: string;
  city?: string;
};

export type DancerSignupInput = {
  realName: string;
  stageName: string;
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
        display_name: input.stageName,
        real_name: input.realName,
        stage_name: input.stageName,
        city: input.city || "Las Vegas",
      },
    },
  });

  if (error) throw error;
  if (!data.user) return null;

  await createAppUser(client, {
    id: data.user.id,
    role: "dancer",
    displayName: input.stageName,
    email: input.email,
  });

  const { error: profileError } = await client.from("dancer_profiles").upsert({
    user_id: data.user.id,
    real_name: input.realName,
    stage_name: input.stageName,
    slug: slugify(input.stageName),
    city: input.city || "Las Vegas",
    status: "draft",
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

export async function setAccountState(client: DancrClient, userId: string, accountState: AccountState) {
  const update: Record<string, string | null> = {
    account_state: accountState,
  };

  if (accountState === "deleted") {
    update.display_name = null;
    update.email = null;
  }

  const { data, error } = await client
    .from("app_users")
    .update(update)
    .eq("id", userId)
    .select("id, role, display_name, email, account_state")
    .single();

  if (error) throw error;

  if (data.role === "dancer" && accountState !== "active") {
    const { error: dancerError } = await client
      .from("dancer_profiles")
      .update({
        status: "disabled",
        disabled_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (dancerError) throw dancerError;
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

export async function getDancerAccountProfile(client: DancrClient, userId: string): Promise<DancerAccountProfile | null> {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id, user_id, real_name, stage_name, slug, city, bio, status, verification_status, photo_review_status")
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
    bio: data.bio,
    status: data.status,
    verificationStatus: data.verification_status,
    photoReviewStatus: data.photo_review_status,
  };
}

export function dashboardPathForRole(role: UserRole) {
  if (role === "dancer") return "/dashboard/dancer";
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
