"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import VenueDancerApprovalPanel from "./VenueDancerApprovalPanel";
import VenueMediaReviewPanel from "./VenueMediaReviewPanel";
import "./venue-approvals.css";

const tabs = [["dancers", "New dancers"], ["media", "Media updates"]] as const;
type ApprovalTab = typeof tabs[number][0];

export default function VenueApprovalsPanel({ venueId, active, refreshKey, onCountChange, onCountsChange, selectedTab, onTabChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange?: (count: number) => void;
  onCountsChange?: (counts: { dancers: number; media: number }) => void;
  selectedTab?: ApprovalTab; onTabChange?: (tab: ApprovalTab) => void;
}) {
  const [localTab, setTab] = useState<ApprovalTab>("dancers");
  const tab = selectedTab || localTab;
  const [revision, setRevision] = useState(0);
  const [dancerCount, setDancerCount] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);
  const changed = useCallback(() => setRevision(value => value + 1), []);
  const reviewRefresh = `${refreshKey || ""}:${revision}`;

  useEffect(() => {
    onCountChange?.(dancerCount + mediaCount);
    onCountsChange?.({ dancers: dancerCount, media: mediaCount });
  }, [dancerCount, mediaCount, onCountChange, onCountsChange]);

  function chooseTab(next: ApprovalTab) { setTab(next); onTabChange?.(next); }

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

  return <section id="venue-approvals" className="venue-approvals" aria-labelledby={selectedTab ? undefined : "venue-approvals-title"} aria-label={selectedTab ? tabs.find(([id]) => id === tab)?.[1] : undefined} tabIndex={-1}>
    {!selectedTab && <><h2 id="venue-approvals-title">Approvals</h2>
    <div className="venue-approvals-tabs" role="tablist" aria-label="Approvals">
      {tabs.map(([id, label], index) => <button key={id} id={`venue-approvals-tab-${id}`} type="button" role="tab"
        aria-selected={tab === id} aria-controls={`venue-approvals-panel-${id}`} tabIndex={tab === id ? 0 : -1}
        onClick={() => chooseTab(id)} onKeyDown={event => moveTab(event, index)}>{label}
        {(id === "dancers" ? dancerCount : mediaCount) > 0 && <span className="venue-tab-count">{id === "dancers" ? dancerCount : mediaCount}</span>}
      </button>)}
    </div></>}
    <div id="venue-approvals-panel-dancers" role={selectedTab ? undefined : "tabpanel"} aria-labelledby={selectedTab ? undefined : "venue-approvals-tab-dancers"} hidden={tab !== "dancers"} tabIndex={selectedTab ? undefined : 0}>
      <VenueDancerApprovalPanel venueId={venueId} active={active && tab === "dancers"} refreshKey={reviewRefresh} onDecision={changed} onCountChange={setDancerCount} />
    </div>
    <div id="venue-approvals-panel-media" role={selectedTab ? undefined : "tabpanel"} aria-labelledby={selectedTab ? undefined : "venue-approvals-tab-media"} hidden={tab !== "media"} tabIndex={selectedTab ? undefined : 0}>
      {dancerCount > 0 && <p className="venue-approvals-new-dancers"><button type="button" onClick={() => chooseTab("dancers")}>
        Review {dancerCount} new dancer{dancerCount === 1 ? "" : "s"} &amp; their media →
      </button></p>}
      <VenueMediaReviewPanel venueId={venueId} active={active && tab === "media"} refreshKey={reviewRefresh} onCountChange={setMediaCount} updatesOnly />
    </div>
  </section>;
}
