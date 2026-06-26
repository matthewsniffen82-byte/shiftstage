import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function followDancer(client: DancrClient, customerId: string, dancerId: string) {
  const { error } = await client.from("follows").upsert({
    customer_id: customerId,
    dancer_id: dancerId,
    notifications_enabled: true,
  });

  if (error) throw error;
}

export async function unfollowDancer(client: DancrClient, customerId: string, dancerId: string) {
  const { error } = await client.from("follows").delete().match({
    customer_id: customerId,
    dancer_id: dancerId,
  });

  if (error) throw error;
}

export async function setDancerNotifications(
  client: DancrClient,
  customerId: string,
  dancerId: string,
  enabled: boolean,
) {
  const { error } = await client.from("follows").upsert({
    customer_id: customerId,
    dancer_id: dancerId,
    notifications_enabled: enabled,
  });

  if (error) throw error;
}

export async function followVenue(client: DancrClient, customerId: string, venueId: string) {
  const { error } = await client.from("venue_follows").upsert({
    customer_id: customerId,
    venue_id: venueId,
    notifications_enabled: true,
  });

  if (error) throw error;
}

export async function unfollowVenue(client: DancrClient, customerId: string, venueId: string) {
  const { error } = await client.from("venue_follows").delete().match({
    customer_id: customerId,
    venue_id: venueId,
  });

  if (error) throw error;
}

export async function markGoing(client: DancrClient, customerId: string, shiftId: string) {
  const { error } = await client.from("going_signals").upsert({
    customer_id: customerId,
    shift_id: shiftId,
  });

  if (error) throw error;
}

export async function cancelGoing(client: DancrClient, customerId: string, shiftId: string) {
  const { error } = await client.from("going_signals").delete().match({
    customer_id: customerId,
    shift_id: shiftId,
  });

  if (error) throw error;
}
