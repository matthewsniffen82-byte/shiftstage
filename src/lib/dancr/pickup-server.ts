import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import type { PickupRole } from "./pickup-domain";

export async function pickupRpc(client: SupabaseClient, name: string) {
  const { data, error } = await client.rpc(name);
  if (error) throw new PublicApiError("UNAVAILABLE", "Unable to load pickup requests. Please retry.", 503);
  return data;
}
export async function pickupAccountRole(client: SupabaseClient): Promise<PickupRole> {
  const role = await pickupRpc(client, "pickup_actor_role");
  if (!["customer", "venue", "admin"].includes(role)) throw new PublicApiError("FORBIDDEN", "Pickup requests are available to authorized venue managers.", 403);
  return role;
}
