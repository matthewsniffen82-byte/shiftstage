import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { PublicApiError } from "../api-error-policy";

export async function staffSessionSecurity(client: SupabaseClient) {
  const { data, error } = await client.rpc("staff_session_security");
  if (error || typeof data?.active !== "boolean" || typeof data?.mfaVerified !== "boolean") {
    throw new PublicApiError("UNAVAILABLE", "Unable to verify staff security. Please try again.", 503);
  }
  if (!data.active) throw new PublicApiError("AUTH_REQUIRED", "Sign in again to continue securely.", 401);
  return { active: true, mfaVerified: data.mfaVerified as boolean };
}

export async function requireStaffMfa(client: SupabaseClient) {
  const status = await staffSessionSecurity(client);
  if (!status.mfaVerified) {
    throw new PublicApiError("MFA_REQUIRED", "Verify your authenticator in Account settings → Staff security before accessing safety and privacy records.", 403);
  }
}

export function staffFactors(user: User) {
  return (user.factors || []).filter(f => f.factor_type === "totp").map(f => ({
    id: f.id, name: f.friendly_name || "Authenticator", verified: f.status === "verified",
  }));
}

export async function staffMfaAction(client: SupabaseClient, user: User, body: Record<string, unknown>) {
  const security = await staffSessionSecurity(client);
  const factors = staffFactors(user);
  if (body.action === "enroll") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) throw new PublicApiError("INVALID_REQUEST", "Give this authenticator a name (up to 60 characters).", 400);
    if (factors.some(f => f.verified) && !security.mfaVerified) await requireStaffMfa(client);
    if (factors.some(f => !f.verified)) throw new PublicApiError("CONFLICT", "Finish or remove the unfinished setup before adding another authenticator.", 409);
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: name, issuer: "MyDancr" });
    if (error || !data || data.type !== "totp") throw new PublicApiError("UNAVAILABLE", "Authenticator setup could not be confirmed. Refresh before trying again.", 503);
    // The setup URI/secret is returned only to the authenticated owner, never logged or stored by MyDancr.
    const qr = await QRCode.toDataURL(data.totp.uri, { width: 240, margin: 2, errorCorrectionLevel: "M" });
    return { enrollment: { id: data.id, qr, secret: data.totp.secret } };
  }
  const factor = factors.find(f => f.id === body.factorId);
  if (!factor) throw new PublicApiError("INVALID_REQUEST", "Choose an authenticator belonging to this account.", 400);
  if (body.action === "verify") {
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new PublicApiError("INVALID_REQUEST", "Enter the current six-digit authenticator code.", 400);
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: body.code });
    if (error) throw new PublicApiError("INVALID_REQUEST", "The code could not be verified. Try the latest code from your authenticator.", 400);
    await requireStaffMfa(client);
    return { message: "Authenticator verified. Safety and privacy access is available for this session." };
  }
  if (body.action === "remove") {
    if (factor.verified) {
      await requireStaffMfa(client);
      if (factors.filter(f => f.verified).length < 2) throw new PublicApiError("CONFLICT", "Add and verify a replacement authenticator before removing your last one.", 409);
    }
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw new PublicApiError("UNAVAILABLE", "Removal could not be confirmed. Refresh and check your authenticators.", 503);
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) throw new PublicApiError("AUTH_REQUIRED", "Authenticator removed. Sign in again to continue.", 401);
    return { message: factor.verified ? "Authenticator removed. Verify a remaining authenticator if requested." : "Unfinished setup removed." };
  }
  throw new PublicApiError("INVALID_REQUEST", "Choose a valid security action.", 400);
}
