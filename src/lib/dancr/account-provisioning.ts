import type { SupabaseClient } from "@supabase/supabase-js";
import { initialDancerApprovalValues } from "./profile-approval";
import type { UserRole } from "./types";

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
  const { error: accountError } = await client.from("app_users").upsert({
    id: input.userId,
    role: input.role,
    display_name: displayName,
    email: input.email,
  });
  if (accountError) throw accountError;

  if (input.role === "customer") {
    const { error } = await client.from("customer_profiles").upsert({
      user_id: input.userId,
      city: input.city,
    });
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
    real_name: null,
    stage_name: "",
    slug,
    city: input.city,
    ...initialDancerApprovalValues(),
  });
  if (error) throw error;
}

async function uniqueDancerSlug(client: DancrClient, userId: string) {
  const baseSlug = `dancer-${userId.slice(0, 8)}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (true) {
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
}
