import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows, type NotificationDeliveryRow } from "./notification-delivery";

type DancrClient = SupabaseClient;
type FollowSource = "follows" | "venue_follows";

type FollowNotificationInput = {
  dancerId?: string;
  dealId?: string;
  eventId: string;
  stageName?: string;
  venueId: string;
  venueName: string;
  venueSlug?: string | null;
};

export async function broadcastFollowedDancerUpcomingShift(
  client: DancrClient,
  input: FollowNotificationInput & { shiftDate: string },
) {
  const recipientIds = await followedCustomerIds(client, "follows", "dancer_id", input.dancerId || "");
  return persistAndDeliver(client, recipientIds, input, {
    notificationType: "shift_posted",
    title: `${input.stageName} posted an upcoming shift`,
    body: `${input.stageName} posted an upcoming shift at ${input.venueName}.`,
    kind: "followed_dancer_upcoming_shift",
    payload: { shiftDate: input.shiftDate },
  });
}

export async function broadcastFollowedDancerWorkingNow(
  client: DancrClient,
  input: FollowNotificationInput,
) {
  const recipientIds = await followedCustomerIds(client, "follows", "dancer_id", input.dancerId || "");
  return persistAndDeliver(client, recipientIds, input, {
    notificationType: "shift_updated",
    title: `${input.stageName} is Working Now`,
    body: `${input.stageName} is Working Now at ${input.venueName}.`,
    kind: "followed_dancer_working_now",
  });
}

export async function broadcastFollowedClubDealPublished(
  client: DancrClient,
  input: FollowNotificationInput & { dealTitle: string },
) {
  const recipientIds = await followedCustomerIds(client, "venue_follows", "venue_id", input.venueId);
  return persistAndDeliver(client, recipientIds, input, {
    notificationType: "engagement",
    title: `New Club Deal at ${input.venueName}`,
    body: `${input.dealTitle} is now available at ${input.venueName}.`,
    kind: "followed_club_deal_published",
  });
}

export async function broadcastFollowedClubRosterAddition(
  client: DancrClient,
  input: FollowNotificationInput,
) {
  const recipientIds = await followedCustomerIds(client, "venue_follows", "venue_id", input.venueId);
  return persistAndDeliver(client, recipientIds, input, {
    notificationType: "engagement",
    title: `${input.stageName} joined ${input.venueName}`,
    body: `${input.stageName} was added to ${input.venueName}'s dancer roster.`,
    kind: "followed_club_roster_addition",
  });
}

export function customerFollowAlertsEnabled(settings: unknown) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  return (settings as Record<string, unknown>).followAlertsEnabled !== false;
}

async function followedCustomerIds(
  client: DancrClient,
  source: FollowSource,
  targetColumn: "dancer_id" | "venue_id",
  targetId: string,
): Promise<string[]> {
  if (!targetId) return [];
  const { data: follows, error: followsError } = await (client as any)
    .from(source)
    .select("customer_id")
    .eq(targetColumn, targetId);
  if (followsError) throw followsError;

  const candidateIds: string[] = Array.from(new Set<string>(
    (follows || []).map((follow: { customer_id: string }) => String(follow.customer_id)),
  ));
  if (!candidateIds.length) return [];

  const [{ data: accounts, error: accountsError }, { data: profiles, error: profilesError }] = await Promise.all([
    (client as any)
      .from("app_users")
      .select("id")
      .in("id", candidateIds)
      .eq("role", "customer")
      .eq("account_state", "active"),
    (client as any)
      .from("customer_profiles")
      .select("user_id, notification_settings")
      .in("user_id", candidateIds),
  ]);
  if (accountsError) throw accountsError;
  if (profilesError) throw profilesError;

  const activeIds = new Set((accounts || []).map((account: { id: string }) => account.id));
  const settingsById = new Map((profiles || []).map((profile: { user_id: string; notification_settings: unknown }) => (
    [profile.user_id, profile.notification_settings]
  )));
  return candidateIds.filter((customerId) => (
    activeIds.has(customerId) && customerFollowAlertsEnabled(settingsById.get(customerId))
  ));
}

async function persistAndDeliver(
  client: DancrClient,
  recipientIds: string[],
  input: FollowNotificationInput,
  notification: {
    body: string;
    kind: string;
    notificationType: NotificationDeliveryRow["notification_type"];
    payload?: Record<string, unknown>;
    title: string;
  },
) {
  const sentAt = new Date().toISOString();
  const rows = recipientIds.map((recipientId) => ({
    id: deterministicNotificationId(notification.kind, input.eventId, recipientId),
    recipient_id: recipientId,
    notification_type: notification.notificationType,
    channel: "in_app",
    title: notification.title,
    body: notification.body,
    payload: {
      kind: notification.kind,
      dancerId: input.dancerId || null,
      dealId: input.dealId || null,
      venueId: input.venueId,
      venueSlug: input.venueSlug || null,
      ...notification.payload,
    },
    sent_at: sentAt,
  }));
  if (!rows.length) return 0;

  const { data, error } = await (client as any)
    .from("notifications")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;

  const insertedIds = new Set((data || []).map((row: { id: string }) => row.id));
  const insertedRows = rows.filter((row) => insertedIds.has(row.id));
  await deliverNotificationRows(client, insertedRows);
  return insertedRows.length;
}

function deterministicNotificationId(kind: string, eventId: string, recipientId: string) {
  const digest = createHash("sha256")
    .update(`mydancr:${kind}:${eventId}:${recipientId}`)
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
