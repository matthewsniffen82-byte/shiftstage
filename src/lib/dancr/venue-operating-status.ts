type VenueHours = { opensAt?: string | null; closesAt?: string | null; timezone?: string | null; openDays?: number[] | null };

export function venueOperatingStatus(venue: VenueHours, now = new Date()) {
  const minutes = (time?: string | null) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(time || "");
    if (!match || +match[1] > 23 || +match[2] > 59) return null;
    return +match[1] * 60 + +match[2];
  };
  const start = minutes(venue.opensAt), end = minutes(venue.closesAt);
  if (start === null || end === null || !venue.timezone) return { state: "unknown", label: "Hours unavailable" };
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: venue.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const current = Number(parts.find(part => part.type === "hour")?.value) * 60 + Number(parts.find(part => part.type === "minute")?.value);
    const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find(part => part.type === "weekday")?.value || "");
    const openingDay = end < start && current < end ? (today + 6) % 7 : today;
    const onOpenDay = (venue.openDays ?? [0, 1, 2, 3, 4, 5, 6]).includes(openingDay);
    const open = onOpenDay && (end <= start ? current >= start || current < end : current >= start && current < end);
    return { state: open ? "open" : "closed", label: open ? "Open" : "Closed" };
  } catch {
    return { state: "unknown", label: "Hours unavailable" };
  }
}
