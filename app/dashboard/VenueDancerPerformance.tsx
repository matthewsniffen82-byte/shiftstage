"use client";

import { useEffect, useRef, useState } from "react";
import type { DancerPerformance } from "@/src/lib/dancr/venue-analytics";
import { VenueRosterProfileButton } from "../internal/InternalRoster";
import VenueGridImage from "./VenueGridImage";
import "./venue-dancer-grid.css";
import {
  DANCER_SCORE_MIN_PEERS, DANCER_SCORE_VERSION, DANCER_SCORE_WEIGHTS, DANCER_SCORE_LABELS, DANCER_SCORE_CATEGORIES, CHECK_IN_SCORE_WEIGHTS,
  scoreVenueDancers, sortScoredDancers, type DancerScoreKey, type DancerScorePeriod, type DancerScoreSort, type ScoredDancer,
} from "@/src/lib/dancr/venue-dancer-scores";

const scoreLabels = DANCER_SCORE_LABELS;
const compactScoreLabels: Record<DancerScoreKey, string> = {
  overall: "Overall", externalTime: "External time", checkIns: "Check-ins", internal: "Tables", vip: "VIP", profile: "Interest", conversions: "Entries",
};
const periodLabels: Record<DancerScorePeriod, string> = { tonight: "Tonight", "7d": "7 days", "14d": "14 days", "30d": "30 days", all: "All time" };
const scoreKeys: DancerScoreKey[] = ["overall", ...DANCER_SCORE_CATEGORIES];

function renderScores(scores: ScoredDancer["scores"], inline = false) {
  return <dl className={inline ? "venue-score-grid venue-performance-scores" : "venue-score-grid"} aria-label="Performance scores out of 100">{scoreKeys.map(key => <div key={key} className={`venue-score venue-score-${key}`} title={scores[key].reason || undefined}>
    <dt><abbr title={scoreLabels[key]}>{compactScoreLabels[key]}</abbr></dt>
    <dd>{scores[key].value === null ? <span className="venue-score-missing"><span aria-hidden="true">—</span><span className="dashboard-sr-only">Not enough data</span></span>
      : <><strong>{scores[key].value}</strong><span className="dashboard-sr-only"> out of 100</span></>}</dd>
    {scores[key].confidence === "early" && <small className="venue-score-early">Early</small>}
  </div>)}</dl>;
}

