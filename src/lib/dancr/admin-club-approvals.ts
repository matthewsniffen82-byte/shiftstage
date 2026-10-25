import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { resendVenueAccountApproval } from "./venue-signup-requests";

const PAGE_SIZE = 25;
const ACTIONS = ["club_dashboard_link_resend_requested", "club_dashboard_link_resent", "club_dashboard_link_resend_failed"];
export function clubApprovalHistoryQuery(url: URL) {
  const status = url.searchParams.get("status") || "all";
  const page = Number(url.searchParams.get("page") || "0");
  const search = (url.searchParams.get("search") || "").trim();
  if (!["all", "approved", "rejected"].includes(status) || !Number.isSafeInteger(page) || page < 0 || page > 10000 || search.length > 160) {
    throw new PublicApiError("INVALID_REQUEST", "Invalid approval history filter.", 400);
  }
  return { status, page, search };
}
function name(value: any) { const person = Array.isArray(value) ? value[0] : value; return person?.display_name || person?.email || "Administrator"; }

export async function getClubApprovalHistory(admin: SupabaseClient, input: ReturnType<typeof clubApprovalHistoryQuery>) {
  let query = admin.from("venue_signup_requests")
    .select("id,venue_name,city,state,status,contact_name,login_email,requester_user_id,matched_venue_id,submitted_at,reviewed_at,review_notes,reviewer:app_users!venue_signup_requests_reviewed_by_fkey(display_name,email)", { count: "exact" })
    .in("status", input.status === "all" ? ["approved", "rejected"] : [input.status])
    .order("reviewed_at", { ascending: false }).order("id", { ascending: false });
  if (input.search) query = query.ilike("venue_name", `%${input.search.replace(/[\\%_]/g, char => `\\${char}`)}%`);
  const result = await query.range(input.page * PAGE_SIZE, input.page * PAGE_SIZE + PAGE_SIZE - 1);
  if (result.error) throw result.error;
  const rows = result.data || [];
  const ids = rows.map(row => row.id);
  const activity = ids.length ? await admin.from("admin_actions")
    .select("id,target_id,action,notes,created_at,actor:app_users!admin_actions_admin_id_fkey(display_name,email)")
    .eq("target_type", "venue_signup_request").in("target_id", ids).in("action", ACTIONS)
    .order("created_at", { ascending: false }).limit(250) : { data: [], error: null };
  if (activity.error) throw activity.error;
  return { page: input.page, total: result.count || 0, hasMore: (input.page + 1) * PAGE_SIZE < (result.count || 0),
    requests: rows.map(row => ({ id: row.id, venueName: row.venue_name, city: row.city, state: row.state, status: row.status,
      contactName: row.contact_name, loginEmail: row.login_email, venueId: row.matched_venue_id,
      submittedAt: row.submitted_at, reviewedAt: row.reviewed_at, reviewNotes: row.review_notes, reviewedBy: name(row.reviewer),
      canResend: row.status === "approved" && Boolean(row.login_email && row.requester_user_id && row.matched_venue_id),
      resends: (activity.data || []).filter(event => event.target_id === row.id).slice(0, 5).map(event => ({
        id: event.id, at: event.created_at, by: name(event.actor),
        status: event.action === "club_dashboard_link_resent" ? "sent" : event.action === "club_dashboard_link_resend_failed" ? "failed" : "unconfirmed",
      })),
    })),
  };
}

export async function resendClubApproval(admin: SupabaseClient, requestId: string, adminId: string) {
  const id = randomUUID();
  // Persist the attempt before delivery; never put a bearer link or token in logs.
  const started = await admin.from("admin_actions").insert({ id, admin_id: adminId, target_type: "venue_signup_request",
    target_id: requestId, action: ACTIONS[0], notes: "Dashboard link resend requested." });
  if (started.error) throw started.error;
  let delivered = false;
  let deliveryUncertain = false;
  let recipient = "";
  try {
    const result = await resendVenueAccountApproval(admin, requestId);
    delivered = result.delivered;
    deliveryUncertain = !result.delivered && "reason" in result && result.reason === "provider_unavailable";
    recipient = result.recipient;
  } catch (error) {
    await recordResult(false);
    throw error;
  }
  const historyRecorded = await recordResult(delivered, deliveryUncertain);
  return { delivered, recipient, historyRecorded, deliveryUncertain };

  async function recordResult(sent: boolean, uncertain = false) {
    try {
      const updated = await admin.from("admin_actions").update({ action: sent ? ACTIONS[1] : uncertain ? ACTIONS[0] : ACTIONS[2],
        notes: sent ? `Dashboard link emailed to ${recipient}.` : uncertain ? "Email delivery could not be confirmed." : "Dashboard link could not be sent." }).eq("id", id).select("id").single();
      if (updated.error) throw updated.error;
      if (updated.data?.id !== id) throw new Error("Resend history update was not confirmed.");
      return true;
    } catch (error) {
      console.warn("CLUB_LINK_RESEND_HISTORY_UNAVAILABLE", safeErrorMetadata(error));
      return false;
    }
  }
}
