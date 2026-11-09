"use client";
import { useEffect, useState } from "react";
import { dancerVisibilityNotice, type DancerVisibilityInput } from "./dancer-visibility-notice";
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
  const notice = dancerVisibilityNotice(input);
  const inlineBlocked = inline && notice.state === "blocked";
  const inlineVisible = inline && notice.state === "visible";
  let title = notice.title;
  if (inlineVisible) title = "Visible on the public dancer grid";
  if (inlineBlocked) title = input.isIncognito ? "Hidden from the public grid · Incognito is on" : "Hidden from the public grid";
  return <section className="dancer-visibility-notice" data-inline={inline || undefined} data-state={notice.state} aria-label="Profile visibility status">
    <div role="status" aria-live="polite">
      <h3>{title}</h3>
      {!inlineVisible && !inlineBlocked ? <p>{notice.detail}</p> : null}
    </div>
    {notice.reasons.length ? <ul>{notice.reasons.map((reason, index) => <li key={`${reason.href}:${index}`}>
      {inlineBlocked && input.isIncognito && reason.href === "#dancer-visibility" ? null : <span>{reason.text}</span>}
      <a href={reason.href} aria-disabled={disabled || undefined} onClick={event => {
        if (disabled) { event.preventDefault(); return; }
        if (reason.venueId) onSelectClub?.(reason.venueId);
        if (window.location.hash === reason.href) window.dispatchEvent(new Event("hashchange"));
      }}>{reason.action} →</a>
    </li>)}</ul> : null}
  </section>;
}
