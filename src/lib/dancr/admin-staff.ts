import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { staffRole, type StaffRole } from "./admin-workspace-policy";
import { isUsernameOnlyAdminEmail, sendAccountEmailAction } from "./email-actions";

export type StaffAccount = { id: string; email: string; display_name: string; admin_workspace_role: StaffRole; account_state: string };
const staffColumns = "id,email,display_name,admin_workspace_role,account_state";
const conflict = () => new PublicApiError("CONFLICT", "This email already has an account. Use a separate staff email, or manage the existing staff account below.", 409);

export function readStaffDetails(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const role = staffRole(body.role);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || isUsernameOnlyAdminEmail(email)) {
    throw new PublicApiError("INVALID_REQUEST", "Enter an email address where the staff member can receive their setup link.", 400);
  }
  if (!displayName || displayName.length > 100 || !role) throw new PublicApiError("INVALID_REQUEST", "Enter a name and choose a valid staff role.", 400);
  return { email, displayName, role };
}

export async function addAdminStaff(admin: SupabaseClient, actorId: string, input: ReturnType<typeof readStaffDetails>) {
  const existing = await admin.from("app_users").select("id").eq("email", input.email).maybeSingle();
  if (existing.error) throw existing.error;
  let user;
  if (existing.data) {
    const result = await admin.auth.admin.getUserById(existing.data.id);
    if (result.error) throw result.error;
    user = result.data.user;
  } else {
    const result = await admin.auth.admin.createUser({
      email: input.email, password: randomBytes(48).toString("base64url"), email_confirm: false,
      app_metadata: { mydancr_staff_created_by: actorId }, user_metadata: { display_name: input.displayName },
    });
    if (result.error) {
      if (["email_exists", "user_already_exists"].includes(result.error.code || "")) throw conflict();
      throw result.error;
    }
    user = result.data.user;
  }
  // Auth is read through its admin API, not by granting SQL access to auth.users.
  // Resume only this owner's unaccepted staff setup, never a public signup.
  if (!user?.id || user.email?.toLowerCase() !== input.email || user.app_metadata?.mydancr_staff_created_by !== actorId
    || user.email_confirmed_at || user.last_sign_in_at || (user.banned_until && Date.parse(user.banned_until) > Date.now())) throw conflict();
  const result = await admin.rpc("provision_admin_staff", {
    p_actor: actorId, p_target: user.id, p_email: input.email, p_name: input.displayName, p_role: input.role,
  });
  if (result.error) throw result.error;
  const staff = result.data as StaffAccount | null;
  if (!staff || staff.id !== user.id || staff.email !== input.email || !staffRole(staff.admin_workspace_role) || staff.account_state !== "active") {
    throw new Error("Staff access could not be confirmed.");
  }
  // Keep the saved account visible if delivery fails, so the owner can resend.
  try {
    await sendStaffSetup(admin, staff);
    return { staff, message: "Staff added. A password-setup email has been sent." };
  } catch (error) {
    console.error("ADMIN_STAFF_SETUP_EMAIL_FAILED", safeErrorMetadata(error));
    return { staff, deliveryWarning: "Staff access was saved, but the setup email could not be sent. Use Send setup email to try again." };
  }
}

export async function resendAdminStaffSetup(admin: SupabaseClient, id: string) {
  const result = await admin.from("app_users").select(staffColumns).eq("id", id).eq("role", "admin").eq("account_state", "active").is("dmca_suspended_at", null).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new PublicApiError("NOT_FOUND", "Active staff account not found.", 404);
  const staff = result.data as StaffAccount;
  await sendStaffSetup(admin, staff);
  return { staff, message: "Password-setup email sent. Their current password keeps working until they change it." };
}

async function sendStaffSetup(admin: SupabaseClient, staff: StaffAccount) {
  if (!staff.email || isUsernameOnlyAdminEmail(staff.email)) throw new PublicApiError("INVALID_REQUEST", "This staff member must add a sign-in email in their account settings first.", 400);
  if (!await sendAccountEmailAction(admin, { userId: staff.id, purpose: "recovery", returnTo: "/admin" })) {
    throw new Error("Staff setup email was not sent.");
  }
}
