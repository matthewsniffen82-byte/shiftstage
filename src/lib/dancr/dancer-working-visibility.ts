// Check-in mode controls the Working Now lists; public profile visibility is separate.
export function dancerWorkingVisibility(mode: unknown, isPublic?: boolean, isIncognito = false): string {
  if (isIncognito) return "Hidden from all guests while Incognito is on.";
  if (mode === "internal") return "Club Working Now only. Hidden from public Working Now.";
  if (mode === "both") return isPublic === false ? "Club Working Now only. Your public profile is hidden."
    : isPublic === true ? "Visible in club and public Working Now." : "Both selected. Check your public profile visibility below.";
  if (mode === "external") return isPublic === false ? "Public Working Now is hidden with your profile."
    : isPublic === true ? "Public Working Now only." : "Public Working Now selected. Check your profile visibility below.";
  return "Working Now visibility is unavailable. Check your profile visibility below.";
}
