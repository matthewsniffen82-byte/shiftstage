"use client";

import { useState } from "react";
import type { DancerPerformance } from "@/src/lib/dancr/venue-analytics";
import {
  DANCER_SCORE_MIN_PEERS, DANCER_SCORE_VERSION, DANCER_SCORE_WEIGHTS, DANCER_SCORE_LABELS, DANCER_SCORE_CATEGORIES, CHECK_IN_SCORE_WEIGHTS, BOTH_ROSTER_ACTIVITY_BOOST,
  scoreVenueDancers, sortScoredDancers, type DancerScoreKey, type DancerScorePeriod, type DancerScoreSort,
} from "@/src/lib/dancr/venue-dancer-scores";

const scoreLabels = DANCER_SCORE_LABELS;
const compactScoreLabels: Record<DancerScoreKey, string> = {
  overall: "Overall", checkIns: "Check-ins", internal: "Tables", vip: "VIP", profile: "Interest", conversions: "Entries",
};
const periodLabels = { tonight: "Tonight", "7d": "7 days", "30d": "30 days", all: "All time" } as const;
const scoreKeys: DancerScoreKey[] = ["overall", ...DANCER_SCORE_CATEGORIES];

export default function VenueDancerPerformance({ dancers, period = "30d" }: { dancers: DancerPerformance[]; period?: DancerScorePeriod }) {
  const [sort, setSort] = useState<DancerScoreSort>("overall");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const scored = scoreVenueDancers(dancers, period);
  const rows = sortScoredDancers(scored, sort).filter(row => row.dancer.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
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
      <p>Scores are out of 100, based on recorded activity at this club for the selected period.</p>
      <dl>
        <div><dt>Overall Performance</dt><dd>Weighted average of at least three categories. Missing categories are excluded; remaining weights are rescaled.</dd></div>
        <div><dt>Check-in Activity · {DANCER_SCORE_WEIGHTS.checkIns}%</dt><dd>{CHECK_IN_SCORE_WEIGHTS.accuracy}% checkout accuracy + {CHECK_IN_SCORE_WEIGHTS.days}% relative check-in days + {CHECK_IN_SCORE_WEIGHTS.hours}% relative hours. Both-roster time boosts the days-and-hours portion by {BOTH_ROSTER_ACTIVITY_BOOST * 100}%, prorated by time and capped at 50 points. Internal-only and external-only are equal. Every ended visit needs the dancer&apos;s checkout before expiry for that day&apos;s accuracy credit. Active visits wait; staff checkout and expiry earn none. Without ended visits, activity is provisional; three ended days are needed to leave Early data.</dd></div>
        <div><dt>Internal Table Requests · {DANCER_SCORE_WEIGHTS.internal}%</dt><dd>Requests received per checked-in hour, compared with this club&apos;s typical rate.</dd></div>
        <div><dt>VIP Requests · {DANCER_SCORE_WEIGHTS.vip}%</dt><dd>80% relative selections + 20% returning-customer share. Customer withdrawals are excluded.</dd></div>
        <div><dt>Profile Interest · {DANCER_SCORE_WEIGHTS.profile}%</dt><dd>Weighted actions: profile opens 1; club opens, follows and completed shares 2; directions, transport, offer clicks and &quot;I&apos;m Going&quot; 3.</dd></div>
        <div><dt>Verified Entry Conversions · {DANCER_SCORE_WEIGHTS.conversions}%</dt><dd>Percentage of profile passes claimed in this period and redeemed by period end. Voided passes are excluded.</dd></div>
        <div><dt>Benchmarks and rank</dt><dd>Relative scores compare qualifying dancers at this club; typical positive activity earns 50 points. Ranking needs all five categories past Early data and at least {DANCER_SCORE_MIN_PEERS} comparable dancers. Ties share a rank.</dd></div>
      </dl>
      <p>Early data means a small or partial sample. Missing data stays unscored. Staff request-status updates do not affect scores. Clicks and requests do not prove attendance or revenue.</p>
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
      <dl className="venue-score-grid" aria-label="Performance scores out of 100">{scoreKeys.map(key => <div key={key} className={`venue-score venue-score-${key}`} title={row.scores[key].reason || undefined}>
        <dt><abbr title={scoreLabels[key]}>{compactScoreLabels[key]}</abbr></dt>
        <dd>{row.scores[key].value === null ? <span className="venue-score-missing"><span aria-hidden="true">—</span><span className="dashboard-sr-only">Not enough data</span></span>
          : <><strong>{row.scores[key].value}</strong><span className="dashboard-sr-only"> out of 100</span></>}</dd>
        {row.scores[key].confidence === "early" && <small className="venue-score-early">Early</small>}
      </div>)}</dl>
      <details className="venue-score-details">
        <summary>Score details <span>Out of 100</span></summary>
        <dl>{scoreKeys.map(key => <div key={key}>
          <dt>{scoreLabels[key]}</dt>
          <dd>{row.scores[key].confidence === "early" && <span className="venue-score-confidence">Early data</span>}
            {row.scores[key].evidence ? <span className="venue-score-evidence">{row.scores[key].evidence}</span>
              : <span>Not enough data. {row.scores[key].reason}</span>}</dd>
        </div>)}</dl>
      </details>
    </li>)}</ul> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
