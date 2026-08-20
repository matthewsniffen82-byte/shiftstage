import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient<any, any, any>;
type EndReason = "manual" | "automatic";

export type DancerShiftUpdate = {
  venue_id?: string;
  timezone?: string;
  status?: "posted" | "cancelled" | "draft";
  shift_date?: string;
  shift_source?: "scheduled";
  starts_at?: string;
  ends_at?: string;
  broadcast_sent_at?: string;
  broadcast_recipients?: number;
};

const DANCER_SHIFT_UPDATE_FIELDS = new Set<keyof DancerShiftUpdate>([
  "venue_id",
  "timezone",
  "status",
  "shift_date",
  "shift_source",
  "starts_at",
  "ends_at",
  "broadcast_sent_at",
  "broadcast_recipients",
]);

export async function createScheduledDancerShift(
  client: DancrClient,
  input: {
    dancerId: string;
    venueId: string;
    shiftDate: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
  },
) {
  const { data, error } = await (client as any)
    .from("shifts")
    .insert({
      dancer_id: input.dancerId,
      venue_id: input.venueId,
      shift_date: input.shiftDate,
      shift_source: "scheduled",
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      timezone: input.timezone,
      status: "posted",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

export async function updateOwnedDancerShift(
  client: DancrClient,
  dancerId: string,
  shiftId: string,
  update: DancerShiftUpdate,
) {
  const entries = Object.entries(update);
  if (!entries.length || entries.some(([field]) => !DANCER_SHIFT_UPDATE_FIELDS.has(field as keyof DancerShiftUpdate))) {
    throw new Error("Invalid dancer shift update.");
  }

  const { data, error } = await (client as any)
    .from("shifts")
    .update(Object.fromEntries(entries))
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .neq("shift_source", "demo_locked")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Dancer shift update was not applied.");
  return data;
}

export async function recordDancerShiftBroadcast(
  client: DancrClient,
  dancerId: string,
  shiftId: string,
  recipients: number,
) {
  return updateOwnedDancerShift(client, dancerId, shiftId, {
    broadcast_sent_at: new Date().toISOString(),
    broadcast_recipients: recipients,
  });
}

export async function endDancerShift(
  client: DancrClient,
  dancerId: string,
  shift: Record<string, any>,
  reason: EndReason,
) {
  const endedAt = reason === "automatic" && shift.location_verification_expires_at
    ? new Date(Math.min(Date.now(), new Date(shift.location_verification_expires_at).getTime())).toISOString()
    : new Date().toISOString();
  const shiftSummary = await buildShiftSummary(client, dancerId, shift, endedAt, reason);
  const { data, error } = await (client as any)
    .from("shifts")
    .update({
      checked_out_at: endedAt,
      location_status: "club_confirmed",
      working_status: "ended",
      location_verification_expires_at: endedAt,
      commission_tracking_stopped_at: endedAt,
      ended_at: endedAt,
      ended_reason: reason === "automatic" ? "nfc_window_expired" : "manual",
      shift_summary: shiftSummary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shift.id)
    .eq("dancer_id", dancerId)
    .is("checked_out_at", null)
    .select(shiftStateSelect())
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function reconcileExpiredDancerShifts(
  client: DancrClient,
  dancerId?: string,
  limit = 50,
) {
  let query = (client as any)
    .from("shifts")
    .select(
      "id, dancer_id, starts_at, ends_at, checked_in_at, checked_out_at, location_verification_expires_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at",
    )
    .eq("status", "posted")
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .not("location_verification_expires_at", "is", null)
    .lt("location_verification_expires_at", new Date().toISOString())
    .order("location_verification_expires_at", { ascending: true })
    .limit(Math.max(1, Math.min(100, limit)));
  if (dancerId) query = query.eq("dancer_id", dancerId);

  const { data, error } = await query;
  if (error) throw error;

  const completed = [];
  for (const shift of data || []) {
    const ended = await endDancerShift(client, String(shift.dancer_id), shift, "automatic");
    if (ended) completed.push(ended);
  }
  return completed;
}

export function shiftStateSelect() {
  return "id, checked_in_at, checked_out_at, checkin_distance_feet, checkin_accuracy_meters, last_location_verified_at, location_verification_expires_at, location_status, working_status, commission_tracking_started_at, commission_tracking_stopped_at, ended_at, ended_reason, shift_summary";
}

async function buildShiftSummary(
  client: DancrClient,
  dancerId: string,
  shift: Record<string, any>,
  endedAt: string,
  reason: EndReason,
) {
  const startedAt = shift.checked_in_at || shift.starts_at;
  const [profileViews, qrCodeScans, newFollowers, commissionRows] = await Promise.all([
    countMetricRows(client, "profile_views", "dancer_id", dancerId, "viewed_at", startedAt, endedAt),
    countMetricRows(client, "qr_redemptions", "dancer_id", dancerId, "created_at", startedAt, endedAt),
    countMetricRows(client, "follows", "dancer_id", dancerId, "created_at", startedAt, endedAt),
    getShiftCommissionRows(client, dancerId, startedAt, endedAt),
  ]);
  const hoursWorked = Math.max(0, (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 3_600_000);
  const commissionCents = commissionRows.reduce(
    (sum: number, row: Record<string, unknown>) => sum + Number(row.amount_cents || 0),
    0,
  );

  return {
    reason,
    hoursWorked: `${hoursWorked.toFixed(hoursWorked >= 10 ? 0 : 1)}h`,
    profileViews,
    qrCodeScans,
    estimatedCommissions: formatMoneyFromCents(commissionCents),
    newFollowers,
  };
}

async function countMetricRows(
  client: DancrClient,
  table: string,
  ownerColumn: string,
  ownerId: string,
  timestampColumn: string,
  startedAt: string,
  endedAt: string,
) {
  const { count, error } = await (client as any)
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(ownerColumn, ownerId)
    .gte(timestampColumn, startedAt)
    .lte(timestampColumn, endedAt);
  if (error) throw error;
  return count || 0;
}

async function getShiftCommissionRows(client: DancrClient, dancerId: string, startedAt: string, endedAt: string) {
  const { data, error } = await (client as any)
    .from("commission_events")
    .select("amount_cents")
    .eq("dancer_id", dancerId)
    .in("status", ["pending", "available", "payout_processing", "paid"])
    .gte("created_at", startedAt)
    .lte("created_at", endedAt);
  if (error) throw error;
  return data || [];
}

function formatMoneyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}
