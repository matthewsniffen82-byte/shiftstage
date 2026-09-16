import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const [panels, shared, route] = await Promise.all([
  readFile(new URL("../app/dashboard/DancerDashboardPanels.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardShared.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
]);
function declaration(source, name) {
  const file = ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = file.statements.find(statement => statement.name?.text === name);
  assert.ok(node, `Missing production declaration: ${name}`);
  return node.getText(file).replace(/^export /, "");
}
function evaluate(source, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, Error, ...globals });
  return exports;
}

// Run the actual route's identity validation/update block against fixture profiles.
const updateBlock = route.slice(route.indexOf("const update: Record<string, string | boolean> = {};"), route.indexOf('if (typeof body.isPublic === "boolean")', route.indexOf("const update: Record")));
assert.ok(updateBlock.includes("requireDancerSignupCity"));
class CityInputError extends Error {}
const cities = ["Las Vegas", "Miami"];
const { identityUpdate } = evaluate(`
  const MIN_DANCER_STAGE_NAME_LENGTH = 2, MAX_DANCER_STAGE_NAME_LENGTH = 40;
  ${declaration(route, "ProfileInputError")}
  ${declaration(route, "normalizeDancerStageName")}
  export async function identityUpdate(body) { ${updateBlock} return update; }
`, {
  DancerSignupCityInputError: CityInputError,
  createAdminSupabaseClient: () => ({}),
  requireDancerSignupCity: async (_db, city) => {
    if (!cities.includes(city)) throw new CityInputError("Choose an available city.");
    return city;
  },
});
const component = `${declaration(shared, "persistedDancerStageName")}\n${declaration(panels, "DancerSetupPanel")}\nexport { DancerSetupPanel };`;
const saveEvent = "mydancr:dancer-profile-editor-save";

// Exercise production hooks and Save handlers using local fixture storage and requests.
function editor({ field, profile = { id: "fixture", stage_name: "Placeholder", city: "" }, storage = new Map(), fail = false } = {}) {
  const slots = [], requests = [], listeners = new Map();
  let cursor = 0, effects = [], dirty = true, tree;
  const onProfileChange = next => { profile = next; dirty = true; };
  const { DancerSetupPanel } = evaluate(component, {
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
    AbortController,
    DANCER_PROFILE_EDITOR_SAVE_EVENT: saveEvent,
    readSession: () => ({ accessToken: "fixture" }),
    safeErrorMetadata: () => ({}),
    window: {
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: name => listeners.delete(name),
    },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, cities: cities.map(value => ({ value, label: value })) }) }),
    requestDancerProfileJson: async options => {
      assert.equal(options.method, "PATCH");
      const payload = JSON.parse(options.body);
      requests.push(payload);
      if (fail) throw new Error("Connection lost. Try again.");
      return { profile: { ...profile, ...await identityUpdate(payload) }, deletedPhotoIds: [] };
    },
  });
  function render() {
    for (let count = 0; dirty && count < 20; count++) {
      dirty = false; cursor = 0; effects = [];
      tree = DancerSetupPanel({ field, profile, onProfileChange, unifiedSave: true });
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false, "editor updates must settle");
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  }
  render();
  return {
    requests, storage,
    get profile() { return profile; },
    get fields() { return nodes().filter(node => ["input", "select"].includes(node.type)); },
    get message() { return nodes().find(node => node.props?.role === "status")?.props.children; },
    change(type, value) {
      nodes().find(node => node.type === type).props.onChange({ target: { value } });
      render();
    },
    async ready() { await new Promise(resolve => setImmediate(resolve)); render(); },
    async save() {
      const detail = { tasks: [] };
      listeners.get(saveEvent)({ detail });
      assert.equal(detail.tasks.length, 1);
      const result = await detail.tasks[0]();
      render();
      return result;
    },
  };
}

