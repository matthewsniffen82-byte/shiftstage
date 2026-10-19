/** Display recorded time without rounding up to credit that has not accrued. */
export function formatExternalHours(hours: number | null | undefined): string {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) return "Not recorded yet";
  const minutes = Math.floor(hours * 60);
  if (hours > 0 && minutes === 0) return "Less than 1 min";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export function externalTapRankingMessage(receipt: { shiftCheckedIn?: unknown; visibility?: unknown; replayed?: unknown } | null | undefined): string {
  return receipt?.shiftCheckedIn === true && receipt.replayed !== true && (receipt.visibility === "external" || receipt.visibility === "both")
    ? "Your external time is now counting toward your ranking." : "";
}
