import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VenueUpdateChoices, VenueUpdateReceipt } from "./venue-update-preferences";

export async function recordVenueUpdateOptIns(admin: SupabaseClient, source: "guest_list" | "ride", receipt: string, choices?: VenueUpdateChoices): Promise<VenueUpdateReceipt[]> {
  if (!choices || (!choices.email && !choices.text)) return [];
  const { data, error } = await admin.rpc("record_venue_update_opt_ins", {
    p_source: source, p_receipt: receipt, p_email: choices.email, p_text: choices.text, p_version: choices.version,
    p_email_token: randomBytes(32).toString("base64url"), p_text_token: randomBytes(32).toString("base64url"),
  });
  if (error) throw error;
  return venueUpdateReceiptLinks(data, choices);
}

export function venueUpdateReceiptLinks(data: unknown, choices: VenueUpdateChoices): VenueUpdateReceipt[] {
  if (!Array.isArray(data) || data.length !== Number(choices.email) + Number(choices.text)
    || data.some(row => !["email", "text"].includes(row.channel) || !/^[A-Za-z0-9_-]{43}$/.test(row.token) || typeof row.active !== "boolean")) {
    throw new Error("Update preferences could not be confirmed.");
  }
  return data.map(row => ({ channel: row.channel, active: row.active, manageUrl: `/updates/${row.token}` }));
}
