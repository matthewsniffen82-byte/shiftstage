import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAgreementComponent } from "./helpers/dancer-agreement-ui.mjs";
import * as accessTerms from "../src/lib/dancr/access-terms.ts";

const documents = [
  ["terms", "user-terms"],
  ["club-agreement", "club-agreement"],
  ["dancer-agreement", "dancer-agreement"],
  ["privacy", "privacy"],
  ["dmca", "dmca"],
];

for (const [route, slug] of documents) {
  test(`${route} displays the revised document and retains its exact source file`, () => {
    const document = JSON.parse(readFileSync(new URL(`../src/content/legal/${slug}.json`, import.meta.url), "utf8"));
    const source = readFileSync(new URL(`../public${document.downloadHref}`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), document.sourceSha256);
    assert.match(document.sourceFile, /Revised_2026-10-08/);
    const Page = loadAgreementComponent(`../${route}/page.tsx`, {}, {
      [`@/src/content/legal/${slug}.json`]: { default: document },
    }).default;
    const html = renderToStaticMarkup(React.createElement(Page));
    assert.ok(html.includes(document.html));
    assert.ok(html.includes(`aria-label="${document.title}"`));
    if (route !== "dancer-agreement") assert.ok(html.includes(document.downloadHref));
  });
}

test("the legal hub exposes all five documents alongside the existing supplementary terms", () => {
  const Page = loadAgreementComponent("../legal/page.tsx", {}, {
    "@/src/lib/dancr/access-terms": accessTerms,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Page));
  for (const [route] of documents) assert.ok(html.includes(`href="/${route}"`));
  assert.ok(html.includes('href="/privacy/california"'));
  assert.ok(html.includes(`href="${accessTerms.ACCESS_TERMS_HREF}"`));
});
