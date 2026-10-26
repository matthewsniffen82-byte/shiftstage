"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import VenueDancerApprovalPanel from "./VenueDancerApprovalPanel";
import VenueMediaReviewPanel from "./VenueMediaReviewPanel";
import "./venue-approvals.css";

const tabs = [["dancers", "New dancers"], ["media", "Media updates"]] as const;
type ApprovalTab = typeof tabs[number][0];

export default function VenueApprovalsPanel({ venueId, active, refreshKey, onCountChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange: (count: number) => void;
}) {
  const [tab, setTab] = useState<ApprovalTab>("dancers");
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision(value => value + 1), []);
  const reviewRefresh = `${refreshKey || ""}:${revision}`;

  useEffect(() => {
    function followLink() {
      if (window.location.hash === "#venue-media-reviews") setTab("media");
      else if (["#venue-dancer-approvals", "#venue-approvals"].includes(window.location.hash)) setTab("dancers");
    }
    followLink();
    window.addEventListener("hashchange", followLink);
    return () => window.removeEventListener("hashchange", followLink);
  }, []);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next][0]);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#venue-approvals-tab-${tabs[next][0]}`)?.focus();
  }

  return <section id="venue-approvals" className="venue-approvals" aria-labelledby="venue-approvals-title" tabIndex={-1}>
    <h2 id="venue-approvals-title">Approvals</h2>
    <div className="venue-approvals-tabs" role="tablist" aria-label="Approvals">
      {tabs.map(([id, label], index) => <button key={id} id={`venue-approvals-tab-${id}`} type="button" role="tab"
        aria-selected={tab === id} aria-controls={`venue-approvals-panel-${id}`} tabIndex={tab === id ? 0 : -1}
        onClick={() => setTab(id)} onKeyDown={event => moveTab(event, index)}>{label}</button>)}
    </div>
    <div id="venue-approvals-panel-dancers" role="tabpanel" aria-labelledby="venue-approvals-tab-dancers" hidden={tab !== "dancers"} tabIndex={0}>
      <VenueDancerApprovalPanel venueId={venueId} active={active && tab === "dancers"} refreshKey={reviewRefresh} onDecision={changed} />
    </div>
    <div id="venue-approvals-panel-media" role="tabpanel" aria-labelledby="venue-approvals-tab-media" hidden={tab !== "media"} tabIndex={0}>
      <VenueMediaReviewPanel venueId={venueId} active={active && tab === "media"} refreshKey={reviewRefresh} onCountChange={onCountChange} updatesOnly />
    </div>
  </section>;
}
