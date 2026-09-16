import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickupUuid } from "./pickup-validation";
import type { PickupVenue } from "./pickup-domain";

export async function getPickupVenue(client: SupabaseClient, venueId: string): Promise<PickupVenue | null> {
  pickupUuid(venueId);
  const { data, error } = await client.from("venues").select("id,name,slug,owner_user_id")
    .eq("id", venueId).eq("is_active", true).eq("page_review_status", "published").not("published_at", "is", null).maybeSingle();
  if (error) throw error;
  if (!data?.owner_user_id) return null;
  const { data: owner, error: ownerError } = await client.from("app_users").select("id")
    .eq("id", data.owner_user_id).eq("role", "venue").eq("account_state", "active").maybeSingle();
  if (ownerError) throw ownerError;
  return owner ? { id: data.id, name: data.name, slug: data.slug } : null;
}
