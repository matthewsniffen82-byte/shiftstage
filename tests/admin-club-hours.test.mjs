import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/admin/AdminClubHoursFields.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];

function fixture(opensAt = "20:00:00", closesAt = "04:00:00", busy = false, openDays, onHoursChange) {
  const exports = {}, slots = [];
  let cursor = 0;
  vm.runInNewContext(code, { exports, require: name => name === "react" ? {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
  } : require(name) });
  const render = () => { cursor = 0; return exports.default({ opensAt, closesAt, busy, openDays, onHoursChange }); };
  const controls = () => walk(render()).filter(node => node.type === "input" || node.type === "select");
  const change = (name, value) => controls().find(node => node.props.name === name).props.onChange({ target: { value } });
  const hours = () => Object.fromEntries(controls().filter(node => ["opensAt", "closesAt"].includes(node.props.name))
    .map(node => [node.props.name, node.props.value]));
  return { render, controls, change, hours };
}

test("24 hours submits midnight times and preserves custom edits when toggled back before saving", () => {
  const f = fixture();
  f.change("opensAt", "21:30");
  f.change("closesAt", "05:15");
  f.change("clubHoursMode", "24-hours");
  assert.deepEqual(f.hours(), { opensAt: "00:00", closesAt: "00:00" });
  assert.equal(f.controls().filter(node => node.props.type === "time").length, 0);
  assert.match(renderToStaticMarkup(f.render()), /<option value="24-hours" selected="">24 hours<\/option>/);
  f.change("clubHoursMode", "custom");
  assert.deepEqual(f.hours(), { opensAt: "21:30", closesAt: "05:15" });
});

test("reopening saved 24-hour clubs recognizes midnight and legacy equal times", () => {
  for (const [opens, closes] of [["00:00:00", "00:00"], ["08:30:00", "08:30:00"]]) {
    const f = fixture(opens, closes);
    assert.equal(f.controls()[0].props.value, "24-hours");
    assert.deepEqual(f.hours(), { opensAt: "00:00", closesAt: "00:00" });
    f.change("clubHoursMode", "custom");
    assert.deepEqual(f.hours(), { opensAt: "", closesAt: "" });
    f.change("opensAt", "19:00");
    f.change("closesAt", "03:00");
    assert.deepEqual(f.hours(), { opensAt: "19:00", closesAt: "03:00" });
  }
});

test("blank and invalid hours are not mistaken for 24-hour opening", () => {
  for (const [opens, closes] of [["", ""], ["20:00:00", ""], ["25:00:00", "25:00:00"]]) {
    assert.equal(fixture(opens, closes).controls()[0].props.value, "custom");
  }
  assert.deepEqual(fixture("", "").hours(), { opensAt: "", closesAt: "" });
});

test("saving locks hours controls and cancel remounts them using the latest saved values", () => {
  for (const f of [fixture("20:00", "04:00", true), fixture("00:00", "00:00", true)]) {
    assert.equal(f.controls()[0].props.disabled, true);
    for (const input of f.controls().filter(node => node.props.type === "time")) {
      assert.equal(input.props.readOnly, true);
    }
  }
  const admin = readFileSync(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8");
  assert.match(admin, /onReset=\{\(\) => \{ clearPageDraft\(venueId\); setHoursResetByVenue/);
  assert.match(admin, /AdminClubHoursFields key=\{JSON\.stringify\(\[venue\.opens_at, venue\.closes_at, venue\.open_days, hoursResetByVenue\[venueId\]\]\)\}/);
});

test("open days load from the saved schedule, persist across hour modes and update draft recovery immediately", () => {
  const changes = [];
  const f = fixture("20:00", "04:00", false, [5, 6], hours => changes.push(hours));
  const selected = () => f.controls().filter(node => node.props.type === "checkbox" && node.props.checked).map(node => node.props.value);
  assert.deepEqual(selected(), [5, 6]);
  f.controls().find(node => node.props.type === "checkbox" && node.props.value === 0).props.onChange({ target: { checked: true, form: null } });
  assert.equal(changes.at(-1).openDays, "0,5,6");
  f.change("clubHoursMode", "24-hours");
  assert.deepEqual(selected(), [5, 6, 0]);
  assert.equal(changes.at(-1).openDays, "0,5,6");
  assert.equal(changes.at(-1).opensAt, "00:00");
  f.change("clubHoursMode", "custom");
  assert.deepEqual(f.hours(), { opensAt: "20:00", closesAt: "04:00" });
});

test("new and legacy schedules default to all days; clearing every day requires a selection", () => {
  const f = fixture();
  assert.equal(f.controls().filter(node => node.props.type === "checkbox" && node.props.checked).length, 7);
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    f.controls().find(node => node.props.type === "checkbox" && node.props.value === day).props.onChange({ target: { checked: false, form: null } });
  }
  assert.equal(f.controls().find(node => node.props.name === "openDays").props.value, "");
  assert.equal(f.controls().filter(node => node.props.required).length, 1);
  assert.match(renderToStaticMarkup(f.render()), /Select at least one open day/);
  assert.equal(walk(fixture("20:00", "04:00", true).render()).find(node => node.type === "fieldset").props.disabled, true);
});
