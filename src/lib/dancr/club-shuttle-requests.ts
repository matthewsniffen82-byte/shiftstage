import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { normalizeShuttlePhone, normalizeShuttleRequest } from "./club-deal-transportation";
import { getActiveClubDealById } from "./deals";
import { deliverNotificationRows, sendShuttlePhoneAlert } from "./notification-delivery";

type ShuttleDetails = NonNullable<ReturnType<typeof normalizeShuttleRequest>>;
type AfterResponse = (delivery: () => Promise<void>) => void;
type ShuttleReceipt = {
  id: string; venue_id: string; deal_id: string | null; details_hash: string;
  notification_rows: Array<Parameters<typeof deliverNotificationRows>[1][number] & { id: string }>;
  venue_phone: string | null; handed_off_at: string | null;
};
const RECEIPT_SELECT = "id, venue_id, deal_id, details_hash, notification_rows, venue_phone, handed_off_at";

export async function getClubShuttleRecipientIds(client: SupabaseClient, venueId: string, ownerId: string | null) {
  if (!ownerId) return [];
  const { data: members, error: memberError } = await client.from("venue_team_members")
    .select("user_id").eq("venue_id", venueId).eq("status", "active").eq("role", "manager").limit(100);
  if (memberError) throw memberError;
  if ((members?.length || 0) >= 100) throw new PublicApiError("UNAVAILABLE", "Shuttle requests are unavailable for this club right now.", 503);
  const ids = [...new Set([ownerId, ...(members || []).map(member => member.user_id)])];
  const { data: accounts, error: accountError } = await client.from("app_users")
    .select("id").in("id", ids).eq("role", "venue").eq("account_state", "active");
  if (accountError) throw accountError;
  if (!accounts?.some(account => account.id === ownerId)) return [];
  return accounts.map(account => String(account.id));
}

export async function submitClubShuttleRequest(client: SupabaseClient, dealId: string, input: Record<string, unknown>, afterResponse?: AfterResponse) {
  const details = readDetails(input);
  const previous = await readReceipt(client, details.requestId);
  if (previous) {
    assertMatchingRequest(previous, details, null, dealId);
    return handoffRequest(client, previous, afterResponse);
  }
  const deal = await getActiveClubDealById(client, dealId);
  if (!deal) throw new PublicApiError("NOT_FOUND", "This Club Deal is no longer available.", 404);
  return submitVenueShuttleRequest(client, deal.venueId, input, dealId, afterResponse);
}

export async function submitVenueShuttleRequest(client: SupabaseClient, venueId: string, input: Record<string, unknown>, dealId: string | null = null, afterResponse?: AfterResponse) {
  const details = readDetails(input);
  const previous = await readReceipt(client, details.requestId);
  if (previous) {
    assertMatchingRequest(previous, details, venueId, dealId);
    return handoffRequest(client, previous, afterResponse);
  }
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
  // Commit the authoritative lead first. The unique ID arbitrates simultaneous
  // retries; compare immutable guest details before any secondary delivery.
  const { error: insertError } = await client.from("club_shuttle_requests")
    .upsert({ id: details.requestId, venue_id: venue.id, deal_id: dealId,
      details_hash: detailsHash(details), notification_rows: rows,
      venue_phone: normalizeShuttlePhone(venue.phone) }, { onConflict: "id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const receipt = await readReceipt(client, details.requestId);
  if (!receipt) throw new PublicApiError("UNAVAILABLE", "Your request could not be confirmed. Retry the same request.", 503);
  assertMatchingRequest(receipt, details, venueId, dealId);
  return handoffRequest(client, receipt, afterResponse);
}

function readDetails(input: Record<string, unknown>) {
  const details = normalizeShuttleRequest(input);
  if (!details) throw new PublicApiError("INVALID_REQUEST", "Enter your name, pickup location, party size (1–100), contact phone number, and email address, then accept the club handoff.", 400);
  return { ...details, requestId: details.requestId.toLowerCase() };
}

function detailsHash(details: ShuttleDetails) {
  return createHash("sha256").update(JSON.stringify(details)).digest("hex");
}

async function readReceipt(client: SupabaseClient, requestId: string): Promise<ShuttleReceipt | null> {
  const { data, error } = await client.from("club_shuttle_requests")
    .select(RECEIPT_SELECT).eq("id", requestId).maybeSingle();
  if (error) throw error;
  return data;
}

function assertMatchingRequest(receipt: ShuttleReceipt, details: ShuttleDetails, venueId: string | null, dealId: string | null) {
  if (receipt.id !== details.requestId || receipt.details_hash !== detailsHash(details)
    || receipt.deal_id !== (dealId?.toLowerCase() || null) || (venueId && receipt.venue_id !== venueId.toLowerCase())) {
    throw new PublicApiError("INVALID_REQUEST", "This request was already submitted with different details. Open a new pickup form to make a new request.", 409);
  }
}

async function handoffRequest(client: SupabaseClient, receipt: ShuttleReceipt, afterResponse?: AfterResponse) {
  const { data, error } = await client.rpc("handoff_club_shuttle_request", { p_request_id: receipt.id });
  if (error || data?.request_id !== receipt.id || typeof data?.newly_handed_off !== "boolean") {
    console.warn("SHUTTLE_INBOX_HANDOFF_UNCONFIRMED");
    throw new PublicApiError("UNAVAILABLE", "Your request is saved, but the club handoff could not be confirmed. Retry the same request.", 503);
  }
  let push = { push: 0 }, sms = false;
  const alertsScheduled = Boolean(data.newly_handed_off && afterResponse);
  // External alerts are best effort after the inbox transaction. A replay never
  // repeats an external send, even after provider idempotency keys expire.
  if (data.newly_handed_off) {
    const deliver = async () => {
      [push, sms] = await Promise.all([
        deliverNotificationRows(client, receipt.notification_rows.map(row => ({ ...row, deliveryId: row.id })), { email: false })
          .catch(() => { console.warn("SHUTTLE_PUSH_UNAVAILABLE"); return { push: 0 }; }),
        receipt.venue_phone ? sendShuttlePhoneAlert({ phone: receipt.venue_phone,
          requestId: notificationId(receipt.id, receipt.venue_id) })
          .catch(() => { console.warn("SHUTTLE_PHONE_UNAVAILABLE"); return false; }) : Promise.resolve(false),
      ]);
    };
    // Route handlers pass Next's after() so Vercel retains the response lifetime.
    // The durable lead and inbox handoff above must succeed before scheduling.
    if (afterResponse) afterResponse(deliver);
    else await deliver();
  }
  return { requestId: receipt.id, alertsScheduled,
    phoneAlertAccepted: alertsScheduled ? null : sms, pushAlertAccepted: alertsScheduled ? null : push.push > 0,
    message: "Your request has been sent to the club manager. The club will contact you at the phone number you provided to arrange and confirm pickup. Your ride is not yet confirmed." };
}

function notificationId(requestId: string, recipientId: string) {
  const hex = createHash("sha256").update(`club-shuttle:${requestId}:${recipientId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
