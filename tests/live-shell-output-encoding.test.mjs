import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync("outputs/index.html", "utf8");
function source(name) {
  const match = html.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"));
  assert.ok(match, name);
  return match[0];
}
function render(name, args, globals = {}) {
  const context = vm.createContext({ URL, ...globals });
  for (const helper of new Set(["escapeHtml", "displayText", "escapeOptionValue", "safeExternalHref", "safeCssUrl", "responsiveCssImageSet", "customPhotoAttrs", "encodeDealPass", name])) vm.runInContext(source(helper), context);
  return context[name](...args);
}
const payloads = ['N" data-injected="yes', '<img src=x data-injected=yes>', "O'Neal & <Club>"];
const fixtures = [
  ["savedDealPassMarkup", value => [{ title: value, venueName: value, dancerName: value, sourceType: "dancer_profile" }], { clubDealQrSymbolMarkup: () => "<svg></svg>" }],
  ["dealPassButtonMarkup", value => [{ venueName: value, dancerName: value, sourceType: "dancer_profile" }, "button"], { clubDealQrSymbolMarkup: () => "<svg></svg>" }],
  ["metricCardMarkup", value => [value, value]],
  ["metricPhraseMarkup", value => ["1 " + value]],
  ["rankingNotificationMarkup", value => [{ type: "up", icon: "↑", title: value, message: value }]],
  ["profileLocationStatusBadge", value => [{ venue: value }], { profileLocationStatusLabel: () => "Checked In" }],
  ["profileLocationStatusTile", value => [{ venue: value }, "Test city"], { profileLocationStatusLabel: () => "Checked In", isWorkingTonight: () => false }],
  ["shiftNotesMarkup", value => [{ notes: value }]],
  ["shareButtonsMarkup", value => [value, value], { profileShareUrl: () => "https://www.mydancr.com/", sharePlatforms: [], actionButtonLabel: () => "Share" }],
  ["adminProfileRow", value => [value, { name: value, status: "Verified", scheduled: true, venue: value, photoStatus: "Approved" }], { normalizeSubmittedSocials: () => [], displayShiftTime: () => "8pm" }],
  ["adminSubscriptionRow", value => [{ dancer: { stageName: value, city: value }, stripeSubscriptionId: value }], { subscriptionStatusLabel: () => "Active", formatBillingDate: () => "", isLiveSubscriptionActive: () => true }],
  ["liveProfileModalActionsMarkup", value => [{ name: value, scheduled: true, shiftId: "synthetic" }, {}], { selectedCity: () => "Test city", isFollowingProfile: () => false, goingTonightSavedByProfile: {}, isWorkingTonight: () => false, escapeOptionValue: value => String(value).replaceAll('"', "&quot;"), profileActionButtonMarkup: () => "Action" }],
];
for (const [name, args, globals] of fixtures) for (const payload of payloads) test(`${name} renders ${payload.startsWith("N") ? "quoted names" : payload.startsWith("<") ? "markup" : "punctuation"} as text`, () => {
  const markup = render(name, args(payload), globals);
  assert.equal(markup.includes(payload), false, "raw user value reached HTML");
  assert.equal(markup.includes('<img src=x data-injected=yes>'), false);
  assert.equal(markup.includes('" data-injected="yes'), false);
  assert.ok(markup.includes("&quot;") || markup.includes("&lt;"), "encoded text is retained");
});
test("CSS media values cannot escape their HTML style attribute", () => {
  for (const url of ['https://example.test/photo" data-injected="yes', "https://example.test/photo'with&punctuation.jpg"]) {
    const result = render("customPhotoAttrs", [url]);
    assert.equal(result.style.includes('" data-injected="yes'), false);
    assert.equal((result.style.match(/"/g) || []).length, 2);
    assert.ok(result.style.includes("&quot;") || result.style.includes("&#39;"));
  }
  assert.equal(render("customPhotoAttrs", ["javascript:alert(1)"]).style, "");
});
test("social markup rejects executable URLs and encodes safe URL attributes", () => {
  const globals = { normalizeSubmittedSocials: () => [], normalizedReviewStatus: () => "approved", socialPlatforms: [{ key: "instagram", label: "Instagram" }], socialIconMarkup: () => "<svg></svg>" };
  for (const url of ["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,test", "vbscript:test"])
    assert.equal(render("socialLinksMarkup", [{ name: "Name", socials: { instagram: url } }], globals), "");
  const markup = render("socialLinksMarkup", [{ name: 'N" data-injected="yes', socials: { instagram: 'https://instagram.com/name?x="quoted"&y=1' } }], globals);
  assert.ok(markup.includes('href="https://instagram.com/'));
  assert.equal(markup.includes('" data-injected="yes'), false);
  assert.match(markup, /&amp;y=1/);
});
test("safe names, symbols and normal image URLs keep their visible values", () => {
  assert.match(render("metricCardMarkup", [0, "Followers"]), /<strong>0<\/strong>/);
  assert.match(render("metricCardMarkup", ["12", "Followers"]), /<strong>12<\/strong><span>Followers<\/span>/);
  const attrs = render("customPhotoAttrs", ["https://example.test/photo.jpg"]);
  assert.equal(attrs.className, " has-custom-photo");
  assert.ok(attrs.style.includes("https://example.test/photo.jpg"));
});

test("public profile cards encode names, venue labels, schedule text and slug attributes", () => {
  const globals = { citySelect: { value: "Test city" }, upcomingCardLabel: () => "Upcoming", isWorkingTonight: () => true,
    profileLocationStatusBadge: () => "", profileCardDistanceLabel: () => "2 mi", displayPublicShiftTime: value => value,
    clockIconMarkup: () => "<svg></svg>", venueIconMarkup: () => "<svg></svg>", publicProfilePhotoUrl: () => "",
    profilePhotoSrcSet: () => "", portraitClass: () => "", slugify: () => "test" };
  for (const payload of payloads) {
    const markup = render("profileCard", [{ name: payload, venue: payload, time: payload, slug: payload, status: "Verified", scheduled: true }, 0], globals);
    assert.equal(markup.includes(payload), false);
    assert.ok(markup.includes(render("escapeHtml", [encodeURIComponent(payload)])));
    assert.equal(markup.includes('" data-injected="yes'), false);
  }
});

test("popular venue controls retain encoded labels and data values", () => {
  for (const payload of payloads) {
    const strip = { innerHTML: "", querySelectorAll: () => [] };
    render("renderPopularClubs", [payload], { document: { getElementById: () => strip }, discoveryMarket: () => ({ venues: [{ name: payload }] }), venueWithinSelectedRadius: () => true });
    assert.equal(strip.innerHTML.includes(payload), false);
    assert.equal(strip.innerHTML.includes('" data-injected="yes'), false);
    assert.ok(strip.innerHTML.includes("&quot;") || strip.innerHTML.includes("&lt;"));
  }
});

test("media style encoding covers responsive images and preserves local previews", () => {
  const result = render("customPhotoAttrs", ["https://example.test/normal.jpg", 'https://example.test/photo"data-injected="yes 320w']);
  assert.equal((result.style.match(/"/g) || []).length, 2);
  assert.ok(result.style.includes("image-set("));
  for (const url of ["blob:https://www.mydancr.com/synthetic", "data:image/png;base64,c3ludGhldGlj"])
    assert.equal(render("customPhotoAttrs", [url]).className, " has-custom-photo");
  assert.equal(render("customPhotoAttrs", ["https://example.test/\nphoto.jpg"]).style, "");
});

test("admin preview refuses executable URLs before rendering or opening", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<h1>fake</h1>", "vbscript:test"]) {
    const body = { innerHTML: "unchanged" }, popover = { hidden: true };
    render("openAdminPreview", [{ kind: "file", url }], { adminPreviewBody: body, adminPreviewPopover: popover, adminPreviewTitle: {}, showToast() {} });
    assert.equal(body.innerHTML, "unchanged");
    assert.equal(popover.hidden, true);
  }
});
