import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAgreementComponent } from "./helpers/dancer-agreement-ui.mjs";

const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];

test("the direct agreement page keeps readable terms without an original-document download", () => {
  const Page = loadAgreementComponent("../dancer-agreement/page.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /MISCELLANEOUS/);
  assert.match(html, /href="\/legal"/);
  assert.doesNotMatch(html, /<footer/);
  assert.doesNotMatch(html, /href="\/(?:privacy(?:\/california)?|dmca)"/);
  assert.doesNotMatch(html, /Download original|download=|\.docx/);
});

function fixture({ fail = false } = {}) {
  const states = [], effects = [], portals = [];
  let cursor = 0, opened = 0, closed = 0, focused = 0;
  class HTMLElement { isConnected = true; focus() { focused++; } }
  const doc = { activeElement: new HTMLElement(), body: {}, documentElement: { style: { overflow: "auto" } } };
  const dialog = { showModal() { opened++; }, close() { closed++; } };
  const dependencies = {
    react: { ...React, useId: () => "agreement-title", useEffect: fn => effects.push(fn), useRef: () => ({ current: dialog }), useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    } },
    "react-dom": { createPortal(node) { portals.push(node); return null; } },
  };
  if (fail) Object.defineProperty(dependencies, "@/src/content/legal/dancer-agreement.json", { get() { throw new Error("offline"); } });
  const Link = loadAgreementComponent("DancerAgreementLink.tsx", { document: doc, HTMLElement }, dependencies).default;
  const render = () => { cursor = 0; return Link({}); };
  return { doc, effects, portals, render, counts: () => ({ opened, closed, focused }) };
}

test("normal activation opens a dialog without navigation; modified clicks keep the page fallback", () => {
  const f = fixture();
  const link = elements(f.render()).find(node => node.type === "a");
  assert.equal(link.props.href, "/dancer-agreement");
  assert.equal(link.props["aria-haspopup"], "dialog");
  assert.equal(link.props.target, undefined);
  let prevented = 0, stopped = 0;
  const event = { button: 0, preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  link.props.onClick({ ...event, ctrlKey: true });
  f.render();
  assert.equal(f.portals.length, 0);
  link.props.onClick(event);
  f.render();
  assert.equal(f.portals.length, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("the reader opens modally, loads complete terms without downloads, and restores focus and scrolling", async () => {
  const f = fixture();
  elements(f.render()).find(node => node.type === "a").props.onClick({ button: 0, preventDefault() {}, stopPropagation() {} });
  f.render();
  const modal = f.portals.at(-1);
  let tree = modal.type(modal.props);
  assert.match(renderToStaticMarkup(tree), /Loading Dancer Agreement/);
  const cleanup = f.effects[0]();
  f.effects[1]();
  await new Promise(resolve => setImmediate(resolve));
  f.render();
  tree = modal.type(modal.props);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /ELIGIBILITY AND TRUTHFUL IDENTITY/);
  assert.match(html, /MISCELLANEOUS/);
  assert.doesNotMatch(html, /Download original|download=|\.docx/);
  assert.equal(f.doc.documentElement.style.overflow, "hidden");
  assert.equal(f.counts().opened, 1);
  elements(tree).find(node => node.props["aria-label"] === "Close Dancer Agreement").props.onClick();
  assert.equal(elements(f.render()).find(node => node.type === "a").props["aria-expanded"], false);
  cleanup();
  assert.equal(f.doc.documentElement.style.overflow, "auto");
  assert.deepEqual(f.counts(), { opened: 1, closed: 1, focused: 1 });
});

test("a failed document load offers retry and Escape still closes the reader", async () => {
  const f = fixture({ fail: true });
  elements(f.render()).find(node => node.type === "a").props.onClick({ button: 0, preventDefault() {}, stopPropagation() {} });
  f.render();
  const modal = f.portals.at(-1);
  modal.type(modal.props);
  f.effects[1]();
  await new Promise(resolve => setImmediate(resolve));
  f.render();
  const tree = modal.type(modal.props);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /role="alert"/);
  assert.match(html, /Try again/);
  tree.props.onCancel({ preventDefault() {} });
  assert.equal(elements(f.render()).find(node => node.type === "a").props["aria-expanded"], false);
});
