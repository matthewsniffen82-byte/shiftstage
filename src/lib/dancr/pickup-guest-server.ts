import "server-only";
import { createHash, createHmac } from "node:crypto";
import { createAdminSupabaseClient } from "../supabase/admin";
import { PublicApiError } from "../api-error-policy";
import { requestClientAddress } from "../security/request-client-address";
import { pickupRpc } from "./pickup-server";
import { pickupCommand, pickupCreateArgs, pickupUuid } from "./pickup-validation";

async function guestRpc(name: string, args: Record<string, unknown>) {
  try { return await pickupRpc(createAdminSupabaseClient(), name, args); }
  catch (error) {
    if (error instanceof PublicApiError && error.status === 403) {
      throw new PublicApiError("FORBIDDEN", "This private chat link is invalid or expired, or this action is unavailable. Reopen your saved pickup chat link.", 403);
    }
    throw error;
  }
}

export function pickupGuestKeyHash(request: Request) {
  const key = request.headers.get("x-pickup-guest-key");
  if (!key || !/^[a-f0-9]{64}$/.test(key)) {
    throw new PublicApiError("AUTH_REQUIRED", "Open the private link saved when you requested pickup to access this chat.", 401);
  }
  return createHash("sha256").update(key).digest("hex");
}

export async function createGuestPickup(request: Request, body: Record<string, unknown>) {
  const keyHash = pickupGuestKeyHash(request), args = pickupCreateArgs(body);
  const secret = process.env.DANCR_PUBLIC_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new PublicApiError("UNAVAILABLE", "Pickup is temporarily unavailable.", 503);
  const rateKey = createHmac("sha256", secret).update(`pickup-guest:${requestClientAddress(request)}`).digest("hex");
  return guestRpc("pickup_guest_create", { ...args, p_key_hash: keyHash, p_rate_key: rateKey });
}

export async function getGuestPickup(request: Request, id: string) {
  const p_id = pickupUuid(id), p_key_hash = pickupGuestKeyHash(request);
  const before = new URL(request.url).searchParams.get("before");
  if (before !== null && (!/^\d{1,16}$/.test(before) || !Number.isSafeInteger(Number(before)))) {
    throw new PublicApiError("INVALID_REQUEST", "Invalid message position.", 400);
  }
  return guestRpc("pickup_guest_get", { p_id, p_key_hash, p_before: before === null ? null : Number(before) });
}

export async function commandGuestPickup(request: Request, id: string, body: Record<string, unknown>) {
  const p_key_hash = pickupGuestKeyHash(request), command = pickupCommand(id, body);
  if (command.name === "pickup_admin_note") throw new PublicApiError("FORBIDDEN", "This pickup action is unavailable.", 403);
  return guestRpc("pickup_guest_command", {
    p_id: id, p_key_hash, p_command: command.name, p_args: command.args,
  });
}
