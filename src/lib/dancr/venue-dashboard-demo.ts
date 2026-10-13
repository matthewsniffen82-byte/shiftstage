import type { DancerPerformance, VenuePerformanceCounts, VenueValueReport } from "./venue-analytics";
import type { DancerScorePeriod } from "./venue-dancer-scores";
import type { VenueOperations } from "./venue-operations";
import type { HairColor } from "./hair-color";

// This selects a fictional presentation, never permission to access or write venue data.
export function isVenueDashboardDemo(profile: Record<string, unknown> | null | undefined) {
  // Echo House retains its original database slug after the fictional rebrand.
  return profile?.id === "260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af" && profile.slug === "talk-of-the-town";
}

export const DEMO_PERIODS = { tonight: "Tonight", "7d": "7 days", "30d": "30 days", all: "All time" } as const;
const names = ["Aria", "Aurora", "Autumn", "Ava", "Bailey", "Bianca", "Blair", "Brooke"];
const colors: HairColor[] = ["brown", "red", "black", "brown", "brown", "blonde", "black", "brown"];
export type DemoRecord = { id: string; name: string; status: string; detail: string; at: string; dancer?: DemoRosterDancer };
export type DemoRosterDancer = { id: string; name: string; working: boolean; photoUrl: string | null; profileDancerId: string | null };
const DAY = 86_400_000;

