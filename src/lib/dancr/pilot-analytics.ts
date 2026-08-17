import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

type PilotRedemptionRow = {
  id: string;
  customer_id?: string | null;
  session_id?: string | null;
  source_type?: string | null;
  status?: string | null;
  generated_at: string;
  redeemed_at?: string | null;
  saved_at?: string | null;
  shared_at?: string | null;
  nfc_tag_id?: string | null;
  suspicious?: boolean | null;
  club_deals?: { deal_title?: string | null } | Array<{ deal_title?: string | null }> | null;
};

type PilotVenueViewRow = {
  id: string;
  viewer_id?: string | null;
  session_id?: string | null;
  occurred_at: string;
};

type PilotDirectionRow = {
  id: string;
  requester_id?: string | null;
  session_id?: string | null;
  requested_at: string;
};

type PilotNightReportRow = {
  id: string;
  service_date: string;
  total_door_count: number;
  pilot_cost_cents: number;
  notes?: string | null;
  updated_at: string;
};

export type PilotDailySummary = {
  serviceDate: string;
  verifiedArrivals: number;
  dealSelections: number;
  venueVisitors: number;
  directionRequests: number;
  dealSaves: number;
  dealShares: number;
  totalDoorCount: number | null;
  pilotCostCents: number | null;
  attributableDoorSharePercent: number | null;
  notes: string | null;
};

export type AdminPilotAnalytics = {
  checkedAt: string;
  venue: {
    id: string;
    name: string;
    city: string;
    state: string | null;
    timezone: string;
  };
  range: {
    startDate: string;
    endDate: string;
    serviceDateCount: number;
    reportedNightCount: number;
  };
  totals: {
    verifiedArrivals: number;
    uniqueArrivingCustomers: number;
    dealSelections: number;
    venueVisitors: number;
    directionRequests: number;
    dealSaves: number;
    dealShares: number;
    totalDoorCount: number;
    arrivalsOnReportedNights: number;
    totalPilotCostCents: number;
  };
  rates: {
    arrivalConversionPercent: number | null;
    venueVisitorToArrivalPercent: number | null;
    attributableDoorSharePercent: number | null;
    costPerVerifiedArrivalCents: number | null;
    repeatArrivalPercent: number | null;
    medianSelectionToArrivalMinutes: number | null;
  };
  sourceBreakdown: Array<{ source: "dancer_profile" | "club_page" | "other"; label: string; arrivals: number; sharePercent: number }>;
  dealBreakdown: Array<{ dealTitle: string; arrivals: number; sharePercent: number }>;
  daily: PilotDailySummary[];
};

export type PilotAnalyticsRows = {
  redemptions: PilotRedemptionRow[];
  venueViews: PilotVenueViewRow[];
  directions: PilotDirectionRow[];
  reports: PilotNightReportRow[];
};

const MAX_RANGE_DAYS = 180;
const NIGHT_ROLLOVER_HOUR = 6;
const PAGE_SIZE = 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validatePilotDateRange(startDate: string, endDate: string) {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    throw new Error("Pilot dates must use YYYY-MM-DD.");
  }

  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const datesAreReal = Number.isFinite(start)
    && Number.isFinite(end)
    && new Date(start).toISOString().slice(0, 10) === startDate
    && new Date(end).toISOString().slice(0, 10) === endDate;
  if (!datesAreReal || end < start) {
    throw new Error("Pilot end date must be on or after the start date.");
  }

  const serviceDateCount = Math.floor((end - start) / 86_400_000) + 1;
  if (serviceDateCount > MAX_RANGE_DAYS) {
    throw new Error(`Pilot reporting is limited to ${MAX_RANGE_DAYS} days at a time.`);
  }
  return { startDate, endDate, serviceDateCount };
}

