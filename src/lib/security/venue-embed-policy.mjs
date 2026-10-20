// The widget exposes public cards only. Account pages retain DENY / 'none'.
export const venueEmbedPolicy = [
  "default-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  "script-src 'self'", "script-src-attr 'none'", "connect-src 'self'",
  "style-src 'self' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data:", "media-src 'self' https: blob:", "frame-ancestors 'self' https:", "upgrade-insecure-requests",
].join("; ");

// Only dedicated public widget/profile documents may be framed externally.
export const nonEmbedDocumentSource = "/:path((?!embed/venues/[^/]+(?:/dancers/[^/]+)?/?$).*)";
