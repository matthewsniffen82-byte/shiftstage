# Club Working Now embed

Use the club's public slug in the iframe URL. For example:

```html
<iframe
  src="https://www.mydancr.com/embed/venues/echo-house"
  title="Echo House — dancers working now"
  width="100%"
  height="720"
  loading="lazy"
  style="display:block;border:0;border-radius:12px"
></iframe>
```

External embedding is currently approved only for `https://www.spearmintrhinolv.com`
and `https://spearmintrhinolv.com`. MyDancr pages can also show same-origin previews.
Other websites, HTTP origins and unlisted subdomains cannot frame the embed.

The approved club website must permit `https://www.mydancr.com` in its
`frame-src` policy if it sets one. Set the height to fit the page; the grid scrolls
inside the frame. If the host adds a sandbox, it needs `allow-scripts`,
`allow-same-origin`, `allow-popups`, and `allow-popups-to-escape-sandbox`.

The widget uses the homepage's shared three-column card renderer, styles, public
eligibility checks and ranking. It shows only current public Working Now profiles
at that club. There are no city, club or offline filters. Tapping a card opens an
in-widget profile with approved photos and videos. The profile is checked again
against that location's current Working Now status. The full MyDancr profile,
including follow and free entry actions, is available in a new tab.

## Company colors and multiple locations

In **Admin → Clubs → expand the location → Guest colors**, choose **Website
embed color** with the picker or a six-digit hex code (including `#`), then save.
The same panel provides the location's copyable embed link and HTML code.
Choose **Table QR color** separately for the guest table roster and the profiles
opened from it. Only an active MyDancr admin can edit these settings. Staff venue
dashboards keep their original colors. Either setting can use MyDancr default.

Buttons, selected media tabs, focus rings, venue icons and subtle background accents
use that color. Text on filled buttons automatically uses black or white for
contrast. Working Now stays green. Invalid colors fall back to MyDancr violet.
The feed, embedded profiles and media viewer share the accent. Colors are saved
per location; dancer records and public MyDancr pages keep their original theme.
Saved changes apply on the next feed refresh without replacing the iframe URL.
Legacy `?accent=c99842` links still work until Admin saves the location's colors;
after that, the saved setting (including a reset to default) takes precedence.

A company puts a different, fixed iframe on each location's own landing page.
Admin can save the same accent for all its locations. Each slug identifies a specific club,
so locations can be in different cities or states. The embedded roster never
depends on the visitor's location or mixes multiple clubs.

```html
<!-- On the company's Nevada location landing page: -->
<iframe src="https://www.mydancr.com/embed/venues/nevada-club-slug"
  title="Nevada location — working now" width="100%" height="720"
  style="border:0" loading="lazy"></iframe>

<!-- On its Florida location landing page (a separate page): -->
<iframe src="https://www.mydancr.com/embed/venues/florida-club-slug"
  title="Florida location — working now" width="100%" height="720"
  style="border:0" loading="lazy"></iframe>
```

Replace those example slugs with the actual MyDancr club slugs. The company's
ordinary location navigation takes visitors between its landing pages. No extra
location picker is needed inside the grid. This does not change venue ownership
or grant access to venue dashboards.

Refresh runs every 60 seconds while the document is visible and when it becomes
visible again. There is also a manual Refresh button. Larger rosters use Show more;
refresh rechecks all loaded pages. A fresh placement visit includes new check-ins.
No login or third-party cookies are required. Empty, inactive or unavailable clubs
never fall back to other clubs' dancers. Failed refreshes clear unconfirmed cards.

Only `/embed/venues/<slug>` and `/embed/venues/<slug>/dancers/<dancerSlug>` permit
framing by the approved website origins. Both use the same origin list in
`src/lib/security/venue-embed-policy.mjs`; update that list only after approving
a destination. Account, dashboard, ordinary profile and other app documents
retain their existing framing protections. The
embed API derives its venue and city on the server and accepts only a scoped
pagination cursor. It returns only card fields, with no shift deadlines or account
details. The optional colors live in the server-only `venue_guest_colors` table;
the deployment applies `20261019034059_venue_guest_colors.sql`. Existing locations
need no setup unless custom colors are wanted. Clearing both colors in Admin
restores MyDancr defaults; no data deletion or venue publication change is needed.

The site password intentionally permits only these public embeds, their scoped
data endpoints, their fixed CSS/JS assets, and anonymous approved-media delivery.
The homepage, dashboards, account pages, original media endpoints and other APIs
remain gated. Embedded media never accepts private preview tokens and rechecks
public visibility on every request, including video byte ranges.
