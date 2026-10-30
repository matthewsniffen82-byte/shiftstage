export type VenueDayHours = { mode: "closed" | "24-hours" | "custom"; opensAt?: string; closesAt?: string };
/** Sunday = 0 through Saturday = 6. Overnight hours belong to their opening day. */
export type VenueWeeklyHours = VenueDayHours[];

export function isVenueWeeklyHours(value: unknown): value is VenueWeeklyHours {
  return Array.isArray(value) && value.length === 7 && value.every(day => {
    if (!day || typeof day !== "object" || Array.isArray(day)) return false;
    if (day.mode === "closed" || day.mode === "24-hours") return Object.keys(day).length === 1;
    return day.mode === "custom" && Object.keys(day).length === 3
      && typeof day.opensAt === "string" && typeof day.closesAt === "string"
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.opensAt)
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.closesAt)
      && day.opensAt !== day.closesAt;
  });
}

export function legacyVenueWeek(opensAt: string, closesAt: string, openDays = [0, 1, 2, 3, 4, 5, 6]): VenueWeeklyHours {
  const start = opensAt.slice(0, 5), end = closesAt.slice(0, 5);
  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return Array.from({ length: 7 }, (_, day) => !openDays.includes(day) || !valid.test(start) || !valid.test(end)
    ? { mode: "closed" } : start === end ? { mode: "24-hours" } : { mode: "custom", opensAt: start, closesAt: end });
}

export function legacyHoursFromWeek(week: VenueWeeklyHours) {
  const openDays = week.flatMap((day, index) => day.mode === "closed" ? [] : [index]);
  const first = week[openDays[0]];
  return { opensAt: first?.mode === "24-hours" ? "00:00" : first?.opensAt || "",
    closesAt: first?.mode === "24-hours" ? "00:00" : first?.closesAt || "", openDays: openDays.join(",") };
}

export function weeklyVenueStatus(week: VenueWeeklyHours, today: number, current: number) {
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const activeToday = week[today], yesterday = (today + 6) % 7, previous = week[yesterday];
  const todayOpen = activeToday.mode === "24-hours" || (activeToday.mode === "custom"
    && current >= minutes(activeToday.opensAt!)
    && (minutes(activeToday.closesAt!) < minutes(activeToday.opensAt!) || current < minutes(activeToday.closesAt!)));
  const overnight = previous.mode === "custom" && minutes(previous.closesAt!) < minutes(previous.opensAt!)
    && current < minutes(previous.closesAt!);
  const displayDay = !todayOpen && overnight ? yesterday : today;
  const sameEveryDay = week.every(day => day.mode === week[0].mode && day.opensAt === week[0].opensAt && day.closesAt === week[0].closesAt);
  return { state: todayOpen || overnight ? "open" : "closed", label: todayOpen || overnight ? "Open" : "Closed",
    hoursLabel: `${sameEveryDay ? "" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][displayDay] + " · "}${formatVenueDayHours(week[displayDay])}` };
}

export function formatVenueDayHours(day: VenueDayHours): string {
  const clock = (time: string) => {
    const hour = Number(time.slice(0, 2));
    return `${hour % 12 || 12}:${time.slice(3)} ${hour < 12 ? "AM" : "PM"}`;
  };
  return day.mode === "closed" ? "Closed" : day.mode === "24-hours" ? "24 hours" : `${clock(day.opensAt!)} – ${clock(day.closesAt!)}`;
}

export function formatWeeklyVenueHours(value: unknown): string | null {
  if (!isVenueWeeklyHours(value)) return null;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const groups: { first: number; last: number; hours: string }[] = [];
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const hours = formatVenueDayHours(value[day]), previous = groups.at(-1);
    if (previous?.hours === hours) previous.last = day;
    else groups.push({ first: day, last: day, hours });
  }
  return groups.length === 1 ? groups[0].hours : groups.map(group =>
    `${names[group.first]}${group.first === group.last ? "" : "–" + names[group.last]}: ${group.hours}`).join("; ");
}
