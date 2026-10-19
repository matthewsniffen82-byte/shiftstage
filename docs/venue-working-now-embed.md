# Club Working Now embed

Use the club's public slug in the iframe URL. For example:

```html
<iframe
  src="https://www.mydancr.com/embed/venues/echo-house?accent=7c3aed"
  title="Echo House — dancers working now"
  width="100%"
  height="720"
  loading="lazy"
  style="display:block;border:0;border-radius:12px"
></iframe>
```

The club's website must use HTTPS and permit `https://www.mydancr.com` in its
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

Set `accent` to a six-digit hex color from the company's logo, without `#`.
Buttons, selected media tabs, focus rings, venue icons and subtle background accents
use that color. Text on filled buttons automatically uses black or white for
contrast. Working Now stays green. Invalid colors fall back to MyDancr violet.
The feed, embedded profiles and media viewer share the accent; nothing is saved
to the dancer or club record, and public MyDancr pages keep their original theme.

A company puts a different, fixed iframe on each location's own landing page.
Keep the same accent on all those pages. Each slug identifies a specific club,
so locations can be in different cities or states. The embedded roster never
depends on the visitor's location or mixes multiple clubs.

```html
<!-- On the company's Nevada location landing page: -->
<iframe src="https://www.mydancr.com/embed/venues/nevada-club-slug?accent=c99842"
  title="Nevada location — working now" width="100%" height="720"
  style="border:0" loading="lazy"></iframe>

<!-- On its Florida location landing page (a separate page): -->
<iframe src="https://www.mydancr.com/embed/venues/florida-club-slug?accent=c99842"
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

Only `/embed/venues/<slug>` permits external HTTPS framing. Account, dashboard,
profile and other app documents retain their existing framing protections. The
embed API derives its venue and city on the server and accepts only a scoped
pagination cursor. It returns only card fields, with no shift deadlines or account
details. No database migration or per-club provisioning is required.