/** Entirely synthetic, deterministic data. No database, notifications, credentials or redeemable tokens. */
export function createVenueDashboardDemo(period: DancerScorePeriod, now: Date, photos: Array<{ name: string; url: string; dancerId?: string }> = []) {
  const end = now.toISOString();
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const trackingStartedAt = new Date(now.getTime() - 180 * DAY).toISOString();
  const factor = { tonight: 1, "7d": 5, "30d": 20, all: 80 }[period];
  const phase = { tonight: 0, "7d": 1, "30d": 2, all: 3 }[period];
  const periodStart = new Date(now.getTime() - ({ tonight: 0.25, "7d": 7, "30d": 30, all: 180 }[period]) * DAY).toISOString();
  const roster: DemoRosterDancer[] = names.map((name, i) => ({ id: `demo-dancer-${i}`, name, working: i < 6,
    photoUrl: photos.find(photo => photo.name === name)?.url || null,
    profileDancerId: photos.find(photo => photo.name === name)?.dancerId || null }));
  const dancers: DancerPerformance[] = roster.map((dancer, i) => {
    const requests = (20 + i) * factor;
    const completed = (16 + (i + phase) % 3 + Math.floor(i / 2)) * factor;
    const claims = (20 + i * 2) * factor;
    const conversions = (8 + (i + phase) % 4 + Math.floor(i / 2)) * factor;
    return { id: dancer.id, name: dancer.name, photoUrl: dancer.photoUrl,
      internal: { checkedInHours: (3 + i * 0.35) * factor, requests, completed,
        requestsDuringHours: requests, pending: i < 2 ? 1 : 0, acknowledged: i === 2 ? 1 : 0,
        cancelled: requests - completed - (i < 3 ? 1 : 0) },
      vip: { requests: (20 + i) * factor, repeatRequesters: (5 - Math.floor(i / 2)) * factor,
        scoringRequests: (20 + i) * factor, scoringUniqueRequesters: (12 + i) * factor,
        scoringRepeatRequesters: (5 - Math.floor(i / 2)) * factor },
      external: { dancer_profile: (32 + i * 5) * factor, club_page: (18 + i) * factor,
        directions: (15 + i) * factor, going: (10 + i) * factor, free_entry: (18 + i * 2) * factor, transport: (8 + i) * factor },
      results: { checkIns: factor, checkOuts: dancer.working ? factor - 1 : factor,
        lastCheckInAt: ago(3 + i * 0.35), lastCheckOutAt: dancer.working ? null : ago(1),
        tableArrived: completed, tableNoShows: factor, tableAttendanceUnrecorded: requests - completed - factor,
        showUpPercent: Math.round(completed / (completed + factor) * 100),
        profileClaims: claims, profileConversions: conversions, profileCohortConversions: conversions,
        profileConversionPercent: Math.round(conversions / claims * 100) },
    };
  });
  const sum = (read: (dancer: DancerPerformance) => number) => dancers.reduce((total, dancer) => total + read(dancer), 0);
  const claims = sum(dancer => dancer.results!.profileClaims) + 16 * factor;
  const admissions = sum(dancer => dancer.results!.profileConversions) + 8 * factor;
  const current = { admissions, claims, directions: sum(dancer => dancer.external.directions),
    going: sum(dancer => dancer.external.going), visitors: 430 * factor, followers: 13 * factor,
    pickups: 9 * factor, passengers: 28 * factor, impressions: 1500 * factor };
  const guestList: DemoRecord[] = Array.from({ length: 12 }, (_, i) => ({ id: `demo-guest-${i}`, name: `Sample guest ${i + 1}`,
    status: i < 8 ? "Awaiting admission" : "Admitted", detail: `${i % 2 ? "Arriving independently" : "Club transportation"} · Free admission`, at: ago((i + 1) / 10) }));
  const rides: DemoRecord[] = ["Received", "Received", "Contacted", "Arranged", "Completed"].map((status, i) => ({ id: `demo-ride-${i}`,
    name: `Sample party ${i + 1}`, status, detail: `${i + 2} passengers · Sample pickup point ${i + 1}`, at: ago((i + 1) / 4) }));
  const vip: DemoRecord[] = ["Pending", "Pending", "Confirmed", "Confirmed", "Declined"].map((status, i) => ({ id: `demo-vip-${i}`,
    name: `Sample VIP ${i + 1}`, status, detail: `${names[i]} and ${names[i + 1]} · Party of ${i + 2} · Nickname: Sample regular ${i + 1}`, at: new Date(now.getTime() + (i + 1) * 1_800_000).toISOString() }));
  const tables: DemoRecord[] = ["Pending", "Pending", "Acknowledged", "Completed", "Completed", "Cancelled"].map((status, i) => ({
    id: `demo-table-${i}`, name: `Table ${i + 1} · ${names[i]}`, dancer: roster[i], status, detail: `Sample table request · ${i + 2} guests`, at: ago((i + 1) / 12) }));
  const contacts: DemoRecord[] = Array.from({ length: 6 }, (_, i) => ({ id: `demo-contact-${i}`, name: `Sample contact ${i + 1}`,
    status: i % 2 ? "Guest list" : "VIP", detail: `guest${i + 1}@example.invalid · Fictional shared contact`, at: ago(i + 1) }));
  const operations: VenueOperations = { vipPending: vip.filter(row => row.status === "Pending").length,
    tablePending: tables.filter(row => row.status === "Pending").length,
    guestExpected: guestList.filter(row => row.status === "Awaiting admission").length,
    admitted: names.reduce((total, _, i) => total + 8 + i % 4 + Math.floor(i / 2), 8),
    ridesOpen: rides.filter(row => ["Received", "Contacted", "Arranged"].includes(row.status)).length,
    teamReady: true, checkInReady: true };
  const performance: VenuePerformanceCounts = { guestList: 16 * factor, vipRequests: sum(dancer => dancer.vip.requests),
    vipPending: 2, vipConfirmed: sum(dancer => dancer.vip.requests) - 3 * factor - 2, vipDeclined: 2 * factor, vipCancelled: factor,
    tableRequests: sum(dancer => dancer.internal.requests!), tablePending: sum(dancer => dancer.internal.pending!),
    tableAcknowledged: sum(dancer => dancer.internal.acknowledged!), tableCompleted: sum(dancer => dancer.internal.completed!),
    tableCancelled: sum(dancer => dancer.internal.cancelled!), vipResponseMinutes: 7, vipResponseSamples: 18 * factor,
    tableResponseMinutes: 3, tableResponseSamples: 40 * factor, tableCompletionMinutes: 19, tableCompletionSamples: 30 * factor };
  const previous = <T extends Record<string, number | null>>(values: T): T => Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value == null ? null : Math.floor(value * 0.8)]),
  ) as T;
  const eventTypes = ["card_impression", "club_page", "directions", "free_entry", "transport", "follow", "unfollow", "share", "share_completed", "dancer_profile", "tv_open", "phone", "website"];
  const sources = ["venue_scroll_card", "venue_detail", "dancer_profile", "tv"];
  const hairRows = (channel: "internal" | "external") => [...new Set(colors)].map(color => {
    const group = dancers.filter((_, i) => colors[i] === color);
    const metrics: Record<string, number> = {};
    for (const dancer of group) for (const [key, value] of Object.entries(dancer[channel])) metrics[key] = (metrics[key] || 0) + (value || 0);
    if (channel === "external") {
      metrics.claims = group.reduce((total, dancer) => total + dancer.results!.profileClaims, 0);
      metrics.admissions = group.reduce((total, dancer) => total + dancer.results!.profileConversions, 0);
    }
    return { color, dancers: group.length, metrics };
  });
  const report: VenueValueReport = { trackingStartedAt, current, previous: previous(current),
    dancers: dancers.map(dancer => ({ id: dancer.id, name: dancer.name, metrics: { ...dancer.external, claims: dancer.results!.profileClaims, admissions: dancer.results!.profileConversions } })),
    interactions: sources.flatMap((source, i) => eventTypes.map((event_type, j) => ({ source, event_type,
      total: (80 - j * 4 - i * 3) * factor, visitors: (55 - j * 3 - i * 2) * factor }))),
    videos: names.slice(0, 4).map((name, i) => ({ id: `demo-video-${i}`, dancer: name, caption: `${name} at Echo House`,
      metrics: { impression: (140 + i * 20) * factor, engaged_view: (95 + i * 10) * factor, completed: (70 + i * 8) * factor,
        share: 6 * factor, venue_click: 12 * factor, profile_click: 18 * factor, going: 8 * factor, directions: 7 * factor,
        free_entry: 8 * factor, transport: 3 * factor, claims: 6 * factor, admissions: 4 * factor } })),
    performance: { trackingStartedAt, resultsStartedAt: trackingStartedAt, dancers,
      current: { ...performance, checkIns: sum(dancer => dancer.results!.checkIns), checkOuts: sum(dancer => dancer.results!.checkOuts),
        profileConversions: sum(dancer => dancer.results!.profileConversions), tableArrived: performance.tableCompleted,
        tableNoShows: 8 * factor, tableAttendanceUnrecorded: performance.tableRequests - performance.tableCompleted - 8 * factor,
        showUpPercent: Math.round(performance.tableCompleted / (performance.tableCompleted + 8 * factor) * 100) },
      previous: previous(performance), tonight: { vipPending: operations.vipPending, vipConfirmed: 2,
        tablePending: operations.tablePending, tableAcknowledged: 1, guestListExpected: operations.guestExpected } },
    hairColor: { trackingStartedAt, internal: hairRows("internal"), external: hairRows("external"),
      currentPhotos: { internal: [...new Set(colors)].map(color => ({ color, state: "ready", dancers: colors.filter(value => value === color).length })),
        external: [...new Set(colors)].map(color => ({ color, state: "ready", dancers: colors.filter(value => value === color).length })) } },
  };
  return { report, period, periodStart, periodEnd: end, roster, operations, guestList, rides, vip, tables, contacts,
    totalFollowers: 2450, conversion: Math.round(admissions / claims * 100),
    deals: [
      { name: "Free admission", status: "Live", detail: "Admission for one guest before midnight. House rules and capacity apply." },
      { name: "Club transport + admission", status: "Live", detail: "Sample club pickup offer. Pickup confirmation required." },
      { name: "Weekend admission", status: "Pending review", detail: "Sample offer request awaiting MyDancr review." },
    ],
    team: [
      { name: "Sample manager", status: "Manager", detail: "manager@example.invalid · Active" },
      { name: "Sample host", status: "Staff", detail: "host@example.invalid · Active" },
      { name: "Sample door staff", status: "Invited", detail: "door@example.invalid · Invitation pending" },
    ],
    notifications: ["Two VIP requests awaiting a response", "New table requests received", "Your sample Club Deal is live"],
    support: [{ name: "Sticker replacement", status: "In progress", detail: "Sample support reply: replacement scheduled." },
      { name: "Club Deal update", status: "Resolved", detail: "Sample support reply: your offer details are updated." }],
  };
}

export type VenueDashboardDemo = ReturnType<typeof createVenueDashboardDemo>;
