import { isVenueWeeklyHours, legacyVenueWeek, weeklyVenueStatus, type VenueWeeklyHours } from "./venue-weekly-hours.ts";

type VenueHours = { opensAt?: string | null; closesAt?: string | null; timezone?: string | null; openDays?: number[] | null; weeklyHours?: VenueWeeklyHours | null };

export function venueOperatingStatus(venue: VenueHours, now = new Date()) {
  const unknown = { state: "unknown", label: "Hours unavailable", cardLabel: "Hours unavailable", cardHoursLabel: "" };
  const minutes = (time?: string | null) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(time || "");
    if (!match || +match[1] > 23 || +match[2] > 59) return null;
    return +match[1] * 60 + +match[2];
  };
  const start = minutes(venue.opensAt), end = minutes(venue.closesAt);
  if ((!isVenueWeeklyHours(venue.weeklyHours) && (start === null || end === null)) || !venue.timezone) return unknown;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: venue.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const current = Number(parts.find(part => part.type === "hour")?.value) * 60 + Number(parts.find(part => part.type === "minute")?.value);
    const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find(part => part.type === "weekday")?.value || "");
    if (isVenueWeeklyHours(venue.weeklyHours)) return weeklyVenueStatus(venue.weeklyHours, today, current);
    if (start === null || end === null) return unknown;
    const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    return weeklyVenueStatus(legacyVenueWeek(clock(start), clock(end), venue.openDays ?? undefined), today, current);
  } catch {
    return unknown;
  }
}
