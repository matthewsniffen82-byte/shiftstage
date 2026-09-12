import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function functions(file, names, globals = {}) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(selected.length, names.length);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(selected.map(node => node.getText(ast)).join("\n")
    + "\nexport {" + names.join(",") + "};", { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, Number, Error, console: { warn() {} }, safeErrorMetadata: () => ({}),
    require(name) { assert.equal(name, "react/jsx-runtime"); return require(name); }, ...globals });
  return exports;
}

const { countTable } = functions("src/lib/dancr/admin.ts", ["countTable"]);
for (const [name, count] of [["missing", undefined], ["null", null], ["negative", -1], ["fractional", 1.5],
  ["nonfinite", Infinity], ["NaN", NaN], ["string", "4"], ["boolean", true], ["object", {}],
  ["unsafe integer", Number.MAX_SAFE_INTEGER + 1]]) {
  test(`unknown monitoring count remains unavailable: ${name}`, async () => {
    const client = { from() { return { select: async () => ({ count, error: null }) }; } };
    const result = await countTable(client, "synthetic_table");
    assert.equal(result.ok, false);
    assert.equal(result.count, null);
    assert.equal(result.error, "Monitoring query failed.");
  });
}
for (const count of [0, 4, Number.MAX_SAFE_INTEGER]) {
  test(`acknowledged count ${count} remains available`, async () => {
    const result = await countTable({ from() { return { select: async () => ({ count, error: null }) }; } }, "synthetic_table");
    assert.equal(result.ok, true);
    assert.equal(result.count, count);
  });
}
test("database failure remains private and cannot report its accompanying count", async () => {
  const result = await countTable({ from() { return { select: async () => ({ count: 4, error: {message: "synthetic-private-database-detail"} }) }; } }, "synthetic_table");
  assert.equal(result.ok, false);
  assert.equal(result.count, null);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
});

const { SystemHealthSummary } = functions("app/admin/AdminClient.tsx", ["SystemHealthSummary", "asRecordArray"], {
  Panel: ({ badge, children }) => React.createElement("section", { "data-badge": badge }, children),
});
function render(monitoring, warnings = []) {
  return renderToStaticMarkup(React.createElement(SystemHealthSummary, { monitoring, warnings, onOpenSystem() {} }));
}
const integration = { name: "Synthetic provider", ok: true, required: ["SYNTHETIC_KEY"] };
const database = { name: "Synthetic table", ok: true, count: 0 };
for (const [name, monitoring] of [
  ["not loaded", null], ["empty", {}], ["no checks", {integrations: [], database: []}],
  ["missing integration result", {integrations: [{name: "Synthetic provider"}], database: [database]}],
  ["unknown database count", {integrations: [integration], database: [{...database, count: null}]}],
  ["malformed discarded record", {integrations: [integration, null], database: [database]}],
]) {
  test(`unavailable monitoring never displays a healthy indicator: ${name}`, () => {
    const markup = render(monitoring);
    assert.doesNotMatch(markup, /health-dot healthy|Core services are operational/);
    assert.match(markup, /Status checks unavailable/);
    assert.match(markup, /data-badge="Not confirmed"/);
  });
}
for (const [name, monitoring] of [
  ["missing provider keys", {integrations: [{...integration, ok: false}], database: [database]}],
  ["failed database without text", {integrations: [integration], database: [{...database, ok: false, count: null}]}],
  ["failed database with text", {integrations: [integration], database: [{...database, ok: false, count: null, error: "Monitoring query failed."}]}],
]) {
  test(`current API failure flags are shown as one issue: ${name}`, () => {
    const markup = render(monitoring);
    assert.doesNotMatch(markup, /health-dot healthy|Core services are operational/);
    assert.match(markup, /data-badge="1 issue"/);
    assert.match(markup, /Checks need attention/);
  });
}
test("successful settings/count checks are not described as provider connectivity", () => {
  const markup = render({integrations: [integration], database: [database]});
  assert.match(markup, /health-dot healthy/);
  assert.match(markup, /Last checks passed/);
  assert.match(markup, /1 integration setting\b/);
  assert.match(markup, /1 database check\b/);
  assert.doesNotMatch(markup, /Core services are operational/);
});
test("operational warnings remain visible and prevent a healthy indicator", () => {
  const markup = render({integrations: [integration], database: [database]}, [{section: "Synthetic section", message: "Review this result"}]);
  assert.match(markup, /data-badge="1 issue"/);
  assert.match(markup, /Synthetic section/);
  assert.match(markup, /Review this result/);
  assert.doesNotMatch(markup, /health-dot healthy/);
});
