"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AdminPilotAnalytics } from "@/src/lib/dancr/pilot-analytics";
import { readAdminAccessToken as readAdminToken } from "./admin-session";

type VenueRecord = Record<string, unknown>;

export default function AdminPilotAnalytics({
  venues,
  onActionConfirmed,
}: {
  venues: VenueRecord[];
  onActionConfirmed: (message: string) => void;
}) {
  const availableVenues = useMemo(
    () => venues.filter((venue) => Boolean(venue.id) && venue.is_active !== false),
    [venues],
  );
  const initialRange = useMemo(() => defaultPilotRange(), []);
  const [venueId, setVenueId] = useState("");
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [analytics, setAnalytics] = useState<AdminPilotAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(initialRange.endDate);
  const [doorCount, setDoorCount] = useState("");
  const [pilotCost, setPilotCost] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!availableVenues.length) {
      setVenueId("");
      return;
    }
    if (!availableVenues.some((venue) => String(venue.id) === venueId)) {
      setVenueId(String(availableVenues[0].id));
    }
  }, [availableVenues, venueId]);

  const loadAnalytics = useCallback(async (signal?: AbortSignal) => {
    if (!venueId) return;
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ venueId, startDate, endDate });
      const data = await pilotJson(`/api/admin/pilot-analytics?${params}`, { signal });
      setAnalytics(data.analytics || null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setAnalytics(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load pilot analytics.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [endDate, startDate, venueId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAnalytics(controller.signal);
    return () => controller.abort();
  }, [loadAnalytics]);

  useEffect(() => {
    const report = analytics?.daily.find((day) => day.serviceDate === reportDate);
    setDoorCount(report?.totalDoorCount == null ? "" : String(report.totalDoorCount));
    setPilotCost(report?.pilotCostCents == null ? "0.00" : (report.pilotCostCents / 100).toFixed(2));
    setNotes(report?.notes || "");
  }, [analytics, reportDate]);

  async function saveNightReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venueId) return;
    const totalDoorCount = Number(doorCount);
    const pilotCostCents = Math.round(Number(pilotCost) * 100);
    if (!Number.isInteger(totalDoorCount) || totalDoorCount < 0) {
      setError("Enter the venue's full nightly door count as a whole number.");
      return;
    }
    if (!Number.isFinite(pilotCostCents) || pilotCostCents < 0) {
      setError("Enter a valid non-negative pilot cost.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await pilotJson("/api/admin/pilot-analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, serviceDate: reportDate, totalDoorCount, pilotCostCents, notes }),
      });
      await loadAnalytics();
      onActionConfirmed(`Pilot totals saved for ${formatServiceDate(reportDate)}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save nightly pilot totals.");
    } finally {
      setIsSaving(false);
    }
  }

  function downloadCsv() {
    if (!analytics) return;
    const header = [
      "Service date", "Verified arrivals", "Deal selections", "Venue visitors", "Directions",
      "Deal saves", "Deal shares", "Total door count", "Attributable door share", "Pilot cost", "Notes",
    ];
    const rows = analytics.daily.map((day) => [
      day.serviceDate,
      day.verifiedArrivals,
      day.dealSelections,
      day.venueVisitors,
      day.directionRequests,
      day.dealSaves,
      day.dealShares,
      day.totalDoorCount ?? "",
      day.attributableDoorSharePercent == null ? "" : `${day.attributableDoorSharePercent}%`,
      day.pilotCostCents == null ? "" : (day.pilotCostCents / 100).toFixed(2),
      day.notes || "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(analytics.venue.name)}-pilot-${analytics.range.startDate}-${analytics.range.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const reportingCoverage = analytics
    ? `${analytics.range.reportedNightCount} of ${analytics.range.serviceDateCount}`
    : "—";

  return (
    <section className="pilot-workspace" aria-busy={isLoading || undefined}>
      <style>{pilotStyles}</style>
      <header className="pilot-lead">
        <div>
          <span className="eyebrow">Proof of arrival</span>
          <h2>Venue pilot analytics</h2>
          <p>Measure how discovery turns into verified door traffic using successful cashier NFC taps—not clicks or estimates.</p>
        </div>
        <button type="button" className="pilot-export" onClick={downloadCsv} disabled={!analytics}>Download CSV</button>
      </header>

      <div className="pilot-filters" aria-label="Pilot analytics filters">
        <label>
          <span>Pilot venue</span>
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={!availableVenues.length}>
            {!availableVenues.length ? <option value="">No active venues available</option> : null}
            {availableVenues.map((venue) => (
              <option key={String(venue.id)} value={String(venue.id)}>
                {String(venue.name || "Venue")} · {String(venue.city || "City")}{venue.state ? `, ${String(venue.state)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Start date</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} max={endDate} />
        </label>
        <label>
          <span>End date</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} min={startDate} />
        </label>
        <button type="button" onClick={() => void loadAnalytics()} disabled={isLoading || !venueId}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <div className="pilot-error" role="alert">{error}</div> : null}
      {!availableVenues.length ? (
        <div className="pilot-empty"><strong>Add or activate the pilot venue first.</strong><p>The pilot workspace only reports against real venues in the venue directory.</p></div>
      ) : null}
      {isLoading && !analytics ? <PilotLoading /> : null}
      {!isLoading && availableVenues.length && !analytics && !error ? (
        <div className="pilot-empty"><strong>No pilot analytics returned.</strong><p>Refresh after selecting a venue and valid date range.</p></div>
      ) : null}

      {analytics ? (
        <>
          <div className="pilot-context">
            <div>
              <strong>{analytics.venue.name}</strong>
              <span>{analytics.venue.city}{analytics.venue.state ? `, ${analytics.venue.state}` : ""} · {analytics.venue.timezone}</span>
            </div>
            <small>Updated {formatTimestamp(analytics.checkedAt)}</small>
          </div>

          <div className="pilot-kpis">
            <PilotKpi
              primary
              label="Verified arrivals"
              value={analytics.totals.verifiedArrivals.toLocaleString()}
              detail="Unique guest/session cashier NFC taps per service night"
            />
            <PilotKpi
              label="Attributable door share"
              value={formatRate(analytics.rates.attributableDoorSharePercent)}
              detail={analytics.range.reportedNightCount ? `${analytics.totals.arrivalsOnReportedNights} of ${analytics.totals.totalDoorCount.toLocaleString()} reported guests` : "Add nightly door totals to calculate"}
            />
            <PilotKpi
              label="Selection → arrival"
              value={formatRate(analytics.rates.arrivalConversionPercent)}
              detail={`${analytics.totals.verifiedArrivals} verified from ${analytics.totals.dealSelections} unique nightly selections`}
            />
            <PilotKpi
              label="Cost per verified arrival"
              value={formatMoneyCents(analytics.rates.costPerVerifiedArrivalCents)}
              detail={analytics.range.reportedNightCount ? `${formatMoneyCents(analytics.totals.totalPilotCostCents)} recorded pilot cost` : "Add nightly pilot cost to calculate"}
            />
          </div>

          <div className="pilot-secondary-kpis">
            <PilotMiniKpi label="Unique arriving people" value={analytics.totals.uniqueArrivingCustomers.toLocaleString()} />
            <PilotMiniKpi label="Visitor → arrival" value={formatRate(analytics.rates.venueVisitorToArrivalPercent)} />
            <PilotMiniKpi label="Repeat arrival rate" value={formatRate(analytics.rates.repeatArrivalPercent)} />
            <PilotMiniKpi label="Median time to door" value={formatMinutes(analytics.rates.medianSelectionToArrivalMinutes)} />
            <PilotMiniKpi label="Door reports entered" value={reportingCoverage} />
          </div>

          <div className="pilot-layout">
            <article className="pilot-card pilot-funnel-card">
              <header><span className="eyebrow">Guest journey</span><h3>Discovery to the door</h3></header>
              <PilotFunnelRow label="Unique venue visitors" value={analytics.totals.venueVisitors} maximum={Math.max(analytics.totals.venueVisitors, analytics.totals.dealSelections, analytics.totals.verifiedArrivals, 1)} />
              <PilotFunnelRow label="Unique nightly deal selections" value={analytics.totals.dealSelections} maximum={Math.max(analytics.totals.venueVisitors, analytics.totals.dealSelections, analytics.totals.verifiedArrivals, 1)} />
              <PilotFunnelRow label="Verified cashier NFC arrivals" value={analytics.totals.verifiedArrivals} maximum={Math.max(analytics.totals.venueVisitors, analytics.totals.dealSelections, analytics.totals.verifiedArrivals, 1)} verified />
              <div className="pilot-intent-row">
                <span><strong>{analytics.totals.directionRequests}</strong> directions</span>
                <span><strong>{analytics.totals.dealSaves}</strong> saves</span>
                <span><strong>{analytics.totals.dealShares}</strong> shares</span>
              </div>
            </article>

            <article className="pilot-card">
              <header><span className="eyebrow">Attribution</span><h3>What drove arrivals</h3></header>
              <div className="pilot-breakdown">
                {analytics.sourceBreakdown.length ? analytics.sourceBreakdown.map((source) => (
                  <div key={source.source}>
                    <span><strong>{source.label}</strong><small>{source.arrivals} verified arrivals</small></span>
                    <em>{source.sharePercent}%</em>
                  </div>
                )) : <p className="pilot-muted">Source attribution appears after the first verified cashier NFC arrival.</p>}
              </div>
              <div className="pilot-deals">
                <strong>Deals producing arrivals</strong>
                {analytics.dealBreakdown.length ? analytics.dealBreakdown.slice(0, 5).map((deal) => (
                  <div key={deal.dealTitle}><span>{deal.dealTitle}</span><b>{deal.arrivals}</b></div>
                )) : <p className="pilot-muted">No deal has produced a verified arrival in this range yet.</p>}
              </div>
            </article>
          </div>

          <article className="pilot-card pilot-nightly-card">
            <header>
              <div><span className="eyebrow">Night by night</span><h3>Pilot performance</h3></div>
              <small>Service nights roll over at 6:00 AM in the venue timezone.</small>
            </header>
            <div className="pilot-nightly-table" role="table" aria-label="Nightly pilot performance">
              <div className="pilot-nightly-head" role="row">
                <span role="columnheader">Night</span><span role="columnheader">Arrivals</span><span role="columnheader">Selections</span>
                <span role="columnheader">Visitors</span><span role="columnheader">Directions</span><span role="columnheader">Door total</span><span role="columnheader">Share</span>
              </div>
              {[...analytics.daily].reverse().map((day) => (
                <div className="pilot-nightly-row" role="row" key={day.serviceDate}>
                  <span role="cell" data-label="Night"><strong>{formatServiceDate(day.serviceDate)}</strong>{day.notes ? <small>{day.notes}</small> : null}</span>
                  <span role="cell" data-label="Arrivals">{day.verifiedArrivals}</span>
                  <span role="cell" data-label="Selections">{day.dealSelections}</span>
                  <span role="cell" data-label="Visitors">{day.venueVisitors}</span>
                  <span role="cell" data-label="Directions">{day.directionRequests}</span>
                  <span role="cell" data-label="Door total">{day.totalDoorCount == null ? "Not entered" : day.totalDoorCount.toLocaleString()}</span>
                  <span role="cell" data-label="Share">{formatRate(day.attributableDoorSharePercent)}</span>
                </div>
              ))}
            </div>
          </article>

          <div className="pilot-layout pilot-bottom-layout">
            <form className="pilot-card pilot-report-form" onSubmit={saveNightReport}>
              <header><span className="eyebrow">Venue-provided total</span><h3>Record a service night</h3><p>Enter the venue&apos;s full door count. MyDancr matches only verified NFC arrivals from the same service night.</p></header>
              <div className="pilot-form-grid">
                <label><span>Service date</span><input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} min={startDate} max={endDate} required /></label>
                <label><span>Total people through door</span><input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={doorCount} onChange={(event) => setDoorCount(event.target.value)} placeholder="Enter venue total" required /></label>
                <label><span>Pilot cost for this night</span><span className="pilot-money-input"><i>$</i><input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={pilotCost} onChange={(event) => setPilotCost(event.target.value)} required /></span></label>
                <label className="wide"><span>Internal note (optional)</span><textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Event, promotion, weather, or operational context" /></label>
              </div>
              <button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save nightly totals"}</button>
            </form>

            <article className="pilot-card pilot-methodology">
              <header><span className="eyebrow">Measurement rules</span><h3>What counts as proof</h3></header>
              <ol>
                <li><strong>Verified arrival:</strong> the first successful cashier NFC redemption for a guest or anonymous session on a service night.</li>
                <li><strong>Attribution:</strong> the deal selection preserves whether discovery came through a dancer/TV experience or the club experience.</li>
                <li><strong>Deduplication:</strong> repeat taps by the same guest/session on the same service night count once.</li>
                <li><strong>Exclusions:</strong> suspicious and voided redemptions do not count. Review test or staff activity in Deal Activity and mark it suspicious.</li>
                <li><strong>Door share:</strong> verified arrivals divided only by venue door totals entered for matching service nights.</li>
              </ol>
              <p className="pilot-method-note">This proves attributable arrivals, not guest spend. Revenue attribution requires a POS integration or a cashier-entered transaction amount.</p>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}

