import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const extract = name => {
  const source = html.match(new RegExp(`    function ${name}\\([^]*?\\n    \\}`))?.[0];
  assert.ok(source, `Missing ${name}`);
  return source;
};
const venue = { id: "club-1", name: "Test Club", slug: "test-club", activeDeal: { id: "offer-1" } };

test("club details offer one Free Entry action and preserve the club's offer configuration", () => {
  let config;
  const ctx = vm.createContext({ escapeHtml: String, encodeDealPass(value) { config = value; return "encoded-offer"; } });
  vm.runInContext(extract("venueOfferMarkup"), ctx);
  const markup = ctx.venueOfferMarkup(venue);
  assert.equal((markup.match(/<button\b/g) || []).length, 1);
  assert.match(markup, />Free Entry</);
  assert.doesNotMatch(markup, /\/rides\/|Pickup|Free Ride/);
  assert.equal(config.deal.id, venue.activeDeal.id);
  assert.equal(config.venueId, venue.id);
  assert.equal(config.sourceType, "club_page");
  assert.equal(ctx.venueOfferMarkup({ ...venue, activeDeal: null }), "");
});

test("working profiles use the club link for directions while upcoming travel stays available", () => {
  const ctx = vm.createContext({
    selectedCity: () => "Las Vegas", resolveVenueByName: () => venue,
    isWorkingTonight: profile => profile.working,
    venueDirectionsMarkup: () => '<a href="https://maps.google.com/">Directions</a>',
    venueExperienceHref: () => "/venues/test-club", escapeHtml: String, escapeOptionValue: String,
  });
  vm.runInContext(["dancerProfileDirectionsMarkup", "dancerProfileUpcomingVenueDealMarkup", "dancerProfileTonightTravelActionsMarkup"].map(extract).join("\n"), ctx);
  const profile = { scheduled: true, working: true, venue: venue.name };
  const working = ctx.dancerProfileTonightTravelActionsMarkup(profile);
  assert.equal(working, "");
  const upcoming = ctx.dancerProfileTonightTravelActionsMarkup({ ...profile, working: false });
  assert.equal((upcoming.match(/<a\b/g) || []).length, 2);
  assert.match(upcoming, />Free Entry</);
  assert.doesNotMatch(upcoming, /\/rides\/|Pickup|Free Ride/);
  assert.equal(ctx.dancerProfileTonightTravelActionsMarkup({ ...profile, scheduled: false }), "");
});
