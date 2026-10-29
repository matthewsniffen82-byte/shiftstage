// Only saved venue settings may supply a color; URL objects/queries are ignored.
export function venueEmbedAccent(savedAccent) {
  const accent = typeof savedAccent === "string" ? savedAccent.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : "#6d28ff";
}
