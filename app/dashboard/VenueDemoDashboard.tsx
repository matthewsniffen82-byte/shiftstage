"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createVenueDashboardDemo, DEMO_PERIODS, type DemoRecord } from "@/src/lib/dancr/venue-dashboard-demo";
import type { DancerScorePeriod } from "@/src/lib/dancr/venue-dancer-scores";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import VenueTonightOverview from "./VenueTonightOverview";
import VenueSetupChecklist from "./VenueSetupChecklist";
import VenueValueAnalytics from "./VenueValueAnalytics";
import "./venue-workspace.css";
import "./venue-guests.css";

const workspaces = [["tonight", "Tonight"], ["roster", "Dancers & tables"], ["business", "Results"], ["venue", "Manage venue"]] as const;
const guestTabs = [["venue-guest-list", "Guest list"], ["venue-pickups", "Ride requests"], ["venue-vip", "VIP requests"], ["venue-customers", "Contacts"]] as const;
type Workspace = typeof workspaces[number][0];
type GuestTab = typeof guestTabs[number][0];
const timezone = "America/Los_Angeles";

function DemoRows({ rows, timeLabel = "Received" }: { rows: DemoRecord[]; timeLabel?: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const visible = rows.filter(row => (status === "all" || row.status === status)
    && `${row.name} ${row.detail}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="venue-performance-tools">
      <label>Search<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>
        {[...new Set(rows.map(row => row.status))].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <p className="venue-value-note" role="status">{visible.length} sample records</p>
    <ul className="venue-demo-records">{visible.map(row => <li key={row.id}><div><strong>{row.name}</strong><span>{row.status}</span></div>
      <p>{row.detail}</p><small>{timeLabel}: <time dateTime={row.at}>{new Date(row.at).toLocaleString(undefined, {
        timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })}</time></small></li>)}</ul>
    {!visible.length && <p className="venue-value-empty">No sample records match these filters.</p>}
  </>;
}

function SampleList({ rows }: { rows: Array<{ name: string; status: string; detail: string }> }) {
  return <ul className="venue-demo-records">{rows.map(row => <li key={row.name}><div><strong>{row.name}</strong><span>{row.status}</span></div><p>{row.detail}</p></li>)}</ul>;
}

export default function VenueDemoDashboard({ workingNow }: { workingNow: Array<Record<string, unknown>> }) {
  const [workspace, setWorkspace] = useState<Workspace>("tonight");
  const [guestTab, setGuestTab] = useState<GuestTab>("venue-guest-list");
  const [period, setPeriod] = useState<DancerScorePeriod>("30d");
  const [snapshot] = useState(() => new Date());
  const [rosterSearch, setRosterSearch] = useState("");
  const [workingOnly, setWorkingOnly] = useState(false);
  const [focusSection, setFocusSection] = useState("");
  const photos = useMemo(() => workingNow.flatMap(row => typeof row.stageName === "string" && typeof row.avatarUrl === "string"
    ? [{ name: row.stageName, url: row.avatarUrl }] : []), [workingNow]);
  const data = useMemo(() => createVenueDashboardDemo(period, snapshot, photos), [period, snapshot, photos]);
  const working = data.roster.filter(row => row.working);
  const roster = data.roster.filter(row => (!workingOnly || row.working) && row.name.toLowerCase().includes(rosterSearch.trim().toLowerCase()));
  const guestRows = { "venue-guest-list": data.guestList, "venue-pickups": data.rides, "venue-vip": data.vip, "venue-customers": data.contacts };

  useEffect(() => {
    if (!focusSection) return;
    const panel = document.getElementById(focusSection);
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: "start" });
    setFocusSection("");
  }, [focusSection, workspace, guestTab]);

  function openSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    if (guestTabs.some(([tab]) => tab === id)) { setWorkspace("tonight"); setGuestTab(id as GuestTab); }
    else if (["venue-working-now", "venue-dancer-roster", "table-requests", "venue-nfc-tags"].includes(id)) {
      setWorkspace("roster"); setWorkingOnly(id === "venue-working-now");
    } else setWorkspace("venue");
    setFocusSection(id === "venue-working-now" ? "venue-dancer-roster" : id);
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, ids: readonly string[], id: string, choose: (id: string) => void, prefix: string) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (ids.indexOf(id) + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
    choose(ids[index]); document.getElementById(`${prefix}-${ids[index]}-tab`)?.focus();
  }

  return <div className="venue-demo-workspace">
    <div className="venue-workspace-toolbar">
    <nav className="venue-workspace-tabs" role="tablist" aria-label="Venue workspace">
      {workspaces.map(([id, label]) => <button key={id} type="button" role="tab" id={`demo-${id}-tab`} aria-controls={`demo-${id}`}
        aria-selected={workspace === id} tabIndex={workspace === id ? 0 : -1} className={workspace === id ? "active" : ""}
        onClick={() => setWorkspace(id)} onKeyDown={event => moveTab(event, workspaces.map(([key]) => key), id, value => setWorkspace(value as Workspace), "demo")}>
        <VenueDashboardIcon section={id === "business" ? "analytics" : id} /><strong>{label}</strong>
      </button>)}
    </nav>
    {workspace === "business" && <div className="venue-analytics-period" role="group" aria-label="Analytics period">
      {Object.entries(DEMO_PERIODS).map(([id, label]) => <button key={id} type="button" className={period === id ? "active" : ""}
        aria-pressed={period === id} onClick={() => setPeriod(id as DancerScorePeriod)}>{label}</button>)}
    </div>}
    </div>
    <section id="demo-tonight" role="tabpanel" aria-labelledby="demo-tonight-tab" hidden={workspace !== "tonight"}>
      <VenueTonightOverview operations={data.operations} error="" working={working.length} manager published reviewReady={false} onOpen={openSection} />
      <div className="venue-guests-tabs" role="tablist" aria-label="Guest information">
        {guestTabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`demo-${id}-tab`} aria-controls={id}
          aria-selected={guestTab === id} tabIndex={guestTab === id ? 0 : -1} onClick={() => setGuestTab(id)}
          onKeyDown={event => moveTab(event, guestTabs.map(([key]) => key), id, value => setGuestTab(value as GuestTab), "demo")}>{label}</button>)}
      </div>
      {guestTabs.map(([id, label]) => <section key={id} id={id} role="tabpanel" aria-labelledby={`demo-${id}-tab`} hidden={guestTab !== id} tabIndex={-1}>
        <h2>{label}</h2><DemoRows rows={guestRows[id]} timeLabel={id === "venue-vip" ? "Visit" : id === "venue-customers" ? "Last activity" : "Received"} />
      </section>)}
    </section>
    <section id="demo-roster" role="tabpanel" aria-labelledby="demo-roster-tab" hidden={workspace !== "roster"}>
      <section id="venue-dancer-roster" tabIndex={-1}><h2>Dancers</h2>
        <div className="venue-performance-tools"><label>Find a dancer<input type="search" value={rosterSearch} onChange={event => setRosterSearch(event.target.value)} /></label>
          <label>Roster<select value={workingOnly ? "working" : "all"} onChange={event => setWorkingOnly(event.target.value === "working")}><option value="all">All affiliated dancers</option><option value="working">Working now</option></select></label></div>
        <ul className="venue-demo-roster">{roster.map(row => <li key={row.id}><span className="venue-performance-avatar">{row.photoUrl ? <img src={row.photoUrl} alt="" width="44" height="44" /> : row.name[0]}</span>
          <div><strong>{row.name}</strong><small>{row.working ? "Working now · Internal & public" : "Affiliated · Not working"}</small></div></li>)}</ul>
        {!roster.length && <p>No sample dancers match these filters.</p>}
      </section>
      <section id="table-requests" tabIndex={-1}><h2>Recent table requests</h2><DemoRows rows={data.tables} /></section>
      <details id="venue-nfc-tags" tabIndex={-1}><summary>Check-in stickers</summary><SampleList rows={[
        { name: "Dressing room", status: "Active", detail: "Sample sticker · 128 check-in taps · Last used 10 minutes ago" },
        { name: "Front desk", status: "Active", detail: "Sample sticker · 84 pass scans · Last used 5 minutes ago" },
      ]} /></details>
    </section>
    <section id="demo-business" role="tabpanel" aria-labelledby="demo-business-tab" hidden={workspace !== "business"}>
      <h2>Results</h2>
      <VenueValueAnalytics report={data.report} period={period} periodStart={data.periodStart} periodEnd={data.periodEnd}
        timezone={timezone} totalFollowers={data.totalFollowers} conversion={data.conversion} />
    </section>
    <section id="demo-venue" role="tabpanel" aria-labelledby="demo-venue-tab" hidden={workspace !== "venue"}>
      <VenueSetupChecklist approved offers={2} published operations={data.operations} canTeam onOpen={openSection} />
      <section id="venue-publication" tabIndex={-1}><h2>Club page</h2><div className="venue-demo-brand"><img src="/venue-logos/fictional/echo-house.svg" alt="Echo House" width="72" height="72" />
        <div><strong>Echo House</strong><p>Las Vegas, NV · 8:00 PM - 4:00 AM</p><small>Sample published venue · Active subscription</small></div></div></section>
      <details id="venue-club-deals" tabIndex={-1}><summary>Club Deals</summary><SampleList rows={data.deals} /></details>
      <details id="venue-tv" tabIndex={-1}><summary>MyDancr TV</summary><SampleList rows={data.report.videos.map(video => ({ name: video.caption, status: "Approved", detail: `${video.dancer} · Confirmed venue tag · Sample video activity in Results` }))} /></details>
      <details id="venue-team" tabIndex={-1}><summary>Team &amp; activity</summary><SampleList rows={data.team} /><h3>Recent activity</h3>
        <SampleList rows={[{ name: "Sample manager", status: "Today", detail: "Marked table request complete" }, { name: "Sample host", status: "Today", detail: "Recorded guest admission" }]} /></details>
      <details id="venue-account" tabIndex={-1}><summary>Account &amp; support</summary><h3>Account details</h3>
        <SampleList rows={[{ name: "Echo House demo owner", status: "Active", detail: "owner@example.invalid · Venue owner" }]} />
        <h3>Notifications</h3><ul className="venue-demo-records">{data.notifications.map(note => <li key={note}>{note}</li>)}</ul>
        <h3>Notification settings</h3><SampleList rows={[{ name: "Guest and table requests", status: "Enabled", detail: "In-app and email · Sample preferences" },
          { name: "VIP and ride requests", status: "Enabled", detail: "In-app and email · Sample preferences" }]} />
        <h3>Support</h3><SampleList rows={data.support} />
        <h3>Venue participation</h3><p>Active · Sample subscription in good standing.</p>
      </details>
    </section>
  </div>;
}
