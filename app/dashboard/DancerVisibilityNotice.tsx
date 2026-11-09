"use client";
import { useEffect, useState } from "react";
import { dancerVisibilityNotice, workingAudienceNotice, type DancerVisibilityInput } from "./dancer-visibility-notice";
import "./dancer-visibility-notice.css";

export default function DancerVisibilityNotice({ onSelectClub, disabled = false, inline = false, ...input }: DancerVisibilityInput & {
  onSelectClub?: (venueId: string) => void;
  disabled?: boolean;
  inline?: boolean;
}) {
  const [, setClock] = useState(0);
  const until = input.presence?.workingUntil;
  useEffect(() => {
    if (!until || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()) return;
    const timer = window.setTimeout(() => setClock(value => value + 1), Date.parse(until) - Date.now());
    return () => window.clearTimeout(timer);
  }, [until]);
  const now = Date.now();
  const notice = dancerVisibilityNotice(input, now);
  const audience = workingAudienceNotice(input, now);
  const club = input.clubMedia.activeClub;
  let detail: string | null = notice.detail;
  if (audience && (notice.state === "visible" || notice.state === "blocked")) {
    detail = !inline && club ? `Your check-in at ${club.name} is active.` : null;
  }
  return <section className="dancer-visibility-notice" data-inline={inline || undefined} data-state={audience?.state ?? notice.state} aria-label="Profile visibility status">
    <div role="status" aria-live="polite">
      <h3>{audience?.title ?? notice.title}</h3>
      {detail ? <p>{detail}</p> : null}
    </div>
    {notice.reasons.length ? <ul>{notice.reasons.map((reason, index) => <li key={`${reason.href}:${index}`}>
      {audience && input.isIncognito && reason.href === "#dancer-visibility" ? null : <span>{reason.text}</span>}
      <a href={reason.href} aria-disabled={disabled || undefined} onClick={event => {
        if (disabled) { event.preventDefault(); return; }
        if (reason.venueId) onSelectClub?.(reason.venueId);
        if (window.location.hash === reason.href) window.dispatchEvent(new Event("hashchange"));
      }}>{reason.action} →</a>
    </li>)}</ul> : null}
  </section>;
}