export async function getAdminPilotAnalytics(
  client: DancrClient,
  venueId: string,
  startDate: string,
  endDate: string,
): Promise<AdminPilotAnalytics> {
  const range = validatePilotDateRange(startDate, endDate);
  const db = client as any;
  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id, name, city, state, timezone")
    .eq("id", venueId)
    .single();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Pilot venue was not found.");

  const broadStart = `${addDays(startDate, -1)}T00:00:00.000Z`;
  const broadEnd = `${addDays(endDate, 2)}T00:00:00.000Z`;
  const [redemptions, venueViews, directions, reports] = await Promise.all([
    readAllPages(() => db
      .from("qr_redemptions")
      .select("id, customer_id, session_id, source_type, status, generated_at, redeemed_at, saved_at, shared_at, nfc_tag_id, suspicious, club_deals(deal_title)")
      .eq("venue_id", venueId)
      .gte("generated_at", broadStart)
      .lt("generated_at", broadEnd)
      .order("generated_at", { ascending: true })),
    readAllPages(() => db
      .from("venue_page_events")
      .select("id, viewer_id, session_id, occurred_at")
      .eq("venue_id", venueId)
      .eq("event_type", "page_view")
      .gte("occurred_at", broadStart)
      .lt("occurred_at", broadEnd)
      .order("occurred_at", { ascending: true })),
    readAllPages(() => db
      .from("direction_requests")
      .select("id, requester_id, session_id, requested_at")
      .eq("venue_id", venueId)
      .gte("requested_at", broadStart)
      .lt("requested_at", broadEnd)
      .order("requested_at", { ascending: true })),
    readAllPages(() => db
      .from("venue_pilot_night_reports")
      .select("id, service_date, total_door_count, pilot_cost_cents, notes, updated_at")
      .eq("venue_id", venueId)
      .gte("service_date", startDate)
      .lte("service_date", endDate)
      .order("service_date", { ascending: true })),
  ]);

  return buildPilotAnalytics({
    venue: {
      id: String(venue.id),
      name: String(venue.name),
      city: String(venue.city),
      state: venue.state ? String(venue.state) : null,
      timezone: String(venue.timezone || "UTC"),
    },
    range,
    rows: { redemptions, venueViews, directions, reports },
  });
}

