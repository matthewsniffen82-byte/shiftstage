import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const start = source.indexOf("    function syncDistancePickerDisplay()");
const end = source.indexOf("    function openVenuePicker()", start);
assert.ok(start >= 0 && end > start);

function fixture({ location = null, city = "Las Vegas", enhanced = true } = {}) {
  const events = [];
  const element = (extra = {}) => ({
    hidden: false, attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() { this.focused = true; },
    ...extra,
  });
  const values = ["5 mi", "10 mi", "25 mi", "50 mi"];
  const inputs = values.map(value => element({ value, checked: value === "25 mi" }));
  const select = element({ value: "25 mi", options: values.map(value => ({ value })), dispatchEvent: event => events.push(event) });
  const button = element({ hidden: true });
  const dialog = element({
    open: false,
    ...(enhanced ? { showModal() { this.open = true; } } : {}),
    close() { this.open = false; this.listeners.close?.(); },
    querySelectorAll: () => inputs,
    querySelector: () => inputs.find(input => input.checked),
    getBoundingClientRect: () => ({ left: 12, top: 500, right: 378, bottom: 780 }),
  });
  const context = vm.createContext({
    Event,
    distanceSelect: select,
    distancePickerField: { classList: { add() {} } },
    distanceSelectButton: button,
    distanceSelectButtonText: element(),
    distanceSelectLabel: element(),
    distanceSelectDialog: dialog,
    distanceSelectOrigin: element(),
    distanceSelectForm: element(),
    distanceSelectClose: element(),
    userLocation: location,
    selectedCity: () => city,
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context, select, button, dialog, inputs, events,
    choose(value) { inputs.forEach(input => { input.checked = input.value === value; }); },
    apply() { context.distanceSelectForm.listeners.submit({ preventDefault() {} }); },
  };
}

test("opening the radius picker preserves the current selection and explains its origin", () => {
  for (const [location, city, expected] of [
    [null, "Miami", "From the center of Miami"],
    [{ latitude: 36, longitude: -115 }, "Las Vegas", "From your current location"],
  ]) {
    const f = fixture({ location, city });
    f.context.openDistancePicker();
    assert.equal(f.dialog.open, true);
    assert.equal(f.context.distanceSelectOrigin.textContent, expected);
    assert.equal(f.button.attributes["aria-expanded"], "true");
    assert.equal(f.inputs.find(input => input.focused).value, "25 mi");
    assert.equal(f.events.length, 0);
  }
});

test("a pending distance applies once through the existing filter change event", () => {
  const f = fixture();
  f.context.openDistancePicker();
  f.choose("10 mi");
  assert.equal(f.select.value, "25 mi");
  f.apply();
  assert.equal(f.select.value, "10 mi");
  assert.equal(f.context.distanceSelectButtonText.textContent, "10 mi");
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, "change");
  assert.equal(f.events[0].bubbles, true);
  assert.equal(f.dialog.open, false);
  assert.equal(f.button.focused, true);
  f.context.openDistancePicker();
  f.apply();
  assert.equal(f.events.length, 1, "Applying an unchanged radius does not reload results");
});

test("closing or dismissing the backdrop discards the unconfirmed radius", () => {
  const f = fixture();
  f.context.openDistancePicker();
  f.choose("50 mi");
  f.context.distanceSelectClose.listeners.click();
  assert.equal(f.select.value, "25 mi");
  assert.equal(f.inputs.find(input => input.checked).value, "25 mi");
  assert.equal(f.button.attributes["aria-expanded"], "false");
  f.context.openDistancePicker();
  f.dialog.listeners.click({ target: f.dialog, clientX: 30, clientY: 550 });
  assert.equal(f.dialog.open, true, "Clicks inside the sheet do not dismiss it");
  f.choose("5 mi");
  f.dialog.listeners.click({ target: f.dialog, clientX: 30, clientY: 300 });
  assert.equal(f.dialog.open, false);
  assert.equal(f.select.value, "25 mi");
  assert.equal(f.events.length, 0);
});

test("filter reset updates the trigger from canonical state and reopening selects that radius", () => {
  const f = fixture();
  f.select.value = "50 mi";
  f.context.syncDistancePickerDisplay();
  assert.equal(f.context.distanceSelectButtonText.textContent, "50 mi");
  f.select.value = "25 mi";
  const first = source.indexOf("    function syncHomeFilterToggleState()");
  const last = source.indexOf("    function homeDiscoveryFeedUsesInlineLayout()", first);
  f.context.homeFilterToggle = null;
  vm.runInContext(source.slice(first, last), f.context);
  f.context.syncHomeFilterToggleState();
  assert.equal(f.context.distanceSelectButtonText.textContent, "25 mi");
  f.context.openDistancePicker();
  assert.equal(f.inputs.find(input => input.checked).value, "25 mi");
});

test("only supported radii can apply and older browsers retain the original select", () => {
  const f = fixture();
  f.context.openDistancePicker();
  f.inputs.find(input => input.checked).value = "500 mi";
  f.apply();
  assert.equal(f.select.value, "25 mi");
  assert.equal(f.events.length, 0);
  const fallback = fixture({ enhanced: false });
  assert.equal(fallback.select.hidden, false);
  assert.equal(fallback.button.hidden, true);
  assert.equal(f.select.hidden, true);
  assert.equal(f.button.hidden, false);
});
