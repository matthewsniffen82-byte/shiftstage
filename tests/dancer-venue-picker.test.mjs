import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/dashboard/DancerVenuePicker.tsx", import.meta.url), "utf8");
const venues = [{ id: "echo", name: "Echo House" }, { id: "neon", name: "Neon Club" }, { id: "silver", name: "Silver Circuit" }];
function fixture(overrides = {}) {
  const states = [], effects = [], listeners = new Map(), changes = [];
  let stateIndex = 0, effectIndex = 0, focused = 0;
  const node = { contains: target => target === node, querySelector: () => ({ scrollIntoView() {} }), focus: () => { focused++; }, getBoundingClientRect: () => ({ top: overrides.fieldTop ?? 100, bottom: (overrides.fieldTop ?? 100) + 44 }), closest: () => null };
  const exports = {};
  const hooks = {
    useId: () => "picker",
    useRef: () => ({ current: node }),
    useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value; }]; },
    useEffect(fn, dependencies) {
      const index = effectIndex++;
      if (JSON.stringify(effects[index]?.dependencies) === JSON.stringify(dependencies)) return;
      effects[index]?.cleanup?.();
      effects[index] = { dependencies, cleanup: fn() };
    },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: name => name === "react" ? hooks : { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    document: { addEventListener: (key, handler) => listeners.set(key, handler), removeEventListener: key => listeners.delete(key) },
    window: { innerHeight: 852 },
  });
  const props = { venues, value: "echo", onChange: value => changes.push(value), ...overrides };
  const draw = () => { stateIndex = 0; effectIndex = 0; return exports.default(props); };
  let tree = draw();
  return {
    changes, listeners, node,
    get tree() { return tree; },
    get trigger() { return tree.props.children[1]; },
    get options() { return tree.props.children[2]?.props.children || []; },
    get focused() { return focused; },
    draw() { tree = draw(); },
    key(key) { tree.props.onKeyDown({ key, preventDefault() {}, stopPropagation() {} }); tree = draw(); },
  };
}

test("the venue selector uses a compact in-page list instead of a native select", () => {
  const m = fixture();
  assert.equal(m.trigger.type, "button");
  assert.equal(m.trigger.props.role, "combobox");
  assert.equal(m.trigger.props["aria-expanded"], false);
  assert.equal(m.trigger.props.children[0].props.children, "Echo House");
  assert.equal(m.options.length, 0);
  m.trigger.props.onClick(); m.draw();
  assert.equal(m.trigger.props["aria-expanded"], true);
  assert.equal(m.options.length, 3);
  assert.equal(m.options[0].props["aria-selected"], true);
  assert.deepEqual(m.changes, []);
  m.options[1].props.onClick(); m.draw();
  assert.deepEqual(m.changes, ["neon"]);
  assert.equal(m.options.length, 0);
  assert.equal(m.focused, 1);
});

test("arrows, Home, End and Enter select the focused approved venue", () => {
  const m = fixture();
  m.key("ArrowDown"); m.key("ArrowDown");
  assert.equal(m.trigger.props["aria-activedescendant"], "picker-option-1");
  m.key("End");
  assert.equal(m.trigger.props["aria-activedescendant"], "picker-option-2");
  m.key("Home"); m.key("ArrowUp"); m.key("Enter");
  assert.deepEqual(m.changes, ["silver"]);
  assert.equal(m.options.length, 0);
});

test("typing a club initial and Space can choose without submitting the schedule form", () => {
  const m = fixture();
  m.key("n");
  assert.equal(m.trigger.props["aria-activedescendant"], "picker-option-1");
  m.key(" ");
  assert.deepEqual(m.changes, ["neon"]);
  assert.ok(m.options.every(option => option.props.type === "button"));
});

test("Escape, Tab, outside taps and moving focus away dismiss without changing the venue", () => {
  for (const method of ["Escape", "Tab", "pointer", "blur"]) {
    const m = fixture();
    m.key("ArrowDown"); m.key("End");
    if (method === "pointer") { m.listeners.get("pointerdown")({ target: {} }); m.draw(); }
    else if (method === "blur") { m.tree.props.onBlur({ currentTarget: m.node, relatedTarget: {} }); m.draw(); }
    else m.key(method);
    assert.equal(m.options.length, 0);
    assert.deepEqual(m.changes, []);
    assert.equal(m.listeners.size, 0);
  }
});

test("empty and disabled venue lists cannot open or change the selection", () => {
  for (const props of [{ venues: [], value: "" }, { disabled: true }]) {
    const m = fixture(props);
    assert.equal(m.trigger.props.disabled, true);
    m.key("Enter"); m.key("ArrowDown");
    assert.equal(m.options.length, 0);
    assert.deepEqual(m.changes, []);
  }
});

test("new and edited dates use the same picker with only the authorized venue list", () => {
  const manager = readFileSync(new URL("../app/dashboard/DancerShiftManager.tsx", import.meta.url), "utf8");
  assert.match(manager, /<DancerVenuePicker venues=\{venues\} value=\{venueId\} onChange=\{setVenueId\} disabled=\{saving\}/);
  assert.match(manager, /<DancerVenuePicker venues=\{venues\} value=\{editVenueId\} onChange=\{setEditVenueId\} disabled=\{saving\}/);
  assert.doesNotMatch(manager, /<select|api\/public\/venues/);
  const css = readFileSync(new URL("../app/dashboard/dancer-venue-picker.css", import.meta.url), "utf8");
  assert.match(css, /max-height:min\(224px, 40dvh\)/);
  assert.match(css, /overflow-y:auto/);
});

test("a picker near the bottom opens above the field to keep the club list visible", () => {
  const m = fixture({ fieldTop: 700 });
  m.key("ArrowDown");
  assert.match(m.tree.props.children[2].props.className, /is-above/);
});
