"use client";

import { hasExternalRankingBenefit } from "@/src/lib/dancr/external-ranking-progress";
import { EXTERNAL_RANKING_START_MINUTES } from "@/src/lib/dancr/venue-dancer-scores";
import { useDancerRankingStatus } from "./useDancerRankingStatus";

export function DancerExternalRankingBenefit({ refreshKey }: { refreshKey: string }) {
  const { status, error } = useDancerRankingStatus(refreshKey);
  return <small aria-live="polite">{error ? "Ranking status is temporarily unavailable."
    : !status ? "Checking ranking benefit…"
    : hasExternalRankingBenefit(status) ? <><strong>External ranking benefit active</strong> · More external time builds your score.</>
    : !status.eligible ? "Your profile must be approved and public to use your ranking benefit."
    : <>Your ranking benefit starts after {EXTERNAL_RANKING_START_MINUTES} recorded external minutes. No requests or followers needed.</>}
  </small>;
}
