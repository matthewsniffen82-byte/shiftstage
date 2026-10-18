"use client";

import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { DancerPlacementScorecard } from "@/src/lib/dancr/dancer-analytics-types";
import { DANCER_PLACEMENT_DAYS, DANCER_SCORE_CATEGORIES, DANCER_SCORE_LABELS, DANCER_SCORE_WEIGHTS } from "@/src/lib/dancr/venue-dancer-scores";

type Boosts = { eligible: boolean; score: number | null; scorecard: DancerPlacementScorecard | null };
const guidance = {
  checkIns: "Check in when you arrive and check out before leaving. Use both rosters when you are available for both in-club requests and public discovery.",
  internal: "Keep your in-club availability accurate so guests can request you while you are working. This category compares requests per recorded hour.",
  vip: "Share your profile with interested guests so they can request you again. Selections and returning-requester share count; staff approval does not improve this score.",
  profile: "Keep your photos and club information current, and share your profile. Recorded guest actions on your club-linked profile contribute here.",
  conversions: "Share your club-linked profile so interested guests can claim an entry pass. This score improves when those claimed passes are redeemed at the club.",
};
export function DancerDiscoveryBoosts() {
  const [status,setStatus] = useState<Boosts | null>(null);
  const [error,setError] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setError(false);
    void requestDashboardJson("/api/dancer/discovery",{cache:"no-store",expectedRole:"dancer",signal:controller.signal,
      timeoutMs:15000,fallbackMessage:"Unable to load discovery placement."}).then(result=>{
      if (!controller.signal.aborted) setStatus(result as unknown as Boosts);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[retry]);
  const card = status?.scorecard;
  return <section className="dancer-analytics-audience" aria-labelledby="discovery-boosts-heading">
    <h3 id="discovery-boosts-heading">Your performance score <small>Rolling {DANCER_PLACEMENT_DAYS} days{card?.venueName ? ` · ${card.venueName}` : ""}</small></h3>
    {error ? <p role="alert">Your score is temporarily unavailable. <button type="button" onClick={()=>setRetry(value=>value+1)}>Try again</button></p>
      : !status ? <p role="status">Loading performance score…</p> : <>
        <p className="dancer-score-overall"><strong>Overall Performance: {card?.scores.overall.value == null ? "—" : `${card.scores.overall.value}/100`}</strong>{card?.scores.overall.confidence === "early" ? " · Early data" : ""}</p>
        <p className="dancer-results-note"><strong>Higher score, higher visibility.</strong> Your rolling {DANCER_PLACEMENT_DAYS}-day score determines your default placement in dancer grids, internal rosters and Dancer TV. Customer filters and selected videos can change what appears first.</p>
        <p className="dancer-results-note">{card?.scores.overall.reason || card?.scores.overall.evidence || "More recorded activity is needed before a score is available."}</p>
        <div className="dancer-score-categories">{DANCER_SCORE_CATEGORIES.map(key => {
          const score = card?.scores[key];
          return <details key={key} className="dancer-score-category"><summary><span>{DANCER_SCORE_LABELS[key]}</span><strong>{score?.value == null ? "—" : `${score.value}/100`}</strong></summary>
            <p>{score?.reason || score?.evidence || "More recorded activity is needed."}{score?.confidence === "early" ? " · Early data" : ""}</p>
            <p>{guidance[key]}</p><small>Overall score weight: {DANCER_SCORE_WEIGHTS[key]}%</small>
          </details>;
        })}</div>
        <p className="dancer-results-note">This score uses the last {DANCER_PLACEMENT_DAYS} days at the club shown on your card, or your most recent active club affiliation. Internal rosters use that club’s score. The filters above apply to your activity totals, including your 30-day history.</p>
        <p className="dancer-results-note">The category weights match the club dashboard. At least three categories are required; missing categories are excluded and the remaining weights adjust. Early data means more activity is needed for a reliable score.</p>
        {!status.eligible && <p className="dancer-results-note">Your profile must be approved and public to appear in discovery.</p>}
      </>}
    <p className="dancer-results-note">Scores do not measure earnings or confirmed service completion.</p>
  </section>;
}
