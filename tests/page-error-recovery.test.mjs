import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { ErrorBoundaryHandler } = require("next/dist/client/components/error-boundary.js");
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function compile(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => {
    if (name in dependencies) return dependencies[name];
    assert.equal(name, "react/jsx-runtime", `Unexpected recovery dependency: ${name}`);
    return require(name);
  } });
  return exports;
}
const styles = { __esModule: true, default: { page: "page", card: "card", brand: "brand" } };
const shared = compile("app/components/PageError.tsx", { "./PageError.module.css": styles });
const components = ["app/error.tsx", "app/global-error.tsx"].map(file => ({
  file, component: compile(file, { "./components/PageError": shared }).default,
}));
function resolve(element) {
  if (element == null || typeof element !== "object") return element;
  if (typeof element.type === "function") return resolve(element.type(element.props));
  return { type: element.type, props: element.props,
    children: React.Children.toArray(element.props.children).map(resolve) };
}
function find(node, type) {
  if (node?.type === type) return node;
  return node?.children?.map(child => find(child, type)).find(Boolean);
}

for (const { file, component } of components) {
  test(`${file}: neither reads nor renders exception details`, () => {
    const props = { reset() { assert.fail("Rendering must not retry"); } };
    Object.defineProperty(props, "error", { get() { assert.fail("Recovery must not inspect the exception"); } });
    const markup = renderToStaticMarkup(component(props));
    assert.match(markup, /role="alert"/);
    assert.match(markup, /aria-labelledby="page-error-title"/);
    assert.match(markup, /href="\/"/);
    assert.doesNotMatch(markup, /<form|<script|<iframe/);
  });

  test(`${file}: recovery occurs only after the explicit action`, () => {
    let resets = 0;
    const tree = resolve(component({ error: new Error("Synthetic private detail"), reset: () => { resets++; } }));
    assert.equal(resets, 0);
    const button = find(tree, "button");
    assert.equal(button.props.type, "button");
    button.props.onClick();
    assert.equal(resets, 1);
    assert.equal(find(tree, "a").props.href, "/");
  });
}

test("global recovery supplies a document when the root layout is unavailable", () => {
  const tree = resolve(components[1].component({ error: new Error("Synthetic"), reset() {} }));
  assert.equal(tree.type, "html");
  assert.equal(tree.props.lang, "en");
  assert.ok(find(tree, "head"));
  assert.ok(find(tree, "title"));
  assert.equal(find(tree, "meta").props.name, "viewport");
  assert.equal(find(tree, "meta").props.content, "width=device-width, initial-scale=1, viewport-fit=cover");
  assert.ok(find(tree, "body"));
  assert.ok(find(tree, "main"));
});

test("the installed Next boundary passes its reset through the application fallback", () => {
  const props = { pathname: "/dancers/synthetic", errorComponent: components[0].component, children: "Recovered page" };
  const boundary = new ErrorBoundaryHandler(props);
  boundary.state = { ...boundary.state, ...ErrorBoundaryHandler.getDerivedStateFromError(new Error("Synthetic")) };
  boundary.setState = next => { boundary.state = { ...boundary.state, ...next }; };
  // Inspect the actual framework element tree; no browser or hosted fault injection.
  const fallback = React.Children.toArray(boundary.render().props.children).find(element => element.type === components[0].component);
  const tree = resolve(fallback);
  find(tree, "button").props.onClick();
  assert.equal(boundary.state.error, null);
  assert.equal(boundary.render(), "Recovered page");
});

test("the installed Next boundary clears the failure when navigation changes", () => {
  const next = ErrorBoundaryHandler.getDerivedStateFromProps({ pathname: "/" }, {
    previousPathname: "/dancers/synthetic", error: new Error("Synthetic"),
  });
  assert.equal(next.error, null);
  assert.equal(next.previousPathname, "/");
});
