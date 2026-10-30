const assets = new Set([
  "/dancer-grid-card.js", "/venue-grid-embed.js", "/venue-grid-embed.css",
  "/venue-brand-themes.css",
  "/outputs/live-shell.css", "/outputs/live-shell-overrides.css", "/outputs/dancr-aesthetic.css",
  "/dancr-brand-tokens.v1.css", "/dancr-palette.v1.css", "/dancr-button-system.v1.css", "/dancr-ui-consistency.v1.css",
  // Public scripts emitted by the shared React layout, containing no account data.
  "/mydancr-api-transport.js", "/dancer-content-visibility.js",
  "/mydancr-push-invitations.js", "/mydancr-push-device.js",
  "/mydancr-performance.js", "/third-party-social-link-warning.js",
]);
const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
const documentPath = new RegExp(`^/embed/venues/${slug}(?:/dancers/${slug})?$`);
const dataPath = new RegExp(`^/api/public/venue-grid/${slug}(?:/dancers/${slug})?$`);
const goingPath = new RegExp(`^/api/public/venue-grid/${slug}/dancers/${slug}/going$`);

export function isPublicVenueEmbedRequest(method, path) {
  // This action verifies the club, dancer and active shift before using the
  // existing Going handler. Other account and mutation routes stay gated.
  if (["GET", "POST"].includes(method) && goingPath.test(path)) return true;
  if (!["GET", "HEAD"].includes(method)) return false;
  return assets.has(path) || documentPath.test(path) || dataPath.test(path)
    || path.startsWith("/_next/static/")
    || /^\/api\/public\/venue-embed-media\/(photo|video)$/.test(path);
}
