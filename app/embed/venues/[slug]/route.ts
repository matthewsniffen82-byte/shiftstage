import { canonicalVenueSlug } from "@/src/lib/dancr/venue-branding";
import { RHINO_ACCENT, RHINO_LOCATIONS, RHINO_VENUE_SLUG, rhinoLocation } from "@/src/lib/dancr/rhino-locations";
import { versionStaticAssetReferences } from "@/src/lib/dancr/static-asset-cache.mjs";
import { venueEmbedPolicy } from "@/src/lib/security/venue-embed-policy.mjs";
import { venueEmbedAccent } from "@/src/lib/dancr/venue-embed-theme.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug: requestedSlug } = await context.params;
  const slug = canonicalVenueSlug(requestedSlug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) return new Response("Club not found.", { status: 404 });
  const url = new URL(request.url);
  const rhino = slug === RHINO_VENUE_SLUG;
  // Shared Rhino links open the populated showcase; connected live embeds opt in.
  if (rhino && !["0", "1"].includes(url.searchParams.get("demo") || "")) {
    url.searchParams.set("demo", "1");
    return Response.redirect(url, 307);
  }
  const demo = rhino && url.searchParams.get("demo") === "1";
  const availableLocations = demo ? RHINO_LOCATIONS : RHINO_LOCATIONS.filter(item => "venueSlug" in item);
  const requestedLocation = rhinoLocation(url.searchParams.get("location"));
  const location = availableLocations.find(item => item.key === requestedLocation.key) || availableLocations[0];
  const locations = rhino ? `<div class="home-discovery-controls venue-embed-controls">
    <div class="home-city-filter"><label id="citySelectLabel" for="venue-location">Rhino location</label>
      <div class="home-city-select-shell"><select id="venue-location">${availableLocations.map(item =>
    `<option value="${item.key}" data-venue="${"venueSlug" in item ? item.venueSlug : ""}" data-count="${item.sampleCount}"${item.key === location.key ? " selected" : ""}>${item.label}</option>`
  ).join("")}</select>
        <button class="city-picker-trigger" id="citySelectButton" type="button" aria-haspopup="listbox" aria-controls="citySelectPanel" aria-expanded="false" aria-labelledby="citySelectLabel citySelectButtonText" hidden>
          <svg class="city-picker-trigger-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>
          <span class="city-picker-trigger-value" id="citySelectButtonText">${location.label}</span>
          <svg class="city-picker-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"></path></svg>
        </button>
      </div>
    </div>
    <div class="city-picker-inline" id="citySelectPanel" hidden><div class="venue-picker-options city-picker-options" id="citySelectOptions" role="listbox" aria-labelledby="citySelectLabel"></div></div>
  </div>` : "";
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark"><title>Working now · MyDancr</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@500;600;700;800;900&family=Outfit:wght@500;600;700;800;900&family=Space+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">
    <link href="/outputs/live-shell.css" rel="stylesheet">
    <link href="/dancr-brand-tokens.v1.css" rel="stylesheet">
    <link href="/dancr-button-system.v1.css" rel="stylesheet">
    <link href="/outputs/dancr-aesthetic.css" rel="stylesheet">
    <link href="/dancr-ui-consistency.v1.css" rel="stylesheet">
    <link href="/outputs/live-shell-overrides.css" rel="stylesheet">
    <link href="/venue-grid-embed.css" rel="stylesheet">
    <script defer src="/dancer-grid-card.js"></script><script defer src="/venue-grid-embed.js"></script>
  </head><body class="dancr-button-system dancer-directory-active venue-grid-embed" data-venue-slug="${slug}" data-demo="${demo}" data-accent="${rhino ? RHINO_ACCENT : venueEmbedAccent(url)}">
    <div class="app"><main class="stack">
      <div class="venue-embed-heading"><div><p id="venue-name">${rhino ? "Spearmint Rhino" : ""}</p><h1 aria-live="polite">Working now <span id="venue-count" hidden></span></h1></div><button id="venue-refresh" type="button" aria-label="Refresh working dancers" title="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 6.8"></path><path d="M20 4v7h-7"></path></svg></button>
        <a class="venue-embed-credit" href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer"><span>Powered by MyDancr</span><span>www.mydancr.com</span></a>
      </div>
      ${locations}
      <section id="venue-directory" class="stack" aria-label="Working dancers">
      <p id="venue-status" role="status">Loading working dancers…</p>
      <div id="results" class="home-dancer-grid home-dancer-three-column" aria-busy="true"></div>
      <button id="venue-more" type="button" hidden>Show more</button>
      <noscript>Enable JavaScript to see who is working now.</noscript>
    </section></main></div>
  </body></html>`;
  return new Response(versionStaticAssetReferences(html), { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
    "Content-Security-Policy": venueEmbedPolicy, "X-Robots-Tag": "noindex, nofollow",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  } });
}
