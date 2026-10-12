import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { normalizeShuttleRequest } from "./club-deal-transportation";
import { getTonightWindow } from "./schedule";
import { vipId, vipNickname } from "./vip";
import { ADMIN_GUEST_SECTIONS, type AdminGuestData, type AdminGuestRow, type AdminGuestSection } from "./admin-guest-operations-types";

const invalid = () => new PublicApiError("INVALID_REQUEST", "Choose a valid club, section, filter or page.", 400);
export function adminGuestQuery(search: URLSearchParams) {
  const venueId = vipId(search.get("venueId"));
  const section = search.get("section") || "visits";
  const offset = Number(search.get("offset") || 0);
  const status = search.get("status") || "all";
  const period = search.get("period") || "30d";
  const allowed: Record<AdminGuestSection, string[]> = {
    visits: ["all", "pending", "confirmed", "declined", "cancelled"], members: ["all", "active", "revoked"],
    invitations: ["all", "pending", "accepted", "revoked", "expired"], guests: ["all", "generated", "redeemed", "voided", "expired"],
    rides: ["all"], updates: ["all", "active", "withdrawn", "email", "text"], results: ["all"],
  };
  if (!ADMIN_GUEST_SECTIONS.includes(section as AdminGuestSection) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000
    || !allowed[section as AdminGuestSection].includes(status) || !["tonight", "7d", "30d"].includes(period)) throw invalid();
  return { venueId, section: section as AdminGuestSection, offset, status, period };
}

export function adminGuestAction(body: Record<string, unknown>) {
  const venueId = vipId(body.venueId);
  const action = String(body.action || "");
  if (!["request_status", "invite", "revoke_invitation", "revoke_member", "set_nickname", "unsubscribe"].includes(action)) throw invalid();
  const id = action === "invite" ? undefined : vipId(body.id);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500 || /\p{Cc}/u.test(note)) throw invalid();
  const data: Record<string, unknown> = { id, note };
  if (action === "request_status") {
    if (!["confirmed", "declined", "cancelled"].includes(String(body.status)) || !["pending", "confirmed"].includes(String(body.expectedStatus))
      || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) throw invalid();
    Object.assign(data, { status: body.status, expectedStatus: body.expectedStatus, expectedUpdatedAt: body.expectedUpdatedAt });
  }
  if (action === "invite") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw invalid();
    Object.assign(data, { email, nickname: vipNickname(body.nickname || "") });
  }
  if (action === "set_nickname") {
    data.nickname = vipNickname(body.nickname);
    data.expectedNickname = vipNickname(body.expectedNickname);
  }
  if (action === "unsubscribe") {
    if (typeof body.expectedConsentedAt !== "string" || !Number.isFinite(Date.parse(body.expectedConsentedAt))) throw invalid();
    data.expectedConsentedAt = body.expectedConsentedAt;
  }
  return { venueId, action, data };
}

