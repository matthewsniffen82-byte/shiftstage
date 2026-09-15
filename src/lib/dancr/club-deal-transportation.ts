export const CLUB_TRANSPORTATION_TERMS = "Free admission when you arrive in a private car, club-provided transport, Waymo, Zoox, or Cybercab. Uber, Lyft, and other rideshares or taxis do not qualify. Waymo, Zoox, and Cybercab ride fares are not included.";
export const CLUB_ARRIVAL_VERIFICATION = "Club staff must verify that you arrived in a private car, club-provided transport, Waymo, Zoox, or Cybercab before admitting you for free.";
export const CLUB_SHUTTLE_HANDOFF = "MyDancr sends your request to the club. The club handles transportation and will contact you to confirm availability, pickup location, and timing. Submitting a request does not confirm a ride.";

export const AUTONOMOUS_ADMISSION_OPTIONS = [
  { value: "waymo", label: "Waymo" },
  { value: "zoox", label: "Zoox" },
  { value: "cybercab", label: "Cybercab" },
] as const;
export type EligibleClubTransportation = "self_drive" | "club_shuttle" | (typeof AUTONOMOUS_ADMISSION_OPTIONS)[number]["value"];

export function isEligibleClubTransportation(value: unknown): value is EligibleClubTransportation {
  return value === "self_drive" || value === "club_shuttle" || AUTONOMOUS_ADMISSION_OPTIONS.some(option => option.value === value);
}

export function normalizeClubTransportationTerms(terms: string | null | undefined) {
  return String(terms || "")
    .replaceAll("Free admission requires arrival in your own car or other private car that is not an Uber or taxi, or use of the club's free shuttle service.", CLUB_TRANSPORTATION_TERMS)
    .replaceAll("Free admission when you arrive in a private car or club-provided transport. Arrivals by Uber, Lyft, other rideshares, or taxi do not qualify.", CLUB_TRANSPORTATION_TERMS);
}

export function clubDealTransportationTerms(terms: string | null | undefined) {
  const additional = normalizeClubTransportationTerms(terms).trim();
  return additional.includes(CLUB_TRANSPORTATION_TERMS) ? additional : [CLUB_TRANSPORTATION_TERMS, additional].filter(Boolean).join(" ");
}

export function normalizeShuttlePhone(value: unknown) {
  if (typeof value !== "string" || value.length > 40 || !/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  const phone = value.trim().startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function normalizeShuttleRequest(input: Record<string, unknown>) {
  const text = (value: unknown, minimum: number, maximum: number) => typeof value === "string"
    && value.trim().length >= minimum && value.trim().length <= maximum && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
  const name = text(input.name, 2, 100);
  const location = text(input.location, 5, 300);
  const phone = normalizeShuttlePhone(input.phone);
  const emailText = text(input.email, 3, 254);
  const email = emailText && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailText) ? emailText : null;
  const partySize = input.partySize;
  const id = typeof input.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ? input.requestId : null;
  if (!name || !location || !phone || !email || typeof partySize !== "number" || !Number.isInteger(partySize) || partySize < 1 || partySize > 100 || !id || input.handoffAccepted !== true) return null;
  return { name, location, phone, email, partySize, requestId: id };
}
