"use client";

import { useState } from "react";
import type { DancerPerformance } from "@/src/lib/dancr/venue-analytics";
import {
  DANCER_SCORE_MINIMUMS, DANCER_SCORE_MIN_PEERS, DANCER_SCORE_VERSION, DANCER_SCORE_WEIGHTS,
  scoreVenueDancers, sortScoredDancers, type DancerScoreKey, type DancerScorePeriod, type DancerScoreSort,
} from "@/src/lib/dancr/venue-dancer-scores";

const scoreLabels = { overall: "Overall", checkIns: "Check-in activity", requests: "Requests", profile: "Profile results" } as const;
const periodLabels = { tonight: "Tonight", "7d": "7 days", "30d": "30 days", all: "All time" } as const;
const scoreKeys: DancerScoreKey[] = ["overall", "checkIns", "requests", "profile"];

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
      <p>Activity scores out of 100, not ratings of talent, reliability or attendance at scheduled shifts. Benchmarks use this club&apos;s full report for the selected period. Scores can change as activity is recorded.</p>
      <dl>
        <div><dt>Overall</dt><dd>{DANCER_SCORE_WEIGHTS.requests}% Requests + {DANCER_SCORE_WEIGHTS.profile}% Profile results + {DANCER_SCORE_WEIGHTS.checkIns}% Check-in activity. All three scores are required.</dd></div>
        <div><dt>Check-in activity</dt><dd>35% verified check-in activity + 65% recorded hours, compared with this club&apos;s typical positive activity. Check-outs and last check-in timestamps do not earn extra points or penalize an ongoing shift.</dd></div>
        <div><dt>Requests</dt><dd>Table activity contributes 70% and VIP activity 30% when both qualify. Table activity is 60% marked-completed share of received requests + 40% requests per verified hour. VIP activity is 70% selections + 30% repeat requesters, compared with this club&apos;s typical positive counts. When only one channel qualifies, that channel supplies the request score.</dd></div>
        <div><dt>Profile results</dt><dd>60% profile-pass conversion rate + 25% redeemed passes per recorded action, compared with this club&apos;s typical positive rate + 15% action mix. The action mix weights profile opens 1, club opens 2, directions and transport 3, and offer clicks and &quot;I&apos;m Going&quot; 4, then divides by four times all recorded actions. Clicks cannot outweigh entry results.</dd></div>
        <div><dt>Enough data</dt><dd>For {periodLabels[period]}: at least {minimum.hours} verified hours for check-in and table scoring; {minimum.requests} table or VIP requests for that channel; {minimum.claims} profile pass claims and {minimum.actions} recorded actions for profile scoring. Each comparison needs {DANCER_SCORE_MIN_PEERS} qualifying dancers. Missing data stays unscored, never zero.</dd></div>
        <div><dt>Benchmarks and rank</dt><dd>A typical positive count or rate scores 50; zero scores zero. Relative points equal 100 × value ÷ (value + the median positive value). Overall uses rounded category scores. Rank compares overall scores at this club in this period, with at least {DANCER_SCORE_MIN_PEERS} fully scored dancers. Equal displayed scores share a rank; search and sorting do not change ranks.</dd></div>
      </dl>
      <p>Only tracked activity is available. Recorded actions are not total profile exposure, and VIP exposure is not tracked. Conversion rate uses passes claimed in the period; redemptions use entry date. Earlier untracked history is not reconstructed. Scores do not confirm visits or sales.</p>
      <small>Scoring version {DANCER_SCORE_VERSION}</small>
    </details>
    <p className="venue-value-note" role="status">{rows.length.toLocaleString()} {rows.length === 1 ? "dancer" : "dancers"}{search.trim() ? " matching your search" : " with recorded activity"}</p>
    {rows.length ? <ul className="venue-performance-list venue-scored-list">{rows.slice(0, limit).map(row => <li key={row.dancer.id}>
      <div className="venue-score-identity">
        <span className="venue-performance-avatar">{row.dancer.photoUrl
          ? <img src={row.dancer.photoUrl} alt="" width="44" height="44" loading="lazy" />
          : row.dancer.name.slice(0, 1).toUpperCase()}</span>
        <div><span className="venue-performance-name">{row.dancer.name}</span>
          <span className="venue-score-rank" title={row.rank === null ? row.scores.overall.reason || `Needs ${DANCER_SCORE_MIN_PEERS} fully scored dancers in this period.` : undefined}>
            {row.rank === null ? "Unranked" : `#${row.rank} of ${row.rankedCount} ranked dancers`}
          </span>
        </div>
      </div>
      <dl className="venue-score-grid">{scoreKeys.map(key => <div key={key} className={`venue-score venue-score-${key}`} title={row.scores[key].reason || undefined}>
        <dt>{scoreLabels[key]}</dt>
        <dd>{row.scores[key].value === null ? <span className="venue-score-missing">Not enough data</span>
          : <><strong>{row.scores[key].value}</strong><span className="venue-score-scale"> / 100</span></>}</dd>
      </div>)}</dl>
    </li>)}</ul> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
