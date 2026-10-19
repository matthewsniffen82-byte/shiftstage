import { versionStaticAssetReferences } from "@/src/lib/dancr/static-asset-cache.mjs";
import { venueEmbedPolicy } from "@/src/lib/security/venue-embed-policy.mjs";
import { venueEmbedAccent } from "@/src/lib/dancr/venue-embed-theme.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) return new Response("Club not found.", { status: 404 });
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
  </head><body class="dancr-button-system dancer-directory-active venue-grid-embed" data-venue-slug="${slug}" data-accent="${venueEmbedAccent(new URL(request.url))}">
    <div class="app"><main class="stack"><section id="venue-directory" class="stack" aria-label="Working dancers">
      <div class="venue-embed-heading"><div><h1>Working now</h1><p id="venue-name"></p></div><button id="venue-refresh" type="button">Refresh</button></div>
      <p class="venue-embed-note">Only participating MyDancr dancers are shown.</p>
      <p id="venue-status" role="status">Loading working dancers…</p>
      <div id="results" class="home-dancer-grid home-dancer-three-column" aria-busy="true"></div>
      <button id="venue-more" type="button" hidden>Show more</button>
      <noscript>Enable JavaScript to see who is working now.</noscript>
    </section><section id="venue-profile" hidden tabindex="-1" aria-label="Dancer profile">
      <button id="venue-profile-back" type="button">← Working now</button>
      <p id="venue-profile-status" role="status"></p><div id="venue-profile-content"></div>
    </section><footer class="venue-embed-credit"><a href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer"><span>Powered by MyDancr</span><span>www.mydancr.com</span></a></footer></main></div>
    <dialog id="venue-media-dialog" aria-label="Dancer photo or video"><button id="venue-media-close" type="button" aria-label="Close media">Close</button><div id="venue-media-content"></div></dialog>
  </body></html>`;
  return new Response(versionStaticAssetReferences(html), { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
    "Content-Security-Policy": venueEmbedPolicy, "X-Robots-Tag": "noindex, nofollow",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  } });
}
