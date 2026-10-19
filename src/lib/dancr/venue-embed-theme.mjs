// Presentation belongs to the iframe URL, never a club's public-app record.
export function venueEmbedAccent(url) {
  const value = url.searchParams.get("accent") || "";
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : "#7c3aed";
}
