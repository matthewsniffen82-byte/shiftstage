"use client";

import { useState } from "react";
import { DANCER_PLACEMENT_DAYS, DANCER_SCORE_CATEGORIES, DANCER_SCORE_LABELS, DANCER_SCORE_WEIGHTS, EXTERNAL_RANKING_START_MINUTES } from "@/src/lib/dancr/venue-dancer-scores";
import { formatExternalHours, hasExternalRankingBenefit } from "@/src/lib/dancr/external-ranking-progress";
import { useDancerRankingStatus } from "./useDancerRankingStatus";

const guidance = {
  externalTime: `Your benefit starts after ${EXTERNAL_RANKING_START_MINUTES} recorded external minutes, with no requests, followers or club peers needed. External and Both count equally. More recorded external hours improve this score; internal-only hours do not count here.`,
  checkIns: "Check in when you arrive and check out before leaving. Accurate checkouts, check-in days and recorded hours contribute to this category.",
  internal: "Keep your in-club availability accurate so guests can request you while you are working. This category compares requests per recorded hour.",
  vip: "Share your profile with interested guests so they can request you again. Selections and returning-requester share count; staff approval does not improve this score.",
  profile: "Keep your photos and club information current, and share your profile. Recorded guest actions on your club-linked profile contribute here.",
  conversions: "Share your club-linked profile so interested guests can claim an entry pass. This score improves when those claimed passes are redeemed at the club.",
};
export function DancerDiscoveryBoosts({ refreshKey = "" }: { refreshKey?: string } = {}) {
  const [retry,setRetry] = useState(0);
  const { status, error } = useDancerRankingStatus(`${refreshKey}:${retry}`);
  const card = status?.scorecard;
  return <section className="dancer-analytics-audience" id="dancer-performance-ranking" aria-labelledby="discovery-boosts-heading">
    <h3 id="discovery-boosts-heading">Your performance score <small>Last {DANCER_PLACEMENT_DAYS} days{card?.venueName ? ` · ${card.venueName}` : ""}</small></h3>
    <p className="dancer-results-note"><strong>External time helps you rank higher everywhere.</strong></p>
    <p className="dancer-results-note">Time checked in on External or Both carries the most weight in your score—<strong>{DANCER_SCORE_WEIGHTS.externalTime}%</strong>. Higher scores help you appear higher up on the club&apos;s internal roster, public MyDancr listings, and the MyDancrTV feed.</p>
    <p className="dancer-results-note">Benefits start after {EXTERNAL_RANKING_START_MINUTES} recorded minutes. More external time builds your score.</p>
    {error ? <p role="alert">Your score is temporarily unavailable. <button type="button" onClick={()=>setRetry(value=>value+1)}>Try again</button></p>
      : !status ? <p role="status">Loading performance score…</p> : <>
        <p className="dancer-score-overall"><strong>Overall Performance: {card?.scores.overall.value == null ? "—" : `${card.scores.overall.value}/100`}</strong>{card?.scores.overall.confidence === "early" ? " · Early data" : ""}</p>
        {hasExternalRankingBenefit(status) && <p className="dancer-results-note"><strong>External ranking benefit active</strong></p>}
        {card?.scores.overall.value == null && <p className="dancer-results-note">Start earning ranking points after {EXTERNAL_RANKING_START_MINUTES} recorded external minutes, or when 3 categories have data.</p>}
        <div className="dancer-score-categories">{DANCER_SCORE_CATEGORIES.map(key => {
          const score = card?.scores[key];
          return <details key={key} className="dancer-score-category" open={key === "externalTime" ? true : undefined}><summary><span>{DANCER_SCORE_LABELS[key]}</span><strong>{score?.value == null ? "—" : `${score.value}/100`}</strong></summary>
            {key === "externalTime" ? <>
              <p><strong>Your largest ranking factor · {DANCER_SCORE_WEIGHTS.externalTime}%</strong></p>
              <p>Recorded external time: <strong>{formatExternalHours(card?.externalHours)}</strong> · Last {DANCER_PLACEMENT_DAYS} days</p>
              {score?.value == null ? <p><strong>Building your score</strong></p> : null}
            </> : null}
            <p>{score?.reason || score?.evidence || "More recorded activity is needed."}{score?.confidence === "early" ? " · Early data" : ""}</p>
            <p>{guidance[key]}</p><small>Overall score weight: {DANCER_SCORE_WEIGHTS[key]}%</small>
          </details>;
        })}</div>
        {!status.eligible && <p className="dancer-results-note">Your profile must be approved and public to appear in discovery.</p>}
        <details className="dancer-score-help">
          <summary>How scoring works</summary>
          <p className="dancer-results-note">Scores use the last {DANCER_PLACEMENT_DAYS} days at the club shown, or your most recent active club affiliation. Internal rosters use that club’s score. The filters above only change activity totals, including your 30-day history.</p>
          <p className="dancer-results-note">Five recorded external minutes can start an early score. With fewer than 3 scored categories, earned points use their original weights, so external time alone contributes up to 40 overall points. With 3 or more, missing categories are excluded and remaining weights adjust. Weights match the club dashboard. Early data means more activity is needed for a reliable score.</p>
          <p className="dancer-results-note">Scores refresh about once a minute and set your default placement on new browsing visits. Customer filters and selected videos can change what appears first.</p>
          <p className="dancer-results-note">Scores do not measure earnings or confirmed service completion.</p>
        </details>
      </>}
  </section>;
}
