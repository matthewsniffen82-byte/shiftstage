import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../src/live-shell/app/19-reset-home-discovery-feed-qr-prompt.js");
const events = read("../src/live-shell/app/22-create-home-tv-landing-preloader.js");
const window = {};
vm.runInNewContext(read("../public/dancer-grid-card.js"), { window });
const { render, escape } = window.MydancrDancerGrid;
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
const quickFollowSource = section(home, "    function homeDancerGridQuickFollowMarkup(", "    function homeDancerGridCard(");
const card = {
  id: "dancer-id", name: "Star", reference: "star", href: "/dancers/star", compact: true,
  groupClass: "is-now", scheduleLabel: "Working now", photoMarkup: '<img src="original.jpg" alt="Star">',
  cityMarkup: '<span class="home-dancer-grid-city">Las Vegas</span>',
  venueMarkup: '<span class="home-dancer-grid-venue">Spearmint Rhino</span>',
  distanceMarkup: '<span class="home-dancer-grid-distance">3 mi</span>',
};

test("compact public cards keep their portrait and show name, working dot, then club", () => {
  const markup = render(card);
  assert.ok(markup.includes(card.photoMarkup));
  assert.match(markup, /<h3 class="home-dancer-grid-name"><span class="home-dancer-grid-name-text">Star<\/span><span class="home-dancer-grid-availability" role="img" aria-label="Working now" title="Working now"><\/span><\/h3>/);
  assert.ok(markup.includes(card.venueMarkup));
  assert.doesNotMatch(markup, /home-dancer-grid-(?:status|city|distance)/);
});

test("offline cards omit the green dot and missing clubs fall back to the city", () => {
  const markup = render({ ...card, groupClass: "is-open", scheduleLabel: "Not working now", venueMarkup: "" });
  assert.doesNotMatch(markup, /home-dancer-grid-availability/);
  assert.match(markup, /aria-label="Star, Not working now"/);
  assert.ok(markup.includes(card.cityMarkup));
});

test("name and status remain escaped, and follow sits outside the profile link", () => {
  const button = '<button type="button" data-feed-action="follow">Follow</button>';
  const markup = render({ ...card, name: '<Star "One">', scheduleLabel: 'Working "now"', quickFollowMarkup: button });
  assert.match(markup, /&lt;Star &quot;One&quot;&gt;/);
  assert.match(markup, /aria-label="Working &quot;now&quot;"/);
  assert.ok(markup.includes(`</a>${button}`));
  assert.equal(markup.slice(markup.indexOf(button) + button.length).trim(), "</article>");
  assert.ok(markup.indexOf(button) > markup.indexOf("</a>"), "No nested interactive button/link");
  assert.match(render({ ...card, href: "javascript:alert(1)" }), /href="#"/);
});

test("noncompact cards retain their existing details and embeds do not gain social controls", () => {
  const markup = render({ ...card, compact: false, quickFollowMarkup: "UNEXPECTED-FOLLOW", actionsMarkup: "LEGACY-ACTIONS" });
  for (const detail of [card.cityMarkup, card.venueMarkup, card.distanceMarkup, "home-dancer-grid-status", "LEGACY-ACTIONS"]) assert.ok(markup.includes(detail));
  assert.doesNotMatch(markup, /home-dancer-grid-availability|UNEXPECTED-FOLLOW/);
  assert.doesNotMatch(render(card), /<button|data-feed-action/);
  assert.doesNotMatch(read("../public/venue-grid-embed.js"), /quickFollowMarkup/);
});

for (const following of [false, true]) {
  test(`quick-follow renders ${following ? "following" : "unfollowed"} state using the dancer ID and city`, () => {
    const calls = [];
    const context = vm.createContext({ escapeOptionValue: escape, actionIconMarkup: icon => `<span>${icon}</span>`, isFollowingProfile: (...args) => { calls.push(args); return following; } });
    vm.runInContext(quickFollowSource, context);
    const markup = context.homeDancerGridQuickFollowMarkup({ id: "dancer-id", name: 'Star "One"', city: "Las Vegas" }, "All cities");
    assert.deepEqual(calls, [["Las Vegas", "dancer-id"]]);
    assert.match(markup, /type="button" data-feed-action="follow" data-icon-only-action="true" data-profile="dancer-id"/);
    assert.ok(markup.includes(`aria-pressed="${following}"`));
    assert.ok(markup.includes(`aria-label="${following ? "Following" : "Follow"} Star &quot;One&quot;"`));
    assert.ok(markup.includes(`<span>${following ? "check" : "personPlus"}</span>`));
    assert.equal(context.homeDancerGridQuickFollowMarkup({ name: "Unavailable" }, "Las Vegas"), "");
  });
}

for (const authenticated of [false, true]) {
  test(`quick-follow ${authenticated ? "uses the profile save handler" : "requires the profile account gate"} without opening a profile`, async () => {
    const calls = [];
    const button = { dataset: { feedAction: "follow", profile: "dancer-id" } };
    const event = {
      target: { closest: selector => selector === "[data-feed-action]" ? button : null },
      preventDefault: () => calls.push("prevent"), stopPropagation: () => calls.push("stop"),
    };
    const context = vm.createContext({
      requireCustomerAccountForProfileAction: target => { assert.equal(target, button); calls.push("account"); return authenticated; },
      saveProfileFollow: async target => { assert.equal(target, button); calls.push("save"); },
    });
    const handler = vm.runInContext(`(async function(event) {${section(events, '      const feedActionButton =', '      const cardVenueLink =')} throw new Error("Reached card navigation"); })`, context);
    await handler(event);
    assert.deepEqual(calls, authenticated ? ["prevent", "stop", "account", "save"] : ["prevent", "stop", "account"]);
  });
}

test("quick-follow CSS is overlay-only with a 44px touch target and 32px visible circle", () => {
  const css = postcss.parse(read("../public/dancr-ui-consistency.v1.css"));
  const layer = css.nodes.find(node => node.type === "atrule" && node.params === "dancr-follow-controls.grid-follow");
  assert.ok(layer, "Nested important layer overrides legacy follow-button frames");
  const rules = layer.nodes.filter(node => node.type === "rule");
  const values = rule => Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  const button = values(rules.find(rule => rule.selector.endsWith(" > .home-dancer-grid-quick-follow")));
  assert.equal(button.position, "absolute");
  assert.equal(button.width, "44px");
  assert.equal(button.height, "44px");
  assert.equal(button.background, "transparent");
  assert.equal(button.border, "0");
  assert.equal(values(rules.find(rule => rule.selector.endsWith("::before"))).inset, "6px");
  assert.ok(rules.some(rule => rule.selector.endsWith(":focus-visible")));
  layer.walkRules(rule => assert.ok(rule.selector.includes("#results .home-dancer-grid"), "Never style dashboard/internal cards"));
});
