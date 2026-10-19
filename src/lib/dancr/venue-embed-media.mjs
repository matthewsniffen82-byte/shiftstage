// Dedicated anonymous delivery paths keep the main site's media gate intact.
// These serializers receive only media from the existing public profile loaders.
export function venueEmbedMediaUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.mydancr.com");
    const kind = url.pathname === "/api/media/dancer-photo" ? "photo" : url.pathname === "/api/media/dancer-video" ? "video" : null;
    if (!kind) return value;
    if (url.searchParams.has("preview")) return null;
    return `/api/public/venue-embed-media/${kind}${url.search}`;
  } catch { return null; }
}

export function venueEmbedMediaSrcSet(value) {
  return String(value || "").split(",").flatMap(source => {
    const match = source.trim().match(/^(\S+)\s+(\d+)w$/);
    const url = match && venueEmbedMediaUrl(match[1]);
    return url ? [`${url} ${match[2]}w`] : [];
  }).join(", ") || null;
}
