import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const supportedLogos = {
  "centerfolds-cabaret-las-vegas": "fictional/neon-ember.svg",
  "chicas-bonitas": "fictional/velvet-orbit.svg",
  "crazy-horse-3": "fictional/electric-mirage.svg",
  "deja-vu-showgirls": "fictional/afterglow-social.svg",
  "deja-vu-showgirls-las-vegas": "fictional/violet-hour.svg",
  "hustler-club-las-vegas": "fictional/lunar-house.svg",
  "little-darlings": "fictional/prism-room.svg",
  "little-darlings-las-vegas": "fictional/golden-halo.svg",
  "palomino-club": "fictional/midnight-current.svg",
  "peppermint-hippo-las-vegas": "fictional/nova-lounge.svg",
  "play-it-again-sams": "fictional/silver-circuit.svg",
  "sapphire-las-vegas": "fictional/blue-ember.svg",
  "spearmint-rhino": "fictional/radiant-room.svg",
  "spearmint-rhino-las-vegas": "fictional/moonline-social.svg",
  "talk-of-the-town": "fictional/echo-house.svg",
  "the-library-gentlemens-club": "fictional/starlight-club.svg",
  "treasures-las-vegas": "fictional/aurora-room.svg",
};

const fictionalNames = {
  "centerfolds-cabaret-las-vegas": "Neon Ember",
  "chicas-bonitas": "Velvet Orbit",
  "crazy-horse-3": "Electric Mirage",
  "deja-vu-showgirls": "Afterglow Social",
  "deja-vu-showgirls-las-vegas": "Violet Hour",
  "hustler-club-las-vegas": "Lunar House",
  "little-darlings": "Prism Room",
  "little-darlings-las-vegas": "Golden Halo",
  "palomino-club": "Midnight Current",
  "peppermint-hippo-las-vegas": "Nova Lounge",
  "play-it-again-sams": "Silver Circuit",
  "sapphire-las-vegas": "Blue Ember",
  "spearmint-rhino": "Radiant Room",
  "spearmint-rhino-las-vegas": "Moonline Social",
  "talk-of-the-town": "Echo House",
  "the-library-gentlemens-club": "Starlight Club",
  "treasures-las-vegas": "Aurora Room",
};

