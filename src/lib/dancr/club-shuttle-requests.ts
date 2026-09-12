import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { normalizeShuttlePhone, normalizeShuttleRequest } from "./club-deal-transportation";
import { getActiveClubDealById } from "./deals";
import { deliverNotificationRows, sendShuttlePhoneAlert } from "./notification-delivery";

export async function getClubShuttleRecipientIds(client: SupabaseClient, venueId: string, ownerId: string | null) {
  if (!ownerId) return [];
  const { data: members, error: memberError } = await client.from("venue_team_members")
    .select("user_id").eq("venue_id", venueId).eq("status", "active").eq("role", "manager");
  if (memberError) throw memberError;
  const ids = [...new Set([ownerId, ...(members || []).map(member => member.user_id)])];
  const { data: accounts, error: accountError } = await client.from("app_users")
    .select("id").in("id", ids).eq("role", "venue").eq("account_state", "active");
  if (accountError) throw accountError;
  if (!accounts?.some(account => account.id === ownerId)) return [];
  return accounts.map(account => String(account.id));
}

export async function submitClubShuttleRequest(client: SupabaseClient, dealId: string, input: Record<string, unknown>) {
  const deal = await getActiveClubDealById(client, dealId);
  if (!deal) throw new PublicApiError("NOT_FOUND", "This Club Deal is no longer available.", 404);
  return submitVenueShuttleRequest(client, deal.venueId, input, dealId);
}

export async function submitVenueShuttleRequest(client: SupabaseClient, venueId: string, input: Record<string, unknown>, dealId: string | null = null) {
  const details = normalizeShuttleRequest(input);
  if (!details) throw new PublicApiError("INVALID_REQUEST", "Enter your name, pickup location, party size (1–100), contact phone number, and email address, then accept the club handoff.", 400);
  const { data: venue, error: venueError } = await client.from("venues")
    .select("id, name, phone, owner_user_id").eq("id", venueId).eq("is_active", true)
    .eq("page_review_status", "published").not("published_at", "is", null).maybeSingle();
  if (venueError) throw venueError;
  if (!venue?.owner_user_id) throw new PublicApiError("UNAVAILABLE", "Shuttle requests are unavailable for this club right now. Please try again later.", 503);
  const recipientIds = await getClubShuttleRecipientIds(client, venue.id, venue.owner_user_id);
  if (!recipientIds.length) throw new PublicApiError("UNAVAILABLE", "Shuttle requests are unavailable for this club right now. Please try again later.", 503);
  const body = `MyDancr free shuttle request for ${venue.name}: ${details.name}. Pickup: ${details.location}. Party: ${details.partySize}. Phone: ${details.phone}. Email: ${details.email}. Please contact the guest to arrange and confirm pickup. Your club handles all transportation.`;
  const rows = recipientIds.map(recipientId => ({
    id: notificationId(details.requestId, recipientId), recipient_id: recipientId,
    notification_type: "support_message" as const, channel: "in_app" as const,
    title: "MyDancr: free shuttle requested", body,
    payload: { kind: "club_shuttle_request", venueId: venue.id, dealId, ...details },
  }));
  // The existing private notification inbox is the durable handoff. Deterministic
  // IDs and provider idempotency keys prevent duplicate alerts on network retries.
  const { error: insertError } = await client.from("notifications")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data: receipts, error: receiptError } = await client.from("notifications")
    .select("id, body, payload").in("id", rows.map(row => row.id));
  if (receiptError) throw receiptError;
  if (receipts?.length !== rows.length || receipts.some(row => row.body !== body || row.payload?.dealId !== dealId || row.payload?.venueId !== venue.id)) {
    throw new PublicApiError("INVALID_REQUEST", "This request was already submitted with different details. Open a new pickup form to make a new request.", 409);
  }
  const phone = normalizeShuttlePhone(venue.phone);
  const [push, sms] = await Promise.all([
    deliverNotificationRows(client, rows.map(row => ({ ...row, deliveryId: row.id })), { email: false }).catch(() => ({ push: 0 })),
    phone ? sendShuttlePhoneAlert({ phone, body, requestId: notificationId(details.requestId, venue.id) }) : Promise.resolve(false),
  ]);
  return { requestId: details.requestId, phoneAlertAccepted: sms, pushAlertAccepted: push.push > 0,
    message: "Your request has been sent to the club manager. The club will contact you at the phone number you provided to arrange and confirm pickup. Your ride is not yet confirmed." };
}

function notificationId(requestId: string, recipientId: string) {
  const hex = createHash("sha256").update(`club-shuttle:${requestId}:${recipientId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
