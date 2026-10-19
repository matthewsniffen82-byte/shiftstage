export type VenueGuestColors = { internalAccent: string | null; embedAccent: string | null };
export const DEFAULT_GUEST_ACCENT = "#7c3aed";

export function normalizeGuestAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

export function guestAccentText(color: string): string {
  const channels = (normalizeGuestAccent(color) || DEFAULT_GUEST_ACCENT).slice(1).match(/../g)!
    .map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? "#050507" : "#ffffff";
}

export function venueGuestTheme(value: unknown) {
  const accent = normalizeGuestAccent(value);
  return accent ? { "--venue-guest-accent": accent, "--venue-guest-on-accent": guestAccentText(accent) } : undefined;
}
