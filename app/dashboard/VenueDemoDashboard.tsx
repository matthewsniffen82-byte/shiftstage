"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createVenueDashboardDemo, DEMO_PERIODS, type DemoRecord, type DemoRosterDancer } from "@/src/lib/dancr/venue-dashboard-demo";
import type { VenueDancerAffiliation } from "@/src/lib/dancr/venue-roster";
import { VenueRosterProfileButton } from "../internal/InternalRoster";
import type { RosterStatus } from "../internal/InternalFullProfile";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import VenueTonightOverview from "./VenueTonightOverview";
import VenueValueAnalytics from "./VenueValueAnalytics";
import VenueGridImage from "./VenueGridImage";
import "./venue-workspace.css";
import "./venue-guests.css";
import "./venue-dancer-grid.css";

const workspaces = [["tonight", "Tonight"], ["roster", "Dancers & tables"], ["business", "Results"], ["venue", "Club"]] as const;
const guestTabs = [["venue-guest-list", "Guest list"], ["venue-pickups", "Ride requests"], ["venue-vip", "VIP requests"]] as const;
type Workspace = typeof workspaces[number][0];
type GuestTab = typeof guestTabs[number][0];
const timezone = "America/Los_Angeles";

function DemoDancerIdentity({ dancer, rosterStatus, children }: { dancer: DemoRosterDancer; rosterStatus?: RosterStatus; children?: ReactNode }) {
  const identity = <span className="venue-card-portrait">
    <span className="venue-card-photo" aria-hidden="true"><VenueGridImage src={dancer.photoUrl} /></span>
    <span className="venue-card-caption"><strong>{dancer.name}</strong>{children}</span>
  </span>;
  return dancer.profileDancerId ? <VenueRosterProfileButton dancerId={dancer.profileDancerId} stageName={dancer.name} rosterStatus={rosterStatus} className="ir-profile-link venue-card-profile">{identity}</VenueRosterProfileButton>
    : identity;
}

