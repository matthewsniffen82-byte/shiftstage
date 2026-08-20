import type { SupabaseClient } from "@supabase/supabase-js";
import { getDancerForUser } from "./payout-account-store";
import { requireVenueAccess } from "./venue-access";

type DancrClient = SupabaseClient;

const MAX_FINANCE_ROWS = 5_000;

export async function getVenueStatementRows(client: DancrClient, userId: string, month: string) {
  const access = await requireVenueAccess(client, userId, "view_finance");
  const { data: venue, error: venueError } = await (client as any).from("venues").select("id, name").eq("id", access.venueId).maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue profile not found.");
  const { data, error } = await (client as any).from("deal_revenue_events")
    .select("id, source_type, gross_commission_cents, status, confirmed_at, venue_payment_received_at, club_deals(deal_title)")
    .eq("venue_id", venue.id).eq("commission_month", `${month}-01`).order("confirmed_at", { ascending: true }).limit(MAX_FINANCE_ROWS);
  if (error) throw error;
  return { owner: venue.name, month, rows: data || [] };
}

export async function getDancerStatementRows(client: DancrClient, userId: string, month: string) {
  const dancer = await getDancerForUser(client, userId);
  const { data, error } = await (client as any).from("commission_events")
    .select("id, status, amount_cents, gross_commission_cents, dancer_share_bps, created_at, paid_at, venues(name), club_deals(deal_title)")
    .eq("dancer_id", dancer.id).eq("commission_month", `${month}-01`).order("created_at", { ascending: true }).limit(MAX_FINANCE_ROWS);
  if (error) throw error;
  return { owner: dancer.stage_name, month, rows: data || [] };
}

export function venueStatementCsv(statement: Awaited<ReturnType<typeof getVenueStatementRows>>) {
  const header = ["Date", "Venue", "Deal", "Source", "MyDancr referral fee", "Venue payment status", "Venue payment received"];
  const rows = statement.rows.map((row: any) => [
    row.confirmed_at, statement.owner, joined(row.club_deals)?.deal_title || "Club Deal", row.source_type,
    cents(row.gross_commission_cents), row.status, row.venue_payment_received_at || "",
  ]);
  return csv([header, ...rows]);
}

export function dancerStatementCsv(statement: Awaited<ReturnType<typeof getDancerStatementRows>>) {
  const header = ["Date", "Dancer", "Venue", "Deal", "Gross commission", "Dancer rate", "Dancer commission", "Status", "Paid"];
  const rows = statement.rows.map((row: any) => [
    row.created_at, statement.owner, joined(row.venues)?.name || "Venue", joined(row.club_deals)?.deal_title || "Club Deal",
    cents(row.gross_commission_cents), `${Number(row.dancer_share_bps || 0) / 100}%`, cents(row.amount_cents), row.status, row.paid_at || "",
  ]);
  return csv([header, ...rows]);
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function cents(value: unknown) {
  return (Number(value || 0) / 100).toFixed(2);
}

function csv(rows: Array<Array<unknown>>) {
  return `${rows.map((row) => row.map((cell) => {
    const raw = String(cell ?? "");
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n")}\r\n`;
}