test("stage name opens alone and saves before a city has been chosen", async () => {
  const ui = editor({ field: "stageName" });
  await ui.ready();
  assert.deepEqual(ui.fields.map(node => node.type), ["input"]);
  assert.equal(ui.fields[0].props.value, "");
  ui.change("input", "  Luna  Rose  ");
  assert.equal(await ui.save(), true);
  assert.equal(Object.hasOwn(ui.requests[0], "city"), false);
  assert.equal(ui.profile.stage_name, "Luna Rose");
  assert.ok(ui.profile.identity_saved_at);
  assert.equal(ui.profile.city, "");
  assert.equal(ui.fields[0].props.value, "Luna Rose");
  assert.equal(ui.storage.size, 0);
});

test("city opens alone and saves without accepting the generated placeholder name", async () => {
  const ui = editor({ field: "city" });
  await ui.ready();
  assert.deepEqual(ui.fields.map(node => node.type), ["select"]);
  ui.change("select", "Las Vegas");
  assert.equal(await ui.save(), true);
  assert.equal(Object.hasOwn(ui.requests[0], "stageName"), false);
  assert.equal(ui.profile.city, "Las Vegas");
  assert.equal(ui.profile.identity_saved_at, undefined);
  const nameEditor = editor({ field: "stageName", profile: ui.profile });
  assert.equal(nameEditor.fields[0].props.value, "");
});

test("either field can be saved first and both persist after reopening", async () => {
  for (const first of ["stageName", "city"]) {
    const second = first === "stageName" ? "city" : "stageName";
    let profile;
    for (const field of [first, second]) {
      const ui = editor({ field, profile });
      await ui.ready();
      ui.change(field === "city" ? "select" : "input", field === "city" ? "Miami" : "Luna");
      assert.equal(await ui.save(), true);
      profile = ui.profile;
    }
    const reopened = editor({ profile });
    await reopened.ready();
    assert.deepEqual(reopened.fields.map(node => node.props.value), ["Luna", "Miami"]);
  }
});

test("saving one field preserves an unfinished draft in the other", async () => {
  const key = "mydancr:dancer-profile-draft:fixture";
  for (const field of ["stageName", "city"]) {
    const storage = new Map([[key, JSON.stringify({ stageName: "Luna", city: "Miami" })]]);
    const ui = editor({ field, storage });
    await ui.ready();
    assert.equal(await ui.save(), true);
    assert.deepEqual(JSON.parse(storage.get(key)), { stageName: "Luna", city: "Miami" });
    assert.equal(field === "city" ? ui.profile.stage_name : ui.profile.city, field === "city" ? "Placeholder" : "");
  }
});

test("a failed save keeps the entered value and draft available to retry", async () => {
  const ui = editor({ field: "stageName", fail: true });
  await ui.ready();
  ui.change("input", "Luna");
  assert.equal(await ui.save(), false);
  assert.equal(ui.fields[0].props.value, "Luna");
  assert.equal(ui.storage.size, 1);
  assert.equal(ui.profile.identity_saved_at, undefined);
  assert.match(ui.message, /Connection lost/);
});

test("separate saves retain server validation for names and active cities", async () => {
  await assert.rejects(identityUpdate({ stageName: "" }), /Stage name is required/);
  await assert.rejects(identityUpdate({ city: "Unknown city" }), /Choose an available city/);
});

test("saving a stage name alone does not let an incomplete profile publish", async () => {
  const { submitProfileForReview } = evaluate(`${declaration(route, "submitProfileForReview")}\nexport { submitProfileForReview };`, {
    createAdminSupabaseClient: () => { throw new Error("Incomplete profiles must stop before publication queries"); },
  });
  const nameOnly = await identityUpdate({ stageName: "Luna" });
  await assert.rejects(submitProfileForReview({}, "owner", "fixture", {
    stageName: nameOnly.stage_name, identitySavedAt: nameOnly.identity_saved_at, city: "",
  }), /Save stage name and city/);
  await assert.rejects(submitProfileForReview({}, "owner", "fixture", {
    stageName: "Placeholder", city: "Miami",
  }), /Save stage name and city/);
});