// Called only after requireAdmin verifies the current account; never expose receipt credentials or notification recipients.
export async function getAdminGuestOperations(admin: SupabaseClient, search: URLSearchParams): Promise<AdminGuestData> {
  const { venueId, section, offset, status, period } = adminGuestQuery(search);
  const venueResult = await admin.from("venues").select("id,name,timezone,is_active").eq("id", venueId).single();
  if (venueResult.error) throw venueResult.error;
  const venue = venueResult.data;
  const now = new Date(), timestamp = now.toISOString();
  if (section === "results") {
    const tonight = getTonightWindow(venue.timezone, now);
    const periodStart = period === "tonight" ? tonight.startsAt : new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86400000).toISOString();
    const [report, followers] = await Promise.all([
      admin.rpc("get_venue_performance_analytics", { p_venue_id: venueId, p_since: periodStart, p_until: timestamp, p_tonight_since: tonight.startsAt, p_tonight_until: tonight.endsAt }),
      admin.from("venue_follows").select("customer_id", { count: "exact", head: true }).eq("venue_id", venueId),
    ]);
    if (report.error) throw report.error; if (followers.error) throw followers.error;
    return { venue, section, rows: [], hasMore: false, results: { report: report.data, periodStart, periodEnd: timestamp, totalFollowers: followers.count || 0 } };
  }

  // Each section is bounded independently; a failed read is an error, never an empty successful list.
  let query: any;
  if (section === "visits") {
    query = admin.from("venue_vip_requests").select("id,guest_name,starts_at,dancers,notes,response_note,status,created_at,updated_at").eq("venue_id", venueId);
    if (status !== "all") query = query.eq("status", status);
  } else if (section === "members") {
    query = admin.from("venue_vip_members").select("id,display_name,nickname,active,created_at").eq("venue_id", venueId);
    if (status !== "all") query = query.eq("active", status === "active");
  } else if (section === "invitations") {
    query = admin.from("venue_vip_invitations").select("id,email,nickname,created_at,expires_at,accepted_at,revoked_at").eq("venue_id", venueId);
    if (status === "pending") query = query.is("accepted_at", null).is("revoked_at", null).gt("expires_at", timestamp);
    if (status === "accepted") query = query.not("accepted_at", "is", null);
    if (status === "revoked") query = query.not("revoked_at", "is", null);
    if (status === "expired") query = query.is("accepted_at", null).is("revoked_at", null).lte("expires_at", timestamp);
  } else if (section === "guests") {
    query = admin.from("venue_guest_list_entries").select("pass_id,guest_name,email,phone,created_at,qr_redemptions!inner(status,expires_at,arrival_method)").eq("venue_id", venueId);
    if (status === "generated") query = query.eq("qr_redemptions.status", status).gt("qr_redemptions.expires_at", timestamp);
    else if (status === "expired") query = query.eq("qr_redemptions.status", "generated").lte("qr_redemptions.expires_at", timestamp);
    else if (status !== "all") query = query.eq("qr_redemptions.status", status);
  } else if (section === "rides") {
    query = admin.from("club_shuttle_requests").select("id,venue_id,created_at,handed_off_at,notification_rows").eq("venue_id", venueId);
  } else {
    query = admin.from("venue_update_subscriptions").select("id,name,channel,destination,consented_at,withdrawn_at").eq("venue_id", venueId);
    if (["email", "text"].includes(status)) query = query.eq("channel", status).is("withdrawn_at", null);
    if (status === "active") query = query.is("withdrawn_at", null);
    if (status === "withdrawn") query = query.not("withdrawn_at", "is", null);
  }
  const result = await query.order(section === "updates" ? "consented_at" : "created_at", { ascending: false })
    .order(section === "guests" ? "pass_id" : "id", { ascending: false }).range(offset, offset + 50);
  if (result.error) throw result.error;
  const rows: AdminGuestRow[] = (result.data || []).slice(0, 50).map((row: any) => {
    const base = { id: row.id || row.pass_id, name: row.guest_name || row.display_name || row.name || row.email || "Guest", status: row.status || "", createdAt: row.created_at || row.consented_at };
    if (section === "visits") return { ...base, startsAt: row.starts_at, updatedAt: row.updated_at, note: row.notes, dancers: (row.dancers || []).map((d: any) => d.stageName || d.stage_name || d.name || "Dancer") };
    if (section === "members") return { ...base, nickname: row.nickname || "", status: row.active ? "active" : "revoked" };
    if (section === "invitations") return { ...base, nickname: row.nickname || "", email: row.email, expiresAt: row.expires_at, status: row.accepted_at ? "accepted" : row.revoked_at ? "revoked" : Date.parse(row.expires_at) <= now.getTime() ? "expired" : "pending" };
    if (section === "guests") {
      const pass = Array.isArray(row.qr_redemptions) ? row.qr_redemptions[0] : row.qr_redemptions;
      return { ...base, phone: row.phone, email: row.email, expiresAt: pass.expires_at, arrivalMethod: pass.arrival_method, status: pass.status === "generated" && Date.parse(pass.expires_at) <= now.getTime() ? "expired" : pass.status };
    }
    if (section === "rides") {
      const payload = row.notification_rows?.find((n: any) => n.payload?.kind === "club_shuttle_request" && n.payload.requestId === row.id && n.payload.venueId === venueId)?.payload;
      const details = payload && normalizeShuttleRequest({ ...payload, handoffAccepted: true });
      if (!details) throw new PublicApiError("UNAVAILABLE", "A ride request could not be read. Refresh to try again.", 503);
      return { ...base, name: details.name, phone: details.phone, email: details.email, location: details.location, partySize: details.partySize, status: row.handed_off_at ? "handed off" : "handoff pending" };
    }
    return { ...base, channel: row.channel, destination: row.destination, consentedAt: row.consented_at, withdrawnAt: row.withdrawn_at, status: row.withdrawn_at ? "withdrawn" : "active" };
  });
  return { venue, section, rows, hasMore: result.data.length > 50 };
}
