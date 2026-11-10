import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { savedClubFixture } from "./helpers/saved-club-render.mjs";

const source = readFileSync(new URL("../src/live-shell/app/08-save-customer-deal-pass.js", import.meta.url), "utf8");
const shareState = source.match(/    function setShareButtonState\([\s\S]*?\n    }/)[0];

for (const club of [true, false]) test(`${club ? "Club" : "Dancer"} sharing changes the icon while preserving its button face`, () => {
  const attributes = new Map([["aria-label", "Share Test Club club profile"]]);
  const classes = new Set([club ? "venue-detail-share" : "profile-share-action"]);
  const timers = new Map();
  let nextTimer = 0;
  const button = {
    dataset: {}, disabled: false, innerHTML: "", isConnected: true,
    classList: { contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
  };
  const context = vm.createContext({
    actionButtonLabel: (icon, label) => `<span data-icon="${icon}"></span><span>${label}</span>`,
    profileActionButtonMarkup: (icon, label) => `<span class="profile-action-main"><span data-icon="${icon}"></span><span>${label}</span></span>`,
    window: {
      setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: id => timers.delete(id),
    },
  });
  vm.runInContext(shareState, context);
  const setState = state => context.setShareButtonState(button, state);
  setState("open");
  assert.match(button.innerHTML, /data-icon="close"/);
  setState("sharing");
  assert.equal(button.disabled, true);
  assert.equal(attributes.get("aria-busy"), "true");
  assert.equal(attributes.get("aria-label"), club ? "Sharing club profile" : "Sharing profile");
  assert.equal(classes.has("is-confirmed"), false);
  setState("confirmed");
  assert.equal(button.disabled, false);
  assert.equal(attributes.get("aria-label"), club ? "Club profile shared" : "Profile shared");
  assert.equal(attributes.get("aria-busy"), "false");
  assert.equal(classes.has("is-confirmed"), false);
  assert.match(button.innerHTML, /data-icon="check"/);
  assert.equal(button.innerHTML.includes("profile-action-main"), !club);
  assert.equal(timers.size, 1);
  timers.values().next().value();
  assert.equal(attributes.get("aria-label"), "Share Test Club club profile");
  assert.equal(classes.has("is-confirmed"), false);
  assert.match(button.innerHTML, /data-icon="share"/);
  setState("copying");
  assert.equal(button.disabled, true);
  setState("copied");
  assert.match(button.innerHTML, /data-icon="check"/);
  assert.equal(attributes.get("aria-label"), "Link copied");
  setState("sharing");
  setState("idle");
  assert.equal(button.disabled, false);
  assert.equal(classes.has("is-confirmed"), false);
  assert.equal(attributes.get("aria-label"), "Share Test Club club profile");
});

test("a saved club switches the follow icon as soon as unfollowing starts", () => {
  const button = props => savedClubFixture({}, props).markup().match(/<button[^>]*data-venue-follow[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(button({}), /aria-pressed="true".*data-action-icon="clubCheck"/);
  const pending = button({ removing: true, pending: true });
  assert.match(pending, /aria-pressed="false".*data-action-icon="clubPlus"/);
});
