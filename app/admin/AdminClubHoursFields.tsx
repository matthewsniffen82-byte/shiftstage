"use client";

import { useState } from "react";

export default function AdminClubHoursFields({ opensAt, closesAt, openDays = [0, 1, 2, 3, 4, 5, 6], busy, onHoursChange }: {
  opensAt: string;
  closesAt: string;
  openDays?: number[];
  busy: boolean;
  onHoursChange?: (hours: { opensAt: string; closesAt: string; openDays: string }, form: HTMLFormElement | null) => void;
}) {
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/;
  const saved24Hours = clockPattern.test(opensAt) && clockPattern.test(closesAt)
    && opensAt.slice(0, 5) === closesAt.slice(0, 5);
  const [open24Hours, setOpen24Hours] = useState(saved24Hours);
  const [customOpensAt, setCustomOpensAt] = useState(saved24Hours ? "" : opensAt.slice(0, 5));
  const [customClosesAt, setCustomClosesAt] = useState(saved24Hours ? "" : closesAt.slice(0, 5));
  const [selectedDays, setSelectedDays] = useState(openDays);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return <>
    <label>Club hours
      <select name="clubHoursMode" value={open24Hours ? "24-hours" : "custom"} disabled={busy}
        onChange={event => {
          const allDay = event.target.value === "24-hours";
          setOpen24Hours(allDay);
          onHoursChange?.({ opensAt: allDay ? "00:00" : customOpensAt, closesAt: allDay ? "00:00" : customClosesAt, openDays: selectedDays.join(",") }, event.target.form);
        }}>
        <option value="custom">Custom hours</option>
        <option value="24-hours">24 hours</option>
      </select>
    </label>
    {open24Hours ? <>
      {/* Equal midnight times are the existing saved representation of 24-hour opening. */}
      <input type="hidden" name="opensAt" value="00:00" />
      <input type="hidden" name="closesAt" value="00:00" />
    </> : <>
      <label>Opens<input name="opensAt" type="time" value={customOpensAt} readOnly={busy}
        onChange={event => { setCustomOpensAt(event.target.value); onHoursChange?.({ opensAt: event.target.value, closesAt: customClosesAt, openDays: selectedDays.join(",") }, event.target.form); }} /></label>
      <label>Closes<input name="closesAt" type="time" value={customClosesAt} readOnly={busy}
        onChange={event => { setCustomClosesAt(event.target.value); onHoursChange?.({ opensAt: customOpensAt, closesAt: event.target.value, openDays: selectedDays.join(",") }, event.target.form); }} /></label>
    </>}
    <fieldset disabled={busy} style={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <legend>Open days</legend>
      <input type="hidden" name="openDays" value={selectedDays.join(",")} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
        {[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day} style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44 }}>
          <input type="checkbox" name="clubOpenDay" value={day} checked={selectedDays.includes(day)}
            required={day === 1 && selectedDays.length === 0} aria-label={days[day]}
            style={{ width: 20, height: 20, minHeight: 20, margin: 0 }}
            onChange={event => {
              const next = event.target.checked ? [...selectedDays, day].sort((a, b) => a - b) : selectedDays.filter(value => value !== day);
              setSelectedDays(next);
              onHoursChange?.({ opensAt: open24Hours ? "00:00" : customOpensAt, closesAt: open24Hours ? "00:00" : customClosesAt, openDays: next.join(",") }, event.target.form);
            }} />
          {days[day].slice(0, 3)}
        </label>)}
      </div>
      <small>These hours apply to each selected day. Overnight hours end the following morning.</small>
      {!selectedDays.length && <p role="status">Select at least one open day.</p>}
    </fieldset>
  </>;
}
