import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorMetadata } from "../security/safe-error-metadata";

type PasswordIdentity = { id: string; app_metadata?: Record<string, unknown> | null };
const completedKey = "mydancr_password_setup_completed_at";

// Read only server-owned metadata on a freshly verified Auth user. Email
// confirmation, last_sign_in_at and user-editable metadata are not evidence.
export function passwordSetupCompleted(user: PasswordIdentity) {
  const value = user.app_metadata?.[completedKey];
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

// Call only after a successful password signup, password login or password update.
// A recording failure must not report that an already committed password failed.
export async function recordPasswordSetup(admin: SupabaseClient | (() => SupabaseClient), user: PasswordIdentity) {
  if (passwordSetupCompleted(user)) return true;
  try {
    const client = typeof admin === "function" ? admin() : admin;
    const { data, error } = await client.auth.admin.updateUserById(user.id, {
      app_metadata: { [completedKey]: new Date().toISOString() },
    });
    if (error) throw error;
    if (data.user?.id !== user.id || !passwordSetupCompleted(data.user)) throw new Error("Password setup recording was not confirmed.");
    return true;
  } catch (error) {
    console.warn("PASSWORD_SETUP_RECORDING_UNAVAILABLE", safeErrorMetadata(error));
    return false;
  }
}
