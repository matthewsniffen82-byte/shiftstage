import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const venue = { id: "club", name: "Fixture Club", city: "Las Vegas" };
function fixture(dancers, partial = false) {
  const context = vm.createContext({
    discoveryMarket: () => ({ dancers }),
    citySelect: { value: venue.city }, hasMoreDiscovery: () => partial,
    isApprovedPublicProfile: row => row.approved !== false,
    withTrendingRank: row => ({ ...row }),
    isWorkingTonight: row => row.working,
    // Start times deliberately disagree with performance order. No renderer
    // may replace the server's earned order with this historical ordering.
    shiftStartMinutes: Number,
    venueDetails: () => ({ city: "Las Vegas", state: "NV", distanceLabel: "1 mi", hours: "8 PM" }),
    venueOperatingStatus: () => ({ state: "open", label: "Open", hoursLabel: "8 PM" }),
    venueInitials: () => "FC", escapeHtml: String, escapeOptionValue: String,
    venueExperienceHref: () => "/venues/fixture", venueLogoMarkup: () => "",
    venueVisualAttrs: () => ({ attrs: { className: "", style: "" }, source: "artwork" }),
    isFollowingVenue: () => false, venueAccent: () => "#000",
    displayShiftTime: String, actionIconMarkup: () => "", clockIconMarkup: () => "", venueIconMarkup: () => "",
    venueDirectionsMarkup: () => "", venueCardQrMarkup: () => "",
    homeVenueDiscoveryQrMarkup: () => "", actionButtonLabel: () => "",
    publicAvatarPhotoUrl: row => "https://example.test/" + row.id,
    publicAvatarPhotoSrcSet: () => "", nativeResponsivePhotoAttrs: url => `src="${url}"`,
    avatarPhotoPosition: () => "50% 50%", profileReferenceValue: row => row.id,
  });
  for (const name of ["venueDancers", "venueLineupMarkup", "venueCard", "homeVenueDiscoveryFeedSlide"]) {
    const fn = source.match(new RegExp(`    function ${name}\\([^]*?\\n    \\}`))?.[0];
    assert.ok(fn, name);
    vm.runInContext(fn, context);
  }
  return {
    mobile: () => context.homeVenueDiscoveryFeedSlide(venue, 0, 1, venue.city),
    desktop: () => context.venueCard(venue),
    direct: () => context.venueLineupMarkup(venue, venue.city, { mobile: true }),
  };
}
const avatarIds = markup => [...markup.matchAll(/data-venue-dancer-profile[^>]*data-dancer-id="([^"]+)"/g)].map(match => match[1]);
const dancer = (id, time, extra = {}) => ({ id, name: id, venue: venue.name, working: true, time, ...extra });

test("early club cards do not report a partial roster as empty or complete", () => {
  for (const dancers of [[], [dancer("first", 0)]]) {
    for (const render of Object.values(fixture(dancers, true))) {
      const markup = render();
      assert.match(markup, /Loading dancers/);
      assert.doesNotMatch(markup, /No dancers checked in right now|aria-label="\d+ dancers? working now"/);
    }
  }
});

test("mobile and desktop club circles retain the five highest server-ranked eligible dancers", () => {
  // Public discovery supplies descending Overall Performance order, with its
  // stable ID tie-break. Ineligible dancers can be interleaved in that list.
  const dancers = [dancer("offline", 0, { working: false }), dancer("other-club", 0, { venue: "Elsewhere" }),
    dancer("unapproved", 0, { approved: false }), ...Array.from({ length: 7 }, (_, i) => dancer("rank-" + (i + 1), 700 - i * 100))];
  const original = structuredClone(dancers), f = fixture(dancers);
  for (const render of Object.values(f)) {
    const markup = render();
    assert.deepEqual(avatarIds(markup), ["rank-1", "rank-2", "rank-3", "rank-4", "rank-5"]);
    assert.match(markup, /aria-label="7 dancers working now"/);
    assert.match(markup, /aria-label="2 more dancers working now"/);
    assert.equal((markup.match(/data-working-now="true"/g) || []).length, 5);
  }
  assert.deepEqual(dancers, original, "Rendering must not reorder the shared market");
});

test("score refreshes and checkout replace the lineup while stable ties retain server order", () => {
  const dancers = Array.from({ length: 6 }, (_, i) => dancer("rank-" + (i + 1), 600 - i * 100));
  const f = fixture(dancers);
  const promoted = dancers.pop();
  dancers.unshift(promoted);
  dancers[1].working = false;
  for (const render of Object.values(f)) assert.deepEqual(avatarIds(render()), ["rank-6", "rank-2", "rank-3", "rank-4", "rank-5"]);
});

test("small and empty working lineups never fill green circles with offline dancers", () => {
  for (const count of [0, 1, 3, 5]) {
    const dancers = [...Array.from({ length: count }, (_, i) => dancer("rank-" + i, i)), dancer("offline", 0, { working: false })];
    const f = fixture(dancers);
    for (const render of Object.values(f)) {
      const markup = render();
      assert.equal(avatarIds(markup).length, count);
      assert.doesNotMatch(markup, /more dancers working now/);
      if (!count) assert.match(markup, /No dancers checked in right now/);
    }
  }
});
