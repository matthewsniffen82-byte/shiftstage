import type { CustomerSavedState, CustomerGoingSignal } from "../../../app/dashboard/dashboard-types";

export const CUSTOMER_DISCOVERY_CITY_KEY = "mydancr:customer-discovery-city:v1";

export function chooseDiscoveryCity(cities: string[], remembered: string | null, current = "Las Vegas") {
  return cities.includes(remembered || "") ? remembered! : cities.includes(current) ? current : cities[0] || current;
}

export function planDate(startsAt: string, timezone?: string | null) {
  const date = new Date(startsAt);
  try { return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: timezone || undefined }).format(date); }
  catch { return date.toLocaleDateString(); }
}

export function customerNightSummary(saved: CustomerSavedState | null | undefined, now: number) {
  const plans = (saved?.goingSignals || []).filter((item): item is CustomerGoingSignal & { shift: NonNullable<CustomerGoingSignal["shift"]> } =>
    item.shift?.status === "posted" && Number.isFinite(Date.parse(item.shift.startsAt)) && Date.parse(item.shift.endsAt) > now)
    .sort((a, b) => Date.parse(a.shift.startsAt) - Date.parse(b.shift.startsAt));
  const passes = (saved?.dealRedemptions || []).filter(item => item.status === "generated" && Date.parse(item.expiresAt) > now)
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  const pass = passes[0] || null;
  // A pass belongs with a plan only when both the club and validity window match.
  const firstPlan = pass ? plans.find(item => item.shift.venue.id && item.shift.venue.id === pass.venue?.id
    && Date.parse(item.shift.startsAt) < Date.parse(pass.expiresAt)
    && Date.parse(item.shift.endsAt) > Math.max(now, Date.parse(pass.generatedAt))) : plans[0];
  const outingPlans = firstPlan ? plans.filter(item => (firstPlan.shift.venue.id ? item.shift.venue.id === firstPlan.shift.venue.id : item.shiftId === firstPlan.shiftId)
    && planDate(item.shift.startsAt, item.shift.timezone) === planDate(firstPlan.shift.startsAt, firstPlan.shift.timezone)
    && (!pass || (Date.parse(item.shift.startsAt) < Date.parse(pass.expiresAt) && Date.parse(item.shift.endsAt) > Math.max(now, Date.parse(pass.generatedAt))))) : [];
  return { plans, passes, outing: pass || firstPlan ? {
    pass, venue: firstPlan?.shift.venue || pass!.venue, plans: outingPlans,
    date: firstPlan ? planDate(firstPlan.shift.startsAt, firstPlan.shift.timezone) : null,
  } : null };
}