export function buildPilotAnalytics(input: {
  venue: AdminPilotAnalytics["venue"];
  range: ReturnType<typeof validatePilotDateRange>;
  rows: PilotAnalyticsRows;
  checkedAt?: string;
}): AdminPilotAnalytics {
  const { venue, range, rows } = input;
  const serviceDates = listDates(range.startDate, range.endDate);
  const inRange = (date: string) => date >= range.startDate && date <= range.endDate;
  const dateFor = (timestamp: string) => nightlifeServiceDate(timestamp, venue.timezone);

  const intentsByKey = new Map<string, PilotRedemptionRow>();
  const arrivalsByKey = new Map<string, PilotRedemptionRow>();
  const arrivalDatesByIdentity = new Map<string, Set<string>>();
  const venueVisitorKeys = new Set<string>();
  const directionKeys = new Set<string>();
  const saveKeys = new Set<string>();
  const shareKeys = new Set<string>();

  for (const row of rows.redemptions) {
    if (row.suspicious || row.status === "voided") continue;
    const generatedDate = dateFor(row.generated_at);
    const identity = visitorIdentity(row.customer_id, row.session_id, row.id);
    if (inRange(generatedDate)) {
      const intentKey = `${identity}:${generatedDate}`;
      if (!intentsByKey.has(intentKey)) intentsByKey.set(intentKey, row);
      if (row.saved_at) {
        const savedDate = dateFor(row.saved_at);
        if (inRange(savedDate)) saveKeys.add(`${identity}:${savedDate}`);
      }
      if (row.shared_at) {
        const sharedDate = dateFor(row.shared_at);
        if (inRange(sharedDate)) shareKeys.add(`${identity}:${sharedDate}`);
      }
    }

    if (row.status !== "redeemed" || !row.redeemed_at || !row.nfc_tag_id) continue;
    const arrivalDate = dateFor(row.redeemed_at);
    if (!inRange(arrivalDate)) continue;
    const arrivalKey = `${identity}:${arrivalDate}`;
    const current = arrivalsByKey.get(arrivalKey);
    if (!current || Date.parse(row.redeemed_at) < Date.parse(current.redeemed_at || current.generated_at)) {
      arrivalsByKey.set(arrivalKey, row);
    }
    const dates = arrivalDatesByIdentity.get(identity) || new Set<string>();
    dates.add(arrivalDate);
    arrivalDatesByIdentity.set(identity, dates);
  }

  for (const row of rows.venueViews) {
    const date = dateFor(row.occurred_at);
    if (!inRange(date)) continue;
    venueVisitorKeys.add(`${visitorIdentity(row.viewer_id, row.session_id, row.id)}:${date}`);
  }
  for (const row of rows.directions) {
    const date = dateFor(row.requested_at);
    if (!inRange(date)) continue;
    directionKeys.add(`${visitorIdentity(row.requester_id, row.session_id, row.id)}:${date}`);
  }

  const reportsByDate = new Map(rows.reports.map((report) => [report.service_date, report]));
  const arrivalRows = [...arrivalsByKey.entries()];
  const arrivalsOnReportedNights = arrivalRows.filter(([key]) => reportsByDate.has(key.slice(-10))).length;
  const totalDoorCount = rows.reports.reduce((sum, row) => sum + Number(row.total_door_count || 0), 0);
  const totalPilotCostCents = rows.reports.reduce((sum, row) => sum + Number(row.pilot_cost_cents || 0), 0);
  const repeatCustomers = [...arrivalDatesByIdentity.values()].filter((dates) => dates.size >= 2).length;
  const selectionToArrivalMinutes = arrivalRows
    .map(([, row]) => row.redeemed_at ? Math.max(0, (Date.parse(row.redeemed_at) - Date.parse(row.generated_at)) / 60_000) : null)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const sourceCounts = new Map<string, number>();
  const dealCounts = new Map<string, number>();
  for (const [, row] of arrivalRows) {
    const source = row.source_type === "dancer_profile" || row.source_type === "club_page" ? row.source_type : "other";
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    const relation = Array.isArray(row.club_deals) ? row.club_deals[0] : row.club_deals;
    const dealTitle = relation?.deal_title?.trim() || "Club Deal";
    dealCounts.set(dealTitle, (dealCounts.get(dealTitle) || 0) + 1);
  }

  const daily = serviceDates.map<PilotDailySummary>((serviceDate) => {
    const report = reportsByDate.get(serviceDate);
    const verifiedArrivals = countKeysForDate(arrivalsByKey.keys(), serviceDate);
    const doorCount = report ? Number(report.total_door_count || 0) : null;
    return {
      serviceDate,
      verifiedArrivals,
      dealSelections: countKeysForDate(intentsByKey.keys(), serviceDate),
      venueVisitors: countSetForDate(venueVisitorKeys, serviceDate),
      directionRequests: countSetForDate(directionKeys, serviceDate),
      dealSaves: countSetForDate(saveKeys, serviceDate),
      dealShares: countSetForDate(shareKeys, serviceDate),
      totalDoorCount: doorCount,
      pilotCostCents: report ? Number(report.pilot_cost_cents || 0) : null,
      attributableDoorSharePercent: doorCount && doorCount > 0 ? percentage(verifiedArrivals, doorCount) : null,
      notes: report?.notes || null,
    };
  });

  const verifiedArrivals = arrivalsByKey.size;
  const uniqueArrivingCustomers = arrivalDatesByIdentity.size;
  return {
    checkedAt: input.checkedAt || new Date().toISOString(),
    venue,
    range: { ...range, reportedNightCount: rows.reports.length },
    totals: {
      verifiedArrivals,
      uniqueArrivingCustomers,
      dealSelections: intentsByKey.size,
      venueVisitors: venueVisitorKeys.size,
      directionRequests: directionKeys.size,
      dealSaves: saveKeys.size,
      dealShares: shareKeys.size,
      totalDoorCount,
      arrivalsOnReportedNights,
      totalPilotCostCents,
    },
    rates: {
      arrivalConversionPercent: intentsByKey.size ? percentage(verifiedArrivals, intentsByKey.size) : null,
      venueVisitorToArrivalPercent: venueVisitorKeys.size ? percentage(verifiedArrivals, venueVisitorKeys.size) : null,
      attributableDoorSharePercent: totalDoorCount ? percentage(arrivalsOnReportedNights, totalDoorCount) : null,
      costPerVerifiedArrivalCents: arrivalsOnReportedNights ? Math.round(totalPilotCostCents / arrivalsOnReportedNights) : null,
      repeatArrivalPercent: uniqueArrivingCustomers ? percentage(repeatCustomers, uniqueArrivingCustomers) : null,
      medianSelectionToArrivalMinutes: median(selectionToArrivalMinutes),
    },
    sourceBreakdown: [...sourceCounts.entries()]
      .map(([source, arrivals]) => ({
        source: source as "dancer_profile" | "club_page" | "other",
        label: source === "dancer_profile" ? "Dancer and TV discovery" : source === "club_page" ? "Club discovery" : "Other discovery",
        arrivals,
        sharePercent: percentage(arrivals, verifiedArrivals),
      }))
      .sort((a, b) => b.arrivals - a.arrivals),
    dealBreakdown: [...dealCounts.entries()]
      .map(([dealTitle, arrivals]) => ({ dealTitle, arrivals, sharePercent: percentage(arrivals, verifiedArrivals) }))
      .sort((a, b) => b.arrivals - a.arrivals),
    daily,
  };
}

