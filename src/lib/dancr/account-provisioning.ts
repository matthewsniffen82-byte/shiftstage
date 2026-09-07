import type { SupabaseClient } from "@supabase/supabase-js";
import { initialDancerApprovalValues } from "./profile-approval";
import type { UserRole } from "./types";
import { isMissingSupabaseFunction } from "../supabase/missing-function";

type DancrClient = SupabaseClient;

export type ProvisionAppAccountInput = {
  role: UserRole;
  userId: string;
  email: string;
  displayName: string;
  city: string;
  existingDancerLogEvent?: string;
};

export async function provisionAppAccount(
  client: DancrClient,
  input: ProvisionAppAccountInput,
) {
  const displayName = input.role === "dancer" ? "Dancer" : input.displayName;
  const provisioned = await client.rpc("provision_app_account_safely", {
    p_user_id: input.userId, p_role: input.role, p_email: input.email,
    p_display_name: displayName, p_city: input.city,
  });
  if (!provisioned.error) {
    if (provisioned.data !== true) throw new Error("Account setup could not be confirmed. Please sign in again.");
    return;
  }
  if (!isMissingSupabaseFunction(provisioned.error, "provision_app_account_safely")) throw provisioned.error;

  // Compatibility only while an older database is awaiting the additive migration.
  const { error: accountError } = await client.from("app_users").upsert({
    id: input.userId,
    role: input.role,
    display_name: displayName,
    email: input.email,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (accountError) throw accountError;
  const account = await client.from("app_users").select("role").eq("id", input.userId).single();
  if (account.error) throw account.error;
  if (account.data.role !== input.role) throw new Error("This account already uses a different account type. Sign in with that account.");

  if (input.role === "customer") {
    const { error } = await client.from("customer_profiles").upsert({
      user_id: input.userId,
      city: input.city,
    }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw error;
    return;
  }

  if (input.role !== "dancer") return;

  const { data: existingProfile, error: existingProfileError } = await client
    .from("dancer_profiles")
    .select("id, status, verification_status, photo_review_status, is_public, approved_at, disabled_at")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingProfileError) throw existingProfileError;

  if (existingProfile) {
    console.log(
      input.existingDancerLogEvent || "EXISTING_DANCER_PROFILE_PRESERVED_DURING_ACCOUNT_PROVISIONING",
      {
        dancerId: existingProfile.id,
        status: existingProfile.status,
        verificationStatus: existingProfile.verification_status,
        photoReviewStatus: existingProfile.photo_review_status,
        isPublic: existingProfile.is_public,
        approvedAt: existingProfile.approved_at,
        disabledAt: existingProfile.disabled_at,
      },
    );
    return;
  }

  const slug = await uniqueDancerSlug(client, input.userId);
  const { error } = await client.from("dancer_profiles").insert({
    user_id: input.userId,
    real_name: "Verification pending",
    stage_name: "",
    slug,
    city: input.city,
    ...initialDancerApprovalValues(),
  });
  if (error?.code === "23505") {
    const raced = await client.from("dancer_profiles").select("id").eq("user_id", input.userId).maybeSingle();
    if (raced.error) throw raced.error;
    if (raced.data) return;
  }
  if (error) throw error;
}

async function uniqueDancerSlug(client: DancrClient, userId: string) {
  const baseSlug = `dancer-${userId.slice(0, 8)}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (suffix <= 8) {
    const { data, error } = await client
      .from("dancer_profiles")
      .select("user_id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.user_id === userId) return candidate;

    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
  return `dancer-${userId}`;
}
