import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const supportedLogos = {
  "centerfolds-cabaret-las-vegas": "centerfolds-cabaret-las-vegas.png",
  "chicas-bonitas": "chicas-bonitas.jpg",
  "crazy-horse-3": "crazy-horse-3.png",
  "deja-vu-showgirls": "deja-vu-showgirls-las-vegas-dark.png",
  "deja-vu-showgirls-las-vegas": "deja-vu-showgirls-las-vegas-dark.png",
  "hustler-club-las-vegas": "hustler-club-las-vegas.png",
  "little-darlings": "little-darlings-las-vegas-dark.png",
  "little-darlings-las-vegas": "little-darlings-las-vegas-dark.png",
  "palomino-club": "palomino-club.svg",
  "peppermint-hippo-las-vegas": "peppermint-hippo-las-vegas.svg",
  "play-it-again-sams": "play-it-again-sams.svg",
  "sapphire-las-vegas": "sapphire-las-vegas.png",
  "spearmint-rhino": "spearmint-rhino-las-vegas.png",
  "spearmint-rhino-las-vegas": "spearmint-rhino-las-vegas.png",
  "talk-of-the-town": "talk-of-the-town-dark.png",
  "the-library-gentlemens-club": "the-library-gentlemens-club.png",
  "treasures-las-vegas": "treasures-las-vegas.png",
};

const darkCardLogoFiles = [
  "deja-vu-showgirls-las-vegas-dark.png",
  "little-darlings-las-vegas-dark.png",
  "talk-of-the-town-dark.png",
];

const [branding, types, discoveryRoute, venuesRoute, publicService, liveApp, aesthetic] =
  await Promise.all([
    readFile(new URL("../src/lib/dancr/venue-branding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/venues/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
    readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  ]);

test("every currently listed Las Vegas venue slug resolves to a local verified logo", async () => {
  for (const [slug, fileName] of Object.entries(supportedLogos)) {
    assert.match(branding, new RegExp(`"${slug}": "\\/venue-logos\\/${fileName.replaceAll(".", "\\.")}"`));
    const asset = await stat(new URL(`../public/venue-logos/${fileName}`, import.meta.url));
    assert.ok(asset.isFile());
    assert.ok(asset.size > 1_000, `${fileName} must contain a real logo asset`);
  }

  assert.equal(new Set(Object.values(supportedLogos)).size, 14);
  assert.match(branding, /return VENUE_LOGO_BY_SLUG\[normalizedSlug\] \|\| null/);
});

test("monochrome venue marks remain readable on the production dark card", async () => {
  for (const fileName of darkCardLogoFiles) {
    const { data, info } = await sharp(
      fileURLToPath(new URL(`../public/venue-logos/${fileName}`, import.meta.url)),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let visiblePixels = 0;
    let visibleLuminance = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] <= 24) continue;
      visiblePixels += 1;
      visibleLuminance +=
        0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    }

    assert.ok(visiblePixels > 1_000, `${fileName} must retain its visible source mark`);
    assert.ok(
      visibleLuminance / visiblePixels >= 220,
      `${fileName} must remain high contrast on a near-black card`,
    );
  }
});

test("verified logo identity flows through every public venue response", () => {
  assert.match(types, /logoImageUrl\?: string \| null/);
  for (const source of [discoveryRoute, venuesRoute, publicService]) {
    assert.match(source, /verifiedVenueLogoUrl/);
    assert.match(source, /logoImageUrl: verifiedVenueLogoUrl\(/);
  }
  assert.match(liveApp, /logoImageUrl: item\.logoImageUrl \|\| ""/);
});

test("venue cards use a full-card logo canvas while detail pages retain contain-fit identity", () => {
  assert.match(liveApp, /function venueLogoMarkup\(venue, className\)/);
  assert.match(liveApp, /venueLogoMarkup\(venue, "venue-card-logo"\)/);
  assert.match(liveApp, /venueLogoMarkup\(venue, "home-venue-discovery-logo"\)/);
  assert.match(liveApp, /venueLogoMarkup\(venue, "venue-detail-logo"\)/);
  assert.match(liveApp, /logoMarkup \|\| `<span class="venue-card-mark">/);
  assert.match(liveApp, /logoMarkup \|\| `<span class="home-venue-discovery-monogram">/);
  assert.match(liveApp, /logoMarkup \|\| `[\s\S]*?class="venue-sign"/);
  assert.match(aesthetic, /\.venue-card-logo,[\s\S]*?\.venue-detail-logo \{[\s\S]*?object-fit: contain;/);
  assert.match(aesthetic, /\.venue-card-logo-shell,[\s\S]*?\.venue-detail-logo-shell \{[\s\S]*?border: 1px solid var\(--dancr-color-border-subtle\)/);
  assert.match(
    aesthetic,
    /\.home-venue-discovery-art \.home-venue-discovery-logo-shell \{[\s\S]*?inset: 0;[\s\S]*?transform: none;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-logo \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?padding: 42px 54px 142px 18px;[\s\S]*?object-fit: contain;[\s\S]*?object-position: center 34%;/,
  );
  assert.match(
    aesthetic,
    /@media \(max-width: 420px\)[\s\S]*?\.home-venue-discovery-logo \{[\s\S]*?padding: 40px 50px 138px 16px;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-logo-shell \{[\s\S]*?width: min\(86%, 360px\);[\s\S]*?height: 180px;/,
  );
  assert.doesNotMatch(aesthetic, /home-venue-discovery-logo-shell \{[\s\S]{0,180}border: 1px solid/);
});
