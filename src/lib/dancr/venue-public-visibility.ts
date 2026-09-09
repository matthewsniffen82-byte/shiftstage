/** Page approval survives a pause; public venue context requires a live deal. */
export function isPublicVenueRow(value: any): boolean {
  const venue = Array.isArray(value) ? value[0] : value;
  return Boolean(venue && venue.is_active === true && venue.has_active_club_deal === true);
}
