const assets = new Set([
  "/dancer-grid-card.js", "/venue-grid-embed.js", "/venue-grid-embed.css",
  "/outputs/live-shell.css", "/outputs/live-shell-overrides.css", "/outputs/dancr-aesthetic.css",
  "/dancr-brand-tokens.v1.css", "/dancr-button-system.v1.css", "/dancr-ui-consistency.v1.css",
]);
const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
const documentPath = new RegExp(`^/embed/venues/${slug}$`);
const dataPath = new RegExp(`^/api/public/venue-grid/${slug}(?:/dancers/${slug})?$`);

export function isPublicVenueEmbedRequest(method, path) {
  if (!["GET", "HEAD"].includes(method)) return false;
  return assets.has(path) || documentPath.test(path) || dataPath.test(path)
    || /^\/api\/public\/venue-embed-media\/(photo|video)$/.test(path);
}
