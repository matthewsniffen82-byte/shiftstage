import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/live-shell/app/08-save-customer-deal-pass.js", import.meta.url), "utf8");
const shareState = source.match(/    function setVenueShareButtonState\([\s\S]*?\n    }/)[0];

test("club sharing announces pending, confirmed and restored states without losing its compact markup", () => {
  const attributes = new Map([["aria-label", "Share Test Club club profile"]]);
  const classes = new Set(["venue-detail-share"]);
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
    window: {
      setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: id => timers.delete(id),
    },
  });
  vm.runInContext(shareState, context);
  const setState = state => context.setVenueShareButtonState(button, state);
  setState("sharing");
  assert.equal(button.disabled, true);
  assert.equal(attributes.get("aria-busy"), "true");
  assert.equal(attributes.get("aria-label"), "Sharing club profile");
  assert.equal(classes.has("is-confirmed"), false);
  setState("confirmed");
  assert.equal(button.disabled, false);
  assert.equal(attributes.get("aria-label"), "Club profile shared");
  assert.equal(attributes.get("aria-busy"), "false");
  assert.equal(classes.has("is-confirmed"), true);
  assert.match(button.innerHTML, /^<span class="profile-action-main">.*data-icon="check"/);
  assert.equal(timers.size, 1);
  timers.values().next().value();
  assert.equal(attributes.get("aria-label"), "Share Test Club club profile");
  assert.equal(classes.has("is-confirmed"), false);
  assert.match(button.innerHTML, /data-icon="share"/);
  setState("sharing");
  setState("idle");
  assert.equal(button.disabled, false);
  assert.equal(classes.has("is-confirmed"), false);
  assert.equal(attributes.get("aria-label"), "Share Test Club club profile");
});