function DemoRows({ rows, timeLabel = "Received", dancerCards = false }: { rows: DemoRecord[]; timeLabel?: string; dancerCards?: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const visible = rows.filter(row => (status === "all" || row.status === status)
    && `${row.name} ${row.detail}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => dancerCards ? Number(b.status === "Pending") - Number(a.status === "Pending") || Date.parse(b.at) - Date.parse(a.at) : 0);
  return <>
    <div className="venue-performance-tools">
      <label>Search<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>
        {[...new Set(rows.map(row => row.status))].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <p className="venue-value-note" role="status">{visible.length} sample records</p>
    {dancerCards ? <ul className="venue-dancer-grid" aria-label="Table request cards">{visible.map(row => <li className="venue-dancer-card" key={row.id}>
      {row.dancer && <DemoDancerIdentity dancer={row.dancer}><small>{row.tableLabel || row.name}</small><span className="venue-card-status" data-state={row.status.toLowerCase()}>{row.status}</span></DemoDancerIdentity>}
      <details className="venue-card-menu" name="venue-card-details"><summary className="dashboard-menu-trigger" aria-label={`Request details for ${row.name}`} title="Request details"><span className="dashboard-menu-dots" aria-hidden="true">•••</span></summary>
      <div className="venue-card-popover"><div className="venue-card-details"><strong>{row.tableLabel || row.name}</strong><span className="venue-card-status" data-state={row.status.toLowerCase()}>{row.status}</span>
        <small>{row.detail}</small><small>{timeLabel}: <time dateTime={row.at}>{new Date(row.at).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></small>
      </div></div></details>
    </li>)}</ul> : <ul className="venue-demo-records">{visible.map(row => <li key={row.id}><div><strong>{row.name}</strong><span>{row.status}</span></div>
      <p>{row.detail}</p><small>{timeLabel}: <time dateTime={row.at}>{new Date(row.at).toLocaleString(undefined, {
        timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })}</time></small></li>)}</ul>}
    {!visible.length && <p className="venue-value-empty">No sample records match these filters.</p>}
  </>;
}

function SampleList({ rows }: { rows: Array<{ name: string; status: string; detail: string }> }) {
  return <ul className="venue-demo-records">{rows.map(row => <li key={row.name}><div><strong>{row.name}</strong><span>{row.status}</span></div><p>{row.detail}</p></li>)}</ul>;
}

export default function VenueDemoDashboard({ workingNow, affiliations = [], onViewInternal }: { workingNow: Array<Record<string, unknown>>; affiliations?: Array<Record<string, unknown>>; onViewInternal?: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace>("tonight");
  const [guestTab, setGuestTab] = useState<GuestTab>("venue-guest-list");
  const [period, setPeriod] = useState<keyof typeof DEMO_PERIODS>("30d");
  const [snapshot] = useState(() => new Date());
  const [rosterSearch, setRosterSearch] = useState("");
  const [workingOnly, setWorkingOnly] = useState(false);
  const [focusSection, setFocusSection] = useState("");
  const photos = useMemo(() => [
    ...(affiliations as VenueDancerAffiliation[]).flatMap(row => row.canViewProfile && row.dancer?.stageName
      ? [{ name: row.dancer.stageName, url: row.dancer.avatarUrl || "", dancerId: row.dancerId || row.dancer.id }] : []),
    ...workingNow.flatMap(row => typeof row.stageName === "string"
      ? [{ name: row.stageName, url: typeof row.avatarUrl === "string" ? row.avatarUrl : "", dancerId: typeof row.dancerId === "string" ? row.dancerId : undefined }] : []),
  ], [workingNow, affiliations]);
  const data = useMemo(() => createVenueDashboardDemo(period, snapshot, photos), [period, snapshot, photos]);
  const working = data.roster.filter(row => row.working);
  const roster = data.roster.filter(row => (!workingOnly || row.working) && row.name.toLowerCase().includes(rosterSearch.trim().toLowerCase()));
  const guestRows = { "venue-guest-list": data.guestList, "venue-pickups": data.rides, "venue-vip": data.vip };

  useEffect(() => {
    if (!focusSection) return;
    const panel = document.getElementById(focusSection);
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: "start" });
    setFocusSection("");
  }, [focusSection, workspace, guestTab]);

  function openSection(event: MouseEvent<HTMLElement>, id: string) {
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
    <nav className="venue-workspace-tabs" role="tablist" aria-label="Club workspace">
      {workspaces.map(([id, label]) => <button key={id} type="button" role="tab" id={`demo-${id}-tab`} aria-controls={`demo-${id}`}
        aria-selected={workspace === id} tabIndex={workspace === id ? 0 : -1} className={workspace === id ? "active" : ""}
        onClick={() => setWorkspace(id)} onKeyDown={event => moveTab(event, workspaces.map(([key]) => key), id, value => setWorkspace(value as Workspace), "demo")}>
        <VenueDashboardIcon section={id === "business" ? "analytics" : id} /><strong>{label}</strong>
      </button>)}
    </nav>
    {workspace === "business" && <div className="venue-analytics-period" role="group" aria-label="Analytics period">
      {Object.entries(DEMO_PERIODS).map(([id, label]) => <button key={id} type="button" className={period === id ? "active" : ""}
        aria-pressed={period === id} onClick={() => setPeriod(id as keyof typeof DEMO_PERIODS)}>{label}</button>)}
    </div>}
    </div>
    <section id="demo-tonight" role="tabpanel" aria-labelledby="demo-tonight-tab" hidden={workspace !== "tonight"}>
      <VenueTonightOverview operations={data.operations} error="" working={working.length} manager published reviewReady={false} onOpen={openSection} />
      <div className="venue-guests-tabs" role="tablist" aria-label="Guest information">
        {guestTabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`demo-${id}-tab`} aria-controls={id}
          aria-selected={guestTab === id} tabIndex={guestTab === id ? 0 : -1} onClick={() => setGuestTab(id)}
          onKeyDown={event => moveTab(event, guestTabs.map(([key]) => key), id, value => setGuestTab(value as GuestTab), "demo")}><span className="venue-guest-tab-label">{label}</span></button>)}
      </div>
      {guestTabs.map(([id, label]) => <section key={id} id={id} role="tabpanel" aria-labelledby={`demo-${id}-tab`} hidden={guestTab !== id} tabIndex={-1}>
        <h2>{label}</h2><DemoRows rows={guestRows[id]} timeLabel={id === "venue-vip" ? "Visit" : "Received"} />
      </section>)}
    </section>
    <section id="demo-roster" role="tabpanel" aria-labelledby="demo-roster-tab" hidden={workspace !== "roster"}>
      {onViewInternal && <div className="venue-demo-internal-tools"><button type="button" onClick={onViewInternal} title="View your club’s internal roster (leaves demo)">View internal</button><small>Recorded data</small></div>}
      <section id="venue-dancer-roster" className="venue-card-region" tabIndex={-1}><h2>Dancers</h2>
        <div className="venue-performance-tools"><label>Find a dancer<input type="search" value={rosterSearch} onChange={event => setRosterSearch(event.target.value)} /></label>
          <label>Roster<select value={workingOnly ? "working" : "all"} onChange={event => setWorkingOnly(event.target.value === "working")}><option value="all">All affiliated dancers</option><option value="working">Working now</option></select></label></div>
        <ul className="venue-dancer-grid" aria-label="Dancer roster cards">{roster.map(row => <li className="venue-dancer-card" key={row.id}><DemoDancerIdentity dancer={row} rosterStatus={row.working ? "Internal + External" : "Affiliated"}>
          <small>{row.working ? "Internal + External" : "Affiliated"}</small>
          <span className="venue-card-status" data-state={row.working ? "working" : "inactive"}>{row.working ? "● Working now" : "Not working now"}</span>
        </DemoDancerIdentity>
        </li>)}</ul>
        {!roster.length && <p>No sample dancers match these filters.</p>}
      </section>
      <section id="table-requests" className="venue-card-region" tabIndex={-1}><h2>Recent table requests</h2><DemoRows rows={data.tables} dancerCards /></section>
      <details id="venue-nfc-tags" tabIndex={-1}><summary>Dancer Check-In Tags</summary><SampleList rows={[
        { name: "Dancer Check-In Tag", status: "Active", detail: "Sample check-in tag · 128 check-in taps · Last used 10 minutes ago" },
        { name: "Front desk", status: "Active", detail: "Sample sticker · 84 pass scans · Last used 5 minutes ago" },
      ]} /></details>
    </section>
    <section id="demo-business" role="tabpanel" aria-labelledby="demo-business-tab" hidden={workspace !== "business"}>
      <h2>Results</h2>
      <VenueValueAnalytics report={data.report} period={period} periodStart={data.periodStart} periodEnd={data.periodEnd}
        timezone={timezone} totalFollowers={data.totalFollowers} conversion={data.conversion} />
    </section>
    <section id="demo-venue" role="tabpanel" aria-labelledby="demo-venue-tab" hidden={workspace !== "venue"}>
      <nav className="venue-maintenance-links" aria-label="Club maintenance">
        {([["venue-publication", "Club page & deal"], ["venue-customers", "Contacts & marketing"], ["venue-team", "Team"], ["venue-nfc-tags", "QR codes & check-in tags"], ["venue-account", "Account & help"]] as const).map(([id, label]) => <button key={id} type="button" onClick={event => openSection(event, id)}>{label}</button>)}
      </nav>
      <section id="venue-publication" tabIndex={-1}><h2>Club page &amp; deals</h2><div className="venue-demo-brand"><img src="/venue-logos/fictional/echo-house.svg" alt="Echo House" width="72" height="72" />
        <div><strong>Echo House</strong><p>Las Vegas, NV · 8:00 PM - 4:00 AM</p><small>Sample published club · Active subscription</small></div></div>
      <details id="venue-club-deals" tabIndex={-1}><summary>Club Deals</summary><SampleList rows={data.deals} /></details></section>
      <details id="venue-customers" tabIndex={-1}><summary>Contacts &amp; marketing</summary><DemoRows rows={data.contacts} timeLabel="Last activity" /><p>Offers and campaign tools appear here for your club.</p></details>
      <details id="venue-tv" tabIndex={-1}><summary>MyDancr TV</summary><SampleList rows={data.report.videos.map(video => ({ name: video.caption, status: "Approved", detail: `${video.dancer} · Confirmed club tag · Sample video activity in Results` }))} /></details>
      <details id="venue-team" tabIndex={-1}><summary>Team &amp; activity</summary><SampleList rows={data.team} /><h3>Recent activity</h3>
        <SampleList rows={[{ name: "Sample manager", status: "Today", detail: "Marked table request complete" }, { name: "Sample host", status: "Today", detail: "Recorded guest admission" }]} /></details>
      <details id="venue-account" tabIndex={-1}><summary>Account &amp; support</summary><h3>Account details</h3>
        <SampleList rows={[{ name: "Echo House demo owner", status: "Active", detail: "owner@example.invalid · Club owner" }]} />
        <h3>Notifications</h3><ul className="venue-demo-records">{data.notifications.map(note => <li key={note}>{note}</li>)}</ul>
        <h3>Notification settings</h3><SampleList rows={[{ name: "Guest and table requests", status: "Enabled", detail: "In-app and email · Sample preferences" },
          { name: "VIP and ride requests", status: "Enabled", detail: "In-app and email · Sample preferences" }]} />
        <h3>Support</h3><SampleList rows={data.support} />
        <h3>Club participation</h3><p>Active · Sample subscription in good standing.</p>
      </details>
    </section>
  </div>;
}
