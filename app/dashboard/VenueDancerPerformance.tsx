"use client";

import { useState } from "react";
import type { DancerPerformance } from "@/src/lib/dancr/venue-analytics";
import {
  DANCER_SCORE_MINIMUMS, DANCER_SCORE_MIN_PEERS, DANCER_SCORE_VERSION, DANCER_SCORE_WEIGHTS, DANCER_SCORE_LABELS, DANCER_SCORE_CATEGORIES,
  scoreVenueDancers, sortScoredDancers, type DancerScoreKey, type DancerScorePeriod, type DancerScoreSort,
} from "@/src/lib/dancr/venue-dancer-scores";

const scoreLabels = DANCER_SCORE_LABELS;
const periodLabels = { tonight: "Tonight", "7d": "7 days", "30d": "30 days", all: "All time" } as const;
const scoreKeys: DancerScoreKey[] = ["overall", ...DANCER_SCORE_CATEGORIES];

export default function VenueDancerPerformance({ dancers, period = "30d" }: { dancers: DancerPerformance[]; period?: DancerScorePeriod }) {
  const [sort, setSort] = useState<DancerScoreSort>("overall");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const scored = scoreVenueDancers(dancers, period);
  const rows = sortScoredDancers(scored, sort).filter(row => row.dancer.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const minimum = DANCER_SCORE_MINIMUMS[period];
  return <section className="venue-performance" aria-labelledby="venue-performance-heading">
    <h3 id="venue-performance-heading">Dancer performance</h3>
    <p className="venue-value-note">{periodLabels[period]} · Private to this club</p>
    <div className="venue-performance-tools">
      <label>Find a dancer<input type="search" value={search} placeholder="Search stage names" onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as DancerScoreSort); setLimit(20); }}>
        {scoreKeys.map(key => <option key={key} value={key}>{scoreLabels[key]} score</option>)}
        <option value="name">Name</option>
      </select></label>
    </div>
    <details className="venue-score-methodology">
      <summary>How scores are calculated</summary>
      <p>Scores update from recorded check-ins, customer activity and normal entry scans. No manager completion or arrival buttons are required. Benchmarks use this club&apos;s full report for the selected period.</p>
      <dl>
        <div><dt>Overall Performance</dt><dd>{DANCER_SCORE_CATEGORIES.map((key, index) => <span key={key}>{index ? " + " : ""}{DANCER_SCORE_WEIGHTS[key]}% {scoreLabels[key]}</span>)}. At least three categories are required. Available weights are rescaled to 100%; missing categories never count as zero. Coverage is shown beneath the score.</dd></div>
        <div><dt>Check-in Activity</dt><dd>Recorded checked-in hours compared with this club&apos;s typical hours. Overlapping sessions are merged. Repeated check-in taps and missing check-outs do not earn extra points or penalties.</dd></div>
        <div><dt>Internal Table Requests</dt><dd>Requests received during recorded presence ÷ recorded checked-in hours, compared with this club&apos;s typical rate. This measures demand. Staff acknowledgements, completions and arrival reports do not change the score.</dd></div>
        <div><dt>VIP Requests</dt><dd>80% relative VIP selections + 20% returning-customer share. Each selected dancer gets one credit per request. Customer withdrawals are excluded, including from repeat history. Staff confirmations, declines and cancellations do not change demand credit.</dd></div>
        <div><dt>Profile Interest</dt><dd>Weighted activity compared with this club&apos;s typical total: profile opens 1; club opens, follows and completed shares 2; directions, transport, offer clicks and &quot;I&apos;m Going&quot; 3. Only activity attributed to this dancer and club counts. Additional views never dilute entry conversion.</dd></div>
        <div><dt>Verified Entry Conversions</dt><dd>100 × redeemed profile passes ÷ profile passes claimed in the selected period. Both counts use the same claim cohort and period end. Normal entry scans record redemption; claims alone do not prove admission. Voided passes are excluded.</dd></div>
        <div><dt>Data confidence</dt><dd>For {periodLabels[period]}: at least {minimum.hours} recorded hours for check-in and table scoring; {minimum.requests} table requests during those hours or VIP selections; {minimum.claims} profile pass claims for conversions; {minimum.actions} actions for profile interest. Relative comparisons need {DANCER_SCORE_MIN_PEERS} qualifying dancers. Missing data stays unscored. Early data remains labelled until hours and actions reach twice their minimum, and requests or claims reach at least 20 and twice their minimum. This is sample coverage, not statistical certainty.</dd></div>
        <div><dt>Benchmarks and rank</dt><dd>Relative points equal 100 × value ÷ (value + the median positive value); a typical positive value scores 50. Overall uses the displayed category scores. Rank requires all five categories past Early data and at least {DANCER_SCORE_MIN_PEERS} comparable dancers. Equal scores share a rank. Partial scores stay unranked; search and sorting do not change benchmarks.</dd></div>
      </dl>
      <p>Only recorded signals are used. Individual table customers, complete profile/card exposure, saved profiles and repeat admissions are not available in this report. Clicks and requests do not prove attendance. These scores do not measure talent, scheduled-shift reliability or revenue. No POS feed is needed.</p>
      <small>Scoring version {DANCER_SCORE_VERSION}</small>
    </details>
    <p className="venue-value-note" role="status">{rows.length.toLocaleString()} {rows.length === 1 ? "dancer" : "dancers"}{search.trim() ? " matching your search" : " with recorded activity"}</p>
    {rows.length ? <ul className="venue-performance-list venue-scored-list">{rows.slice(0, limit).map(row => <li key={row.dancer.id}>
      <div className="venue-score-identity">
        <span className="venue-performance-avatar">{row.dancer.photoUrl
          ? <img src={row.dancer.photoUrl} alt="" width="44" height="44" loading="lazy" />
          : row.dancer.name.slice(0, 1).toUpperCase()}</span>
        <div><span className="venue-performance-name">{row.dancer.name}</span>
          <span className="venue-score-rank" title={row.rank === null ? row.scores.overall.reason || `Ranking needs all five categories past Early data and ${DANCER_SCORE_MIN_PEERS} comparable dancers.` : undefined}>
            {row.rank === null ? "Unranked" : `#${row.rank} of ${row.rankedCount} ranked dancers`}
          </span>
        </div>
      </div>
      <dl className="venue-score-grid">{scoreKeys.map(key => <div key={key} className={`venue-score venue-score-${key}`} title={row.scores[key].reason || undefined}>
        <dt>{scoreLabels[key]}</dt>
        <dd>{row.scores[key].value === null ? <span className="venue-score-missing">Not enough data</span>
          : <><strong>{row.scores[key].value}</strong><span className="venue-score-scale"> / 100</span></>}</dd>
        {row.scores[key].confidence === "early" && <small className="venue-score-confidence">Early data</small>}
        {row.scores[key].evidence && <small className="venue-score-evidence">{row.scores[key].evidence}</small>}
      </div>)}</dl>
    </li>)}</ul> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
