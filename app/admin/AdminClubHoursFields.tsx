"use client";

import { useState } from "react";

export default function AdminClubHoursFields({ opensAt, closesAt, busy }: {
  opensAt: string;
  closesAt: string;
  busy: boolean;
}) {
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/;
  const saved24Hours = clockPattern.test(opensAt) && clockPattern.test(closesAt)
    && opensAt.slice(0, 5) === closesAt.slice(0, 5);
  const [open24Hours, setOpen24Hours] = useState(saved24Hours);
  const [customOpensAt, setCustomOpensAt] = useState(saved24Hours ? "" : opensAt.slice(0, 5));
  const [customClosesAt, setCustomClosesAt] = useState(saved24Hours ? "" : closesAt.slice(0, 5));

  return <>
    <label>Club hours
      <select name="clubHoursMode" value={open24Hours ? "24-hours" : "custom"} disabled={busy}
        onChange={event => setOpen24Hours(event.target.value === "24-hours")}>
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
        onChange={event => setCustomOpensAt(event.target.value)} /></label>
      <label>Closes<input name="closesAt" type="time" value={customClosesAt} readOnly={busy}
        onChange={event => setCustomClosesAt(event.target.value)} /></label>
    </>}
  </>;
}
