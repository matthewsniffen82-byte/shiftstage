import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = read("src/live-shell/shell.html");
const live = read("src/live-shell/app/12-sync-profile-photo-viewer-window.js");
const page = read("app/dancers/[slug]/page.tsx");
const actions = read("app/dancers/[slug]/DancerProfileActions.tsx");

function inOrder(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.ok(index > previous, `${marker} must follow the preceding content in reading order`);
    previous = index;
  }
}

function render(profile, options = {}) {
  const context = vm.createContext({
    shiftStatus: () => ({}), selectedCity: () => "Las Vegas",
    isWorkingTonight: p => Boolean(p.working), escapeHtml: String,
    dancerClubDealState: () => ({ key: "available" }),
    shiftsMarkup: () => "[live venue]",
    profileDealTileMarkup: () => "[free entry]",
    liveProfileGoingActionsMarkup: () => "[going]",
    internalProfileRequestActionsMarkup: () => "[table request]",
    liveProfileModalActionsMarkup: () => "[follow and share]",
    dancerProfileTonightTravelActionsMarkup: () => "[travel]",
    profileLocationStatusTile: () => "[location status]",
  });
  vm.runInContext(live.match(/    function profileModalGridMarkup\([\s\S]*?\n    }/)[0], context);
  return context.profileModalGridMarkup(profile, options);
}

test("both profile surfaces put identity and venue actions before dynamic metrics and media", () => {
  inOrder(shell, ['class="profile-info-panel"', 'id="modalName"', 'id="modalCity"', 'id="modalBody"', 'id="modalProfileMetrics"', 'id="modalGallery"']);
  inOrder(page, ['className="profile-info-panel"', "<h1>{profile.stageName}", "{profile.city}", "<DancerProfileActions", "<DancerFollowerMetric", "<DancerGoingCount", "profile.profileViewsToday || 0", "<DancerPhotoCarousel"]);
  const controls = actions.slice(actions.indexOf('aria-label="Tonight"'));
  inOrder(controls, ["{children}", 'aria-label="Plan your visit"', 'aria-label="Guest actions"', "{shareControl}"]);
});

test("live venue and visit actions precede social controls in DOM reading and focus order", () => {
  const markup = render({ scheduled: true, working: true });
  inOrder(markup, ["[live venue]", "[free entry]", "[going]", "[follow and share]"]);
  assert.match(markup, /data-profile-shift-state="now"/);
});

test("inactive, internal and preview profiles retain their existing action eligibility", () => {
  const inactive = render({ scheduled: false });
  assert.doesNotMatch(inactive, /\[free entry\]/);
  inOrder(inactive, ["[live venue]", "[going]", "[follow and share]"]);
  const internal = render({ scheduled: true, working: true, internalRoster: true });
  assert.doesNotMatch(internal, /\[(free entry|going|travel)\]/);
  inOrder(internal, ["[live venue]", "[table request]", "[follow and share]"]);
  const preview = render({ scheduled: true, working: true }, { preview: true });
  assert.doesNotMatch(preview, /\[(going|table request|follow and share)\]/);
});
