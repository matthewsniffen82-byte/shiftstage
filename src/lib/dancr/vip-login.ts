import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { safeErrorMetadata } from "../security/safe-error-metadata";

// This selects the sign-in area; VIP permissions still come from membership checks.
export async function requireVipLoginArea(client: SupabaseClient, input: {
  userId: string;
  verifiedEmail?: string;
  loginArea: unknown;
  accessToken?: string;
}) {
  if (input.loginArea === "vip") return;

  try {
    const membership = await client.from("venue_vip_members").select("id")
      .eq("user_id", input.userId).eq("active", true).limit(1).maybeSingle();
    if (membership.error) throw membership.error;
    let isVip = Boolean(membership.data);
    // Also keep invited customers on the VIP setup path before activation.
    if (!isVip && input.verifiedEmail) {
      const invitation = await client.from("venue_vip_invitations").select("id")
        .eq("email", input.verifiedEmail.trim().toLowerCase())
        .is("accepted_at", null).is("revoked_at", null)
        .gt("expires_at", new Date().toISOString()).limit(1).maybeSingle();
      if (invitation.error) throw invitation.error;
      isVip = Boolean(invitation.data);
    }
    if (!isVip) return;
    throw new PublicApiError("FORBIDDEN", "VIP accounts must use the special VIP sign-in area at mydancr.com/vip. Select VIP sign in to continue.", 403);
  } catch (error) {
    // Credentials were verified, but this session must never reach the browser.
    // Revoke only this attempt, leaving the customer's other sessions intact.
    if (input.accessToken) {
      try {
        const revoked = await client.auth.admin.signOut(input.accessToken, "local");
        if (revoked.error) throw revoked.error;
      } catch (cleanupError) {
        console.error("VIP_LOGIN_SESSION_CLEANUP_FAILED", safeErrorMetadata(cleanupError));
      }
    }
    if (error instanceof PublicApiError) throw error;
    console.error("VIP_LOGIN_LOOKUP_FAILED", safeErrorMetadata(error));
    throw new PublicApiError("UNAVAILABLE", "Unable to confirm your sign-in area. Please try again shortly.", 503);
  }
}