function PilotKpi({ label, value, detail, primary = false }: { label: string; value: string; detail: string; primary?: boolean }) {
  return <article className={primary ? "pilot-kpi primary" : "pilot-kpi"}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function PilotMiniKpi({ label, value }: { label: string; value: string }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function PilotFunnelRow({ label, value, maximum, verified = false }: { label: string; value: number; maximum: number; verified?: boolean }) {
  const width = value ? Math.max(8, (value / maximum) * 100) : 0;
  return (
    <div className={verified ? "pilot-funnel-row verified" : "pilot-funnel-row"}>
      <span><strong>{label}</strong><b>{value.toLocaleString()}</b></span>
      <i><em style={{ width: `${width}%` }} /></i>
    </div>
  );
}

function PilotLoading() {
  return <div className="pilot-loading" aria-label="Loading pilot analytics"><span /><span /><span /><span /></div>;
}

function defaultPilotRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 13);
  return { startDate: localDate(start), endDate: localDate(end) };
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function pilotJson(path: string, init: RequestInit = {}) {
  const token = readAdminToken();
  if (!token) throw new Error("Admin sign in required.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || "Unable to complete the pilot analytics request.");
  return data;
}

function formatRate(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatMoneyCents(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function formatMinutes(value: number | null) {
  if (value == null) return "—";
  if (value < 60) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`;
  return `${(value / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} hr`;
}

function formatServiceDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue";
}

const pilotStyles = `
  .pilot-workspace { width: 100%; max-width: 1120px; margin: 0 auto 18px; display: grid; gap: 14px; }
  .pilot-lead { display: flex; align-items: end; justify-content: space-between; gap: 18px; padding: 8px 2px 2px; }
  .pilot-lead > div { display: grid; gap: 7px; }
  .pilot-lead h2 { font-size: clamp(25px,5vw,40px); }
  .pilot-export { flex: 0 0 auto; min-height: 42px; padding: 0 14px; color: #f7f2ff; border: 1px solid rgba(148,229,255,.3); background: rgba(148,229,255,.08); }
  .pilot-filters { display: grid; grid-template-columns: minmax(230px,1.6fr) repeat(2,minmax(150px,.7fr)) auto; align-items: end; gap: 10px; padding: 14px; border: 1px solid rgba(255,255,255,.11); border-radius: 16px; background: #0b0b10; }
  .pilot-filters label, .pilot-report-form label { display: grid; gap: 7px; color: #d8cfeb; font-size: 12px; font-weight: 850; }
  .pilot-filters input, .pilot-filters select, .pilot-report-form input, .pilot-report-form textarea { width: 100%; min-height: 46px; border-radius: 11px; background: #15141b; }
  .pilot-filters button { min-height: 46px; padding: 0 17px; }
  .pilot-error { padding: 12px 14px; border: 1px solid rgba(255,120,145,.38); border-radius: 12px; color: #ffd9e0; background: rgba(120,18,43,.3); font-weight: 800; }
  .pilot-empty { display: grid; gap: 6px; min-height: 150px; place-content: center; padding: 24px; text-align: center; border: 1px solid rgba(255,255,255,.11); border-radius: 16px; background: #0b0b10; }
  .pilot-empty strong { font-size: 20px; }
  .pilot-context { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 2px 2px 0; }
  .pilot-context > div { display: grid; gap: 3px; }
  .pilot-context strong { font-size: 21px; }
  .pilot-context span, .pilot-context small { color: #9c90b3; font-size: 12px; }
  .pilot-kpis { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; }
  .pilot-kpi { min-height: 168px; display: grid; align-content: center; gap: 8px; padding: 18px; border: 1px solid rgba(255,255,255,.11); border-radius: 16px; background: #0b0b10; }
  .pilot-kpi.primary { border-color: rgba(50,255,164,.38); background: linear-gradient(145deg,rgba(50,255,164,.1),#0b0b10 60%); box-shadow: inset 4px 0 0 #32ffa4; }
  .pilot-kpi > span { color: #b9accd; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
  .pilot-kpi > strong { color: #fff; font-size: clamp(30px,5vw,46px); line-height: 1; }
  .pilot-kpi.primary > strong { color: #8dffc4; }
  .pilot-kpi > small { color: #8f859f; line-height: 1.35; }
  .pilot-secondary-kpis { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); border: 1px solid rgba(255,255,255,.11); border-radius: 14px; overflow: hidden; background: #0b0b10; }
  .pilot-secondary-kpis article { min-height: 82px; display: grid; align-content: center; gap: 5px; padding: 13px 15px; border-left: 1px solid rgba(255,255,255,.08); }
  .pilot-secondary-kpis article:first-child { border-left: 0; }
  .pilot-secondary-kpis span { color: #9c90b3; font-size: 11px; font-weight: 850; }
  .pilot-secondary-kpis strong { font-size: 21px; }
  .pilot-layout { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; }
  .pilot-card { display: grid; gap: 15px; padding: 18px; border: 1px solid rgba(255,255,255,.11); border-radius: 16px; background: #0b0b10; }
  .pilot-card > header { display: grid; gap: 6px; }
  .pilot-card h3 { margin: 0; color: #fff; font-size: 22px; }
  .pilot-card header p { color: #9c90b3; font-size: 13px; }
  .pilot-funnel-row { display: grid; gap: 7px; }
  .pilot-funnel-row > span { display: flex; justify-content: space-between; gap: 10px; color: #d8cfeb; font-size: 13px; }
  .pilot-funnel-row b { color: #fff; }
  .pilot-funnel-row > i { height: 10px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.06); }
  .pilot-funnel-row > i > em { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#7357ff,#35d8ff); }
  .pilot-funnel-row.verified > span strong, .pilot-funnel-row.verified > span b { color: #8dffc4; }
  .pilot-funnel-row.verified > i > em { background: linear-gradient(90deg,#24c97f,#8dffc4); }
  .pilot-intent-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-top: 5px; }
  .pilot-intent-row span { display: grid; gap: 2px; padding: 10px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; color: #9c90b3; font-size: 11px; background: rgba(255,255,255,.025); }
  .pilot-intent-row strong { color: #fff; font-size: 18px; }
  .pilot-breakdown, .pilot-deals { display: grid; gap: 8px; }
  .pilot-breakdown > div, .pilot-deals > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; background: rgba(255,255,255,.025); }
  .pilot-breakdown span { display: grid; gap: 3px; }
  .pilot-breakdown small { color: #9c90b3; }
  .pilot-breakdown em { flex: 0 0 auto; color: #8dffc4; font-size: 20px; font-style: normal; font-weight: 950; }
  .pilot-deals > strong { margin-top: 3px; color: #d8cfeb; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .pilot-deals span { color: #d8cfeb; }
  .pilot-deals b { color: #94e5ff; }
  .pilot-muted { color: #9c90b3; font-size: 13px; }
  .pilot-nightly-card > header { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
  .pilot-nightly-card > header > div { display: grid; gap: 6px; }
  .pilot-nightly-card > header > small { max-width: 300px; color: #9c90b3; text-align: right; }
  .pilot-nightly-table { display: grid; }
  .pilot-nightly-head, .pilot-nightly-row { display: grid; grid-template-columns: 1.4fr repeat(6,minmax(72px,.7fr)); align-items: center; gap: 9px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
  .pilot-nightly-head { color: #8f859f; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
  .pilot-nightly-row:last-child { border-bottom: 0; }
  .pilot-nightly-row > span { color: #d8cfeb; font-size: 12px; }
  .pilot-nightly-row > span:first-child { display: grid; gap: 3px; }
  .pilot-nightly-row small { color: #70667f; font-size: 10px; }
  .pilot-bottom-layout { align-items: start; }
  .pilot-form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 11px; }
  .pilot-form-grid .wide { grid-column: 1 / -1; }
  .pilot-report-form textarea { min-height: 90px; padding: 11px 12px; resize: vertical; color: #fff; font: inherit; }
  .pilot-report-form > button { min-height: 48px; }
  .pilot-money-input { position: relative; display: flex; align-items: center; }
  .pilot-money-input i { position: absolute; left: 12px; z-index: 1; color: #9c90b3; font-style: normal; }
  .pilot-money-input input { padding-left: 28px; }
  .pilot-methodology ol { margin: 0; padding-left: 20px; display: grid; gap: 10px; color: #b9accd; }
  .pilot-methodology li { padding-left: 3px; line-height: 1.45; }
  .pilot-methodology li strong { color: #f7f2ff; }
  .pilot-method-note { padding: 12px; border: 1px solid rgba(148,229,255,.18); border-radius: 11px; color: #c9ecf7; background: rgba(148,229,255,.055); font-size: 13px; }
  .pilot-loading { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
  .pilot-loading span { min-height: 168px; border-radius: 16px; background: linear-gradient(100deg,rgba(255,255,255,.04),rgba(139,92,246,.12),rgba(255,255,255,.04)); background-size: 240% 100%; animation: pilotPulse 1.3s ease-in-out infinite; }
  @keyframes pilotPulse { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @media (max-width: 860px) {
    .pilot-kpis { grid-template-columns: repeat(2,minmax(0,1fr)); }
    .pilot-filters { grid-template-columns: repeat(2,minmax(0,1fr)); }
    .pilot-filters label:first-child { grid-column: 1 / -1; }
    .pilot-filters button { grid-column: 1 / -1; }
    .pilot-nightly-head { display: none; }
    .pilot-nightly-table { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .pilot-nightly-row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; padding: 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 11px; }
    .pilot-nightly-row > span { display: grid; gap: 3px; }
    .pilot-nightly-row > span::before { content: attr(data-label); color: #70667f; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
    .pilot-nightly-row > span:first-child { grid-column: 1 / -1; }
  }
  @media (max-width: 680px) {
    .pilot-lead, .pilot-nightly-card > header, .pilot-context { align-items: stretch; flex-direction: column; display: flex; }
    .pilot-export { width: 100%; }
    .pilot-filters, .pilot-kpis, .pilot-secondary-kpis, .pilot-layout, .pilot-form-grid, .pilot-nightly-table, .pilot-loading { grid-template-columns: 1fr; }
    .pilot-filters label:first-child, .pilot-filters button, .pilot-form-grid .wide { grid-column: 1; }
    .pilot-kpi { min-height: 142px; }
    .pilot-secondary-kpis article { border-left: 0; border-top: 1px solid rgba(255,255,255,.08); }
    .pilot-secondary-kpis article:first-child { border-top: 0; }
    .pilot-nightly-card > header > small { max-width: none; text-align: left; }
    .pilot-intent-row { grid-template-columns: 1fr; }
    .pilot-card { padding: 14px; }
  }
  @media (prefers-reduced-motion: reduce) { .pilot-loading span { animation: none; } }
`;