const [branding, types, discoveryRoute, venuesRoute, publicService, liveApp, aesthetic, migration, addressMigration, travelMigration, allVenueAddressMigration, generator, uberButton] =
  await Promise.all([
    readFile(new URL("../src/lib/dancr/venue-branding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/venues/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
    readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110003_fictional_las_vegas_venue_identities.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110004_fictional_las_vegas_venue_addresses.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608150001_enable_selected_demo_venue_travel.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608180005_standardize_all_venue_addresses.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/generate-fictional-venue-logos.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/UberRideButton.tsx", import.meta.url), "utf8"),
  ]);

test("every currently listed Las Vegas venue slug resolves to an original fictional logo", async () => {
  for (const [slug, fileName] of Object.entries(supportedLogos)) {
    assert.match(branding, new RegExp(`"${slug}": "\\/venue-logos\\/${fileName.replaceAll(".", "\\.")}"`));
    const asset = await stat(new URL(`../public/venue-logos/${fileName}`, import.meta.url));
    assert.ok(asset.isFile());
    assert.ok(asset.size > 1_000, `${fileName} must contain a complete logo asset`);
    const source = await readFile(new URL(`../public/venue-logos/${fileName}`, import.meta.url), "utf8");
    assert.match(source, /Original MyDancr demonstration venue identity/);
    assert.match(source, /MYDANCR DEMO VENUE/);
    assert.doesNotMatch(source, /<script/i);
  }

  assert.equal(new Set(Object.values(supportedLogos)).size, 17);
  assert.match(branding, /return VENUE_LOGO_BY_SLUG\[normalizedSlug\] \|\| null/);
  assert.doesNotMatch(branding, /"\/venue-logos\/(?!fictional\/)/);
});

test("fictional venue marks remain readable on the production dark card", async () => {
  for (const fileName of Object.values(supportedLogos)) {
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

    assert.ok(visiblePixels > 1_000, `${fileName} must retain a visible mark and wordmark`);
    assert.ok(
      visibleLuminance / visiblePixels >= 100,
      `${fileName} must remain high contrast on a near-black card`,
    );
  }
});

test("the production migration fictionalizes every current Las Vegas venue without replacing relational IDs", () => {
  for (const [slug, fictionalName] of Object.entries(fictionalNames)) {
    assert.match(migration, new RegExp(`'${slug}', '${fictionalName}'`));
    assert.match(generator, new RegExp(`name: "${fictionalName}"`));
  }
  assert.equal(Object.keys(fictionalNames).length, 17);
  assert.match(migration, /update public\.venues as venue/);
  assert.doesNotMatch(migration, /update public\.(shifts|dancer_venue_affiliations|venue_deals)/);
  assert.match(migration, /Every Las Vegas venue must receive an explicit fictional identity/);
});

test("fictional Vegas venue travel stays visibly active but preview-only for every stored destination", () => {
  assert.match(addressMigration, /0000 MyDancr Ave, Las Vegas, NV 55555/g);
  assert.match(addressMigration, /expected_count integer := 17/);
  assert.match(addressMigration, /Every listed Las Vegas demonstration venue must use the fictional pitch address/);
  for (const slug of [
    "deja-vu-showgirls-las-vegas",
    "little-darlings-las-vegas",
    "peppermint-hippo-las-vegas",
    "sapphire-las-vegas",
    "spearmint-rhino-las-vegas",
  ]) {
    assert.match(travelMigration, new RegExp(`'${slug}'`));
  }
  assert.match(travelMigration, /active_destination_count <> 5/);
  assert.match(branding, /export function isFictionalVenueBranding/);
  assert.match(branding, /export function isFictionalVenueTravelPreviewOnly/);
  assert.match(branding, /return isFictionalVenueBranding\(venue\?\.slug\)/);
  assert.doesNotMatch(branding, /FICTIONAL_VENUE_PITCH_ADDRESS/);
  assert.match(liveApp, /function isFictionalDemoVenue\(venue\)/);
  assert.match(liveApp, /startsWith\("\/venue-logos\/fictional\/"\)/);
  assert.match(liveApp, /function isFictionalDemoTravelPreviewOnly\(venue\)[\s\S]*?return isFictionalDemoVenue\(venue\)/);
  assert.match(liveApp, /function venueDirectionsMarkup[\s\S]*?isFictionalDemoTravelPreviewOnly\(venue\)[\s\S]*?is-inactive-demo[\s\S]*?data-demo-travel="directions"/);
  assert.match(liveApp, /function uberRideLinkMarkup[\s\S]*?isFictionalDemoTravelPreviewOnly\(venue\)[\s\S]*?is-inactive-demo[\s\S]*?data-demo-travel="uber"/);
  const demoDirectionsMarkup = liveApp.match(/function venueDirectionsMarkup[\s\S]*?function uberRideLinkMarkup/)?.[0] || "";
  assert.match(demoDirectionsMarkup, /data-demo-travel="directions" tabindex="-1" aria-disabled="true"/);
  assert.doesNotMatch(demoDirectionsMarkup, /data-demo-travel="directions"[^>]*\sdisabled(?:\s|>)/);
  assert.match(liveApp, /closest\?\.\("\[data-demo-travel\]"\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?\}, true\)/);
  assert.match(liveApp, /venueDirectionsMarkup\(\{[\s\S]*?venue-address-directions/);
  assert.match(liveApp, /venueDirectionsMarkup\(\{[\s\S]*?home-discovery-feed-directions venue-directions-btn/);
  assert.match(uberButton, /isFictionalVenueTravelPreviewOnly\(venue\)[\s\S]*?aria-disabled="true"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?tabIndex=\{-1\}/);
});

test("the latest production migration gives every venue the MyDancr placeholder address", () => {
  assert.match(allVenueAddressMigration, /create or replace function public\.mydancr_placeholder_venue_address/);
  assert.match(allVenueAddressMigration, /'0000 MyDancr Ave'/);
  assert.match(allVenueAddressMigration, /btrim\(venue_state\) \|\| ' 55555'/);
  assert.match(allVenueAddressMigration, /update public\.venues as venue/);
  assert.match(allVenueAddressMigration, /address = public\.mydancr_placeholder_venue_address\(venue\.city, venue\.state\)/);
  assert.match(allVenueAddressMigration, /create trigger venues_enforce_mydancr_placeholder_address[\s\S]*?before insert or update of address, city, state[\s\S]*?execute function public\.enforce_mydancr_placeholder_venue_address\(\)/);
  assert.match(allVenueAddressMigration, /revoke execute on function public\.enforce_mydancr_placeholder_venue_address\(\) from public, anon, authenticated/);
  assert.match(allVenueAddressMigration, /Every venue must use the MyDancr placeholder street address and 55555 ZIP code/);
  assert.doesNotMatch(allVenueAddressMigration, /where venue\.slug\s+(?:in|=)/);
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
    /\.home-venue-discovery-logo \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?padding: 42px 72px 142px 18px;[\s\S]*?object-fit: contain;[\s\S]*?object-position: center 34%;/,
  );
  assert.match(
    aesthetic,
    /@media \(max-width: 420px\)[\s\S]*?\.home-venue-discovery-logo \{[\s\S]*?padding: 40px 72px 138px 16px;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-logo-shell \{[\s\S]*?width: min\(86%, 360px\);[\s\S]*?height: 180px;/,
  );
  assert.doesNotMatch(aesthetic, /home-venue-discovery-logo-shell \{[\s\S]{0,180}border: 1px solid/);
});
