import { canonicalVenueSlug } from "@/src/lib/dancr/venue-branding";
import { getVenueProfile } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { versionStaticAssetReferences } from "@/src/lib/dancr/static-asset-cache.mjs";
import { venueEmbedPolicy } from "@/src/lib/security/venue-embed-policy.mjs";
import { venueEmbedAccent } from "@/src/lib/dancr/venue-embed-theme.mjs";
import { getVenueGuestColors } from "@/src/lib/dancr/venue-guest-colors";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug: requestedSlug } = await context.params;
  const slug = canonicalVenueSlug(requestedSlug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) return new Response("Club not found.", { status: 404 });
  const url = new URL(request.url);
  const fromClubDashboard = url.searchParams.get("from") === "club-dashboard";
  const client = createAdminSupabaseClient();
  const venue = await getVenueProfile(client, slug);
  if (!venue) return new Response("Club not found.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const colors = await getVenueGuestColors(client, venue.id);
  const accent = venueEmbedAccent(colors.embedAccent);
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark"><title>Working now · MyDancr</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@500;600;700;800;900&family=Outfit:wght@500;600;700;800;900&display=swap" rel="stylesheet">
    <link href="/outputs/live-shell.css" rel="stylesheet">
    <link href="/dancr-brand-tokens.v1.css" rel="stylesheet">
    <link href="/dancr-palette.v1.css" rel="stylesheet">
    <link href="/dancr-button-system.v1.css" rel="stylesheet">
    <link href="/outputs/dancr-aesthetic.css" rel="stylesheet">
    <link href="/dancr-ui-consistency.v1.css" rel="stylesheet">
    <link href="/outputs/live-shell-overrides.css" rel="stylesheet">
    <link href="/venue-grid-embed.css" rel="stylesheet">
    <link href="/venue-roster-header.css" rel="stylesheet">
    <link href="/venue-brand-themes.css" rel="stylesheet">
    <link href="/club-logos.css" rel="stylesheet">
    <script defer src="/club-logos.js"></script>
    <link href="/dancer-identity-badge.css" rel="stylesheet">
    <script defer src="/dancer-identity-badge.js"></script>
    <script defer src="/dancer-grid-card.js"></script><script defer src="/venue-grid-embed.js"></script>
  </head><body class="dancr-button-system dancer-directory-active venue-grid-embed" data-venue-slug="${slug}" data-from-club-dashboard="${fromClubDashboard}" data-accent="${accent}" data-venue-guest-color="${accent === "#6d28ff" ? "default" : "custom"}">
    <div class="app"><main class="stack">
      ${fromClubDashboard ? '<a class="dancr-home-back" href="/dashboard/venue"><span aria-hidden="true">‹</span> Back to club dashboard</a>' : ""}
      <div class="venue-embed-heading">
        <div class="venue-embed-brand"><img id="venue-logo" class="venue-embed-logo" alt="" hidden width="80" height="80"><div class="venue-embed-identity">
          <p id="venue-name" class="venue-embed-name"></p>
          <p id="venue-city" class="venue-embed-city" hidden></p>
          <a class="venue-embed-credit" href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer">Powered by mydancr.com</a>
        </div></div>
      </div>
      <section id="venue-directory" class="stack" aria-label="Working dancers">
      <div class="venue-embed-working">
        <h1 aria-live="polite">Working now <span id="venue-count" hidden></span></h1>
        <button id="venue-refresh" class="mydancr-refresh-button" type="button" aria-label="Refresh working dancers" title="Refresh working dancers"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.8L21 8"></path><path d="M21 3v5h-5"></path></svg></button>
      </div>
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
