"use client";

import { useState } from "react";
import { isVenueWeeklyHours, legacyVenueWeek, legacyHoursFromWeek, type VenueDayHours, type VenueWeeklyHours } from "../../src/lib/dancr/venue-weekly-hours";

export default function AdminClubHoursFields({ opensAt, closesAt, openDays, weeklyHours, weeklyHoursDraft, busy, onHoursChange }: {
  opensAt: string;
  closesAt: string;
  openDays?: number[];
  weeklyHours?: unknown;
  weeklyHoursDraft?: string;
  busy: boolean;
  onHoursChange?: (hours: { opensAt: string; closesAt: string; openDays: string; weeklyHours: string }, form: HTMLFormElement | null) => void;
}) {
  const [week, setWeek] = useState<VenueWeeklyHours>(() => {
    try {
      const draft = weeklyHoursDraft && JSON.parse(weeklyHoursDraft);
      // Incomplete custom times stay in drafts until the admin finishes editing.
      if (Array.isArray(draft) && draft.length === 7 && draft.every(day => day && ["closed", "24-hours", "custom"].includes(day.mode)
        && (day.opensAt === undefined || typeof day.opensAt === "string") && (day.closesAt === undefined || typeof day.closesAt === "string"))) return draft;
    } catch { /* An invalid local draft falls back to the saved schedule. */ }
    return isVenueWeeklyHours(weeklyHours) ? weeklyHours : legacyVenueWeek(opensAt, closesAt, openDays);
  });
  const canonical = (value: VenueWeeklyHours) => value.map(day => day.mode === "custom"
    ? { mode: day.mode, opensAt: day.opensAt || "", closesAt: day.closesAt || "" } : { mode: day.mode });
  const legacy = legacyHoursFromWeek(week);
  function change(day: number, update: Partial<VenueDayHours>, form: HTMLFormElement | null) {
    const next = week.map((hours, index) => index === day ? { ...hours, ...update } : hours);
    setWeek(next);
    onHoursChange?.({ ...legacyHoursFromWeek(next), weeklyHours: JSON.stringify(next) }, form);
  }
  return <fieldset disabled={busy} style={{ gridColumn: "1 / -1", minWidth: 0 }}>
    <legend>Weekly club hours</legend>
    <input type="hidden" name="weeklyHours" value={JSON.stringify(canonical(week))} />
    <input type="hidden" name="opensAt" value={legacy.opensAt} />
    <input type="hidden" name="closesAt" value={legacy.closesAt} />
    <input type="hidden" name="openDays" value={legacy.openDays} />
    <div style={{ display: "grid", gap: 16 }}>
      {[1, 2, 3, 4, 5, 6, 0].map(day => {
        const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
        const hours = week[day];
        return <div key={day} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", alignItems: "end", gap: 8 }}>
          <label>{name}<select name={`clubHoursMode${day}`} value={hours.mode} disabled={busy}
            onChange={event => change(day, { mode: event.target.value as VenueDayHours["mode"] }, event.target.form)}>
            <option value="closed">Closed</option><option value="custom">Custom hours</option><option value="24-hours">24 hours</option>
          </select></label>
          {hours.mode === "custom" && <>
            <label>Opens<input name={`clubHoursOpens${day}`} aria-label={`${name} opens`} type="time" value={hours.opensAt || ""} required readOnly={busy}
              onChange={event => change(day, { opensAt: event.target.value }, event.target.form)} /></label>
            <label>Closes<input name={`clubHoursCloses${day}`} aria-label={`${name} closes`} type="time" value={hours.closesAt || ""} required readOnly={busy}
              onChange={event => change(day, { closesAt: event.target.value }, event.target.form)} /></label>
          </>}
        </div>;
      })}
    </div>
    <small>Closing earlier than opening means the following morning. Choose 24 hours for a full day.</small>
  </fieldset>;
}