export default function VenueDancerPerformance({ dancers, period = "30d" }: { dancers: DancerPerformance[]; period?: DancerScorePeriod }) {
  const [sort, setSort] = useState<DancerScoreSort>("overall");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const [scoreDancerId, setScoreDancerId] = useState<string | null>(null);
  const scoreDialog = useRef<HTMLDialogElement>(null);
  const scored = scoreVenueDancers(dancers, period);
  const selected = scored.find(row => row.dancer.id === scoreDancerId);
  const selectedId = selected?.dancer.id;
  useEffect(() => {
    const dialog = scoreDialog.current;
    if (selectedId && dialog && !dialog.open) dialog.showModal();
    else if (!selectedId && dialog?.open) dialog.close();
  }, [selectedId]);
  const rows = sortScoredDancers(scored, sort).filter(row => row.dancer.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="venue-performance" aria-labelledby="venue-performance-heading">
    <h3 id="venue-performance-heading">Dancer performance</h3>
    <p className="venue-value-note">{periodLabels[period]} · Private to this club</p>
    <div className="venue-performance-tools">
      <label>Find a dancer<input type="search" value={search} placeholder="Search stage names" onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as DancerScoreSort); setLimit(20); }}>
        {scoreKeys.map(key => <option key={key} value={key}>{compactScoreLabels[key]} score</option>)}
        <option value="name">Name</option>
      </select></label>
    </div>
    <details className="venue-score-methodology">
      <summary>How scores are calculated</summary>
      <p>Scores are out of 100, based on recorded activity at this club for the selected period.</p>
      <dl>
        <div><dt>{compactScoreLabels.overall}</dt><dd>Five recorded external minutes can start early placement points at the original category weights. With at least three scored categories, available weights are rescaled. Missing categories stay unscored.</dd></div>
        <div><dt>{compactScoreLabels.externalTime} · {DANCER_SCORE_WEIGHTS.externalTime}%</dt><dd>Largest ranking factor: 100 × external hours ÷ (external hours + 4). Benefits start at five recorded external minutes with no peer minimum. External-only and Both count equally; overlapping time counts once. Known time below five minutes scores zero; unknown history stays unscored.</dd></div>
        <div><dt>{compactScoreLabels.checkIns} · {DANCER_SCORE_WEIGHTS.checkIns}%</dt><dd>{CHECK_IN_SCORE_WEIGHTS.accuracy}% checkout accuracy + {CHECK_IN_SCORE_WEIGHTS.days}% relative check-in days + {CHECK_IN_SCORE_WEIGHTS.hours}% relative hours. Every ended visit needs the dancer&apos;s checkout before expiry for accuracy credit. Staff checkout and expiry earn none. Active visits are provisional; three ended days are needed to leave Early data.</dd></div>
        <div><dt>{compactScoreLabels.internal} · {DANCER_SCORE_WEIGHTS.internal}%</dt><dd>Requests received per checked-in hour, compared with this club&apos;s typical rate.</dd></div>
        <div><dt>{compactScoreLabels.vip} · {DANCER_SCORE_WEIGHTS.vip}%</dt><dd>80% relative selections + 20% returning-customer share. Customer withdrawals are excluded.</dd></div>
        <div><dt>{compactScoreLabels.profile} · {DANCER_SCORE_WEIGHTS.profile}%</dt><dd>Weighted actions: profile opens 1; club opens, follows and completed shares 2; directions, transport, offer clicks and &quot;I&apos;m Going&quot; 3.</dd></div>
        <div><dt>{compactScoreLabels.conversions} · {DANCER_SCORE_WEIGHTS.conversions}%</dt><dd>Percentage of profile passes claimed in this period and redeemed by period end. Voided passes are excluded.</dd></div>
        <div><dt>Benchmarks and rank</dt><dd>Relative scores compare qualifying dancers at this club; typical positive activity earns 50 points. Ranking needs all six categories past Early data and at least {DANCER_SCORE_MIN_PEERS} comparable dancers. Ties share a rank.</dd></div>
      </dl>
      <p>Early data means a small or partial sample. Missing data stays unscored. Staff request-status updates do not affect scores. Clicks and requests do not prove attendance or revenue.</p>
      <small>Scoring version {DANCER_SCORE_VERSION}</small>
    </details>
    <p className="venue-value-note" role="status">{rows.length.toLocaleString()} {rows.length === 1 ? "dancer" : "dancers"}{search.trim() ? " matching your search" : " with recorded activity"}</p>
    {rows.length ? <div className="venue-card-region"><ul className="venue-dancer-grid venue-performance-cards" aria-label="Dancer performance">{rows.slice(0, limit).map((row, index) => {
      const profileId = row.dancer.profileDancerId === undefined ? row.dancer.id : row.dancer.profileDancerId;
      const rank = row.rank === null ? "Unranked" : `#${row.rank} of ${row.rankedCount} ranked dancers`;
      const identity = <span className="venue-card-portrait">
        <span className="venue-card-photo" aria-hidden="true"><VenueGridImage src={row.dancer.photoUrl} srcSet={row.dancer.photoSrcSet || undefined} sizes="(max-width: 620px) 30vw, 320px" lazy={index >= 12} /></span>
        <span className="venue-card-caption">
          <strong>{row.dancer.name}</strong>
        </span>
      </span>;
      return <li key={row.dancer.id}>
        <div className="venue-dancer-card">
          {profileId ? <VenueRosterProfileButton dancerId={profileId} stageName={row.dancer.name} ariaLabel={`${row.dancer.name}: Open profile`} performanceScore={{ value: row.scores.overall.value, period, early: row.scores.overall.confidence === "early" }} className="ir-profile-link venue-card-profile">{identity}</VenueRosterProfileButton> : identity}
        </div>
        <div className="venue-performance-summary">
          <p className="venue-score-card-rank" title={rank}>{rank}</p>
          <p className="venue-performance-scale">Scores out of 100</p>
          {renderScores(row.scores, true)}
          <button type="button" className="venue-score-card-button" aria-label={`View ${row.dancer.name} score details`} aria-haspopup="dialog" onClick={() => setScoreDancerId(row.dancer.id)}>Score details</button>
        </div>
      </li>; })}</ul></div> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
    <dialog ref={scoreDialog} className="venue-score-dialog" aria-label={selected ? `${selected.dancer.name} performance scores` : "Performance scores"} onClose={() => setScoreDancerId(null)}>
      {selected && <>
      <header><h3>{selected.dancer.name}</h3><button type="button" autoFocus onClick={() => scoreDialog.current?.close()}>Close</button></header>
      <p className="venue-value-note">{periodLabels[period]} · Private to this club</p>
      <p className="venue-score-rank">{selected.rank === null ? "Unranked" : `#${selected.rank} of ${selected.rankedCount} ranked dancers`}</p>
      {renderScores(selected.scores)}
      <div className="venue-score-details">
        <h4>Score details · Out of 100</h4>
        <dl>{scoreKeys.map(key => <div key={`${selected.dancer.id}:${period}:${key}`}>
          <dt><span>{compactScoreLabels[key]}</span>{selected.scores[key].confidence === "early" && <span className="venue-score-confidence">Early data</span>}{selected.scores[key].value !== null && <strong className="venue-score-detail-result">Score {selected.scores[key].value}</strong>}</dt>
          <dd>{selected.scores[key].details ?
            <ul className="venue-score-inputs" aria-label={`${compactScoreLabels[key]} inputs`}>{selected.scores[key].details.inputs.map(input => <li key={input.label}><span>{input.label}</span><strong>{input.value}</strong></li>)}</ul>
          : <span>Not enough data. {selected.scores[key].reason}</span>}</dd>
        </div>)}</dl>
      </div>
      </>}
    </dialog>
  </section>;
}
