import type { DancerPlacementScorecard } from "./dancer-analytics-types";

export type DancerRankingStatus = { eligible: boolean; score: number | null; scorecard: DancerPlacementScorecard | null };

/** Display recorded time without rounding up to credit that has not accrued. */
export function formatExternalHours(hours: number | null | undefined): string {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) return "Not recorded yet";
  const minutes = Math.floor(hours * 60);
  if (hours > 0 && minutes === 0) return "Less than 1 min";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export function externalTapRankingMessage(receipt: { shiftCheckedIn?: unknown; visibility?: unknown; replayed?: unknown } | null | undefined): string {
  return receipt?.shiftCheckedIn === true && receipt.replayed !== true && (receipt.visibility === "external" || receipt.visibility === "both")
    ? "External time is now recording. You can see your recorded activity in Results." : "";
}

/** Confirm earned placement points, never infer a benefit from a selected mode. */
export function hasExternalRankingBenefit(status: DancerRankingStatus | null | undefined): boolean {
  const external = status?.scorecard?.scores.externalTime.value;
  const overall = status?.scorecard?.scores.overall.value;
  return status?.eligible === true && typeof external === "number" && Number.isFinite(external) && external > 0 && external <= 100
    && typeof overall === "number" && Number.isFinite(overall) && overall > 0 && overall <= 100;
}