export async function upsertAdminPilotNightReport(client: DancrClient, adminId: string, input: {
  venueId: string;
  serviceDate: string;
  totalDoorCount: number;
  pilotCostCents: number;
  notes?: string | null;
}) {
  validatePilotDateRange(input.serviceDate, input.serviceDate);
  if (!Number.isInteger(input.totalDoorCount) || input.totalDoorCount < 0 || input.totalDoorCount > 1_000_000) {
    throw new Error("Nightly door count must be a whole number from 0 to 1,000,000.");
  }
  if (!Number.isInteger(input.pilotCostCents) || input.pilotCostCents < 0 || input.pilotCostCents > 100_000_000) {
    throw new Error("Pilot cost must be a valid non-negative amount.");
  }
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 500) throw new Error("Pilot notes are limited to 500 characters.");

  const db = client as any;
  const { data, error } = await db.rpc("upsert_venue_pilot_night_report", {
    p_admin_id: adminId,
    p_venue_id: input.venueId,
    p_service_date: input.serviceDate,
    p_total_door_count: input.totalDoorCount,
    p_pilot_cost_cents: input.pilotCostCents,
    p_notes: notes || "",
  });
  if (error) throw error;
  return data;
}

function nightlifeServiceDate(timestamp: string, timezone: string) {
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) throw new Error("Pilot analytics encountered an invalid event timestamp.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const localDate = `${read("year")}-${read("month")}-${read("day")}`;
  return Number(read("hour")) < NIGHT_ROLLOVER_HOUR ? addDays(localDate, -1) : localDate;
}

function visitorIdentity(userId: string | null | undefined, sessionId: string | null | undefined, fallback: string) {
  return userId ? `user:${userId}` : sessionId ? `session:${sessionId}` : `event:${fallback}`;
}

function listDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function countKeysForDate(keys: IterableIterator<string>, date: string) {
  let count = 0;
  for (const key of keys) if (key.endsWith(`:${date}`)) count += 1;
  return count;
}

function countSetForDate(values: Set<string>, date: string) {
  return countKeysForDate(values.values(), date);
}

function percentage(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

async function readAllPages(queryFactory: () => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryFactory().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
