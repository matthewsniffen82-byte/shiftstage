import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../src/live-shell/app/venue-state-picker.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/live-shell/shell.html", import.meta.url), "utf8");
const markup = html.match(/<select id="venueRequestState"[^>]*>[\s\S]*?<\/select>/)[0];
const states = [...markup.matchAll(/<option value="([A-Z]{2})" aria-label="([^"]+)">([^<]+)<\/option>/g)];

function fixture(value = "") {
  const microtasks = [];
  const nodes = {};
  class Element {
    constructor(id = "") {
      this.id = id; this.hidden = true; this.dataset = {}; this.attributes = {};
      this.listeners = {}; this.children = []; this.events = [];
      this.scrollTop = 0; this.clientHeight = 240; this.offsetHeight = 44;
      this.classes = new Set();
      this.classList = { add: name => this.classes.add(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    dispatchEvent(event) { this.events.push(event); this.listeners[event.type]?.forEach(callback => callback(event)); }
    fire(type, extras = {}) {
      const event = { type, target: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extras };
      this.dispatchEvent(event);
      return event;
    }
    append(child) { child.offsetTop = this.children.length * 44; this.children.push(child); }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    closest() { return this.dataset.state ? this : null; }
    focus() { document.activeElement = this; }
  }
  const document = new Element();
  document.createElement = () => new Element();
  document.getElementById = id => nodes[id];
  for (const suffix of ["Field", "", "Button", "Text", "Options", "Error", "Label"]) {
    const id = `venueRequestState${suffix}`;
    nodes[id] = new Element(id);
  }
  const [field, select, button, text, list, error] = ["Field", "", "Button", "Text", "Options", "Error"].map(suffix => nodes[`venueRequestState${suffix}`]);
  [select, button, list, error].forEach(node => field.append(node));
  select.value = value;
  select.options = states.map(([, code, label]) => ({ value: code, getAttribute: () => label }));
  select.form = new Element();
  select.form.firstInvalid = select;
  select.form.querySelector = () => select.form.firstInvalid;
  vm.runInNewContext(source, { document, Event, Date, queueMicrotask: fn => microtasks.push(fn) });
  return {
    field, select, button, text, list, error, document,
    key: key => button.fire("keydown", { key }),
    choose: code => list.fire("click", { target: list.children.find(option => option.dataset.state === code) }),
    reset() { select.form.fire("reset"); select.value = ""; microtasks.splice(0).forEach(fn => fn()); },
  };
}

test("club state choices contain all 50 abbreviations with accessible full state names", () => {
  const codes = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  assert.deepEqual(states.map(option => option[1]), codes);
  for (const [, code, label, text] of states) {
    assert.equal(text, code);
    assert.ok(label.startsWith(`${code}, `) && label.length > 5);
  }
  assert.match(markup, /autocomplete="address-level1" required/);
  assert.match(markup, /<option value="" disabled selected>Select state<\/option>/);
});

test("opening the field and choosing an abbreviation updates the original submitted value", () => {
  const f = fixture();
  assert.equal(f.button.hidden, false);
  assert.equal(f.list.hidden, true);
  f.button.fire("click");
  assert.equal(f.list.hidden, false);
  assert.equal(f.list.children.length, 50);
  assert.equal(f.button.attributes["aria-expanded"], "true");
  f.choose("NV");
  assert.equal(f.select.value, "NV");
  assert.equal(f.text.textContent, "NV");
  assert.equal(f.list.hidden, true);
  assert.equal(f.document.activeElement, f.button);
  assert.deepEqual(f.select.events.map(event => event.type), ["input", "change"]);
  assert.equal(f.list.children.find(option => option.dataset.state === "NV").attributes["aria-selected"], "true");
  f.button.fire("click"); f.choose("NV");
  assert.equal(f.select.events.length, 2, "Reselecting the same state does not emit changes");
});

test("keyboard navigation, abbreviation search, and dismissal preserve the committed selection", () => {
  const f = fixture("NV");
  f.key("ArrowDown");
  assert.equal(f.button.attributes["aria-activedescendant"], "venue-state-NV");
  f.key("End");
  assert.equal(f.button.attributes["aria-activedescendant"], "venue-state-WY");
  assert.ok(f.list.scrollTop > 0);
  const escape = f.key("Escape");
  assert.equal(escape.stopped, true);
  assert.equal(f.select.value, "NV");
  f.key("c"); f.key("a"); f.key("Enter");
  assert.equal(f.select.value, "CA");
  f.key("ArrowDown"); f.key("Home"); f.key("ArrowDown"); f.key(" ");
  assert.equal(f.select.value, "AK");
  f.button.fire("click");
  assert.equal(f.key("Tab").prevented, undefined);
  assert.equal(f.list.hidden, true);
  f.button.fire("click");
  f.document.fire("pointerdown", { target: {} });
  assert.equal(f.list.hidden, true);
});

test("missing-state validation focuses the visible control and reset clears the display", () => {
  const f = fixture();
  assert.equal(f.select.fire("invalid").prevented, true);
  assert.equal(f.error.hidden, false);
  assert.equal(f.button.attributes["aria-invalid"], "true");
  assert.equal(f.document.activeElement, f.button);
  f.choose("NY");
  assert.equal(f.error.hidden, true);
  assert.equal(f.button.attributes["aria-invalid"], undefined);
  f.button.fire("click"); f.reset();
  assert.equal(f.text.textContent, "Select state");
  assert.equal(f.list.hidden, true);
  assert.ok(f.list.children.every(option => option.attributes["aria-selected"] === "false"));
  f.document.activeElement = null;
  f.select.form.firstInvalid = {};
  f.select.fire("invalid");
  assert.equal(f.document.activeElement, null, "An earlier invalid field retains first focus");
  f.select.value = "HI"; f.select.fire("change");
  assert.equal(f.text.textContent, "HI");
  assert.equal(f.error.hidden, true);
});
