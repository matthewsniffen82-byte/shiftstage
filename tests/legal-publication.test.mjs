import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAgreementComponent } from "./helpers/dancer-agreement-ui.mjs";
import * as accessTerms from "../src/lib/dancr/access-terms.ts";
import * as userTerms from "../src/lib/dancr/user-terms-version.ts";

test("the table prompt shows the terms checkbox only when sending a request", () => {
  const dependencies = {
    "@/src/lib/dancr/access-terms": accessTerms,
    "@/src/lib/dancr/user-terms-version": userTerms,
  };
  const Prompt = loadAgreementComponent("../internal/TableRequestConsent.tsx", {}, {
    ...dependencies,
    "../components/RequestTermsCheckbox": loadAgreementComponent("RequestTermsCheckbox.tsx", {}, dependencies),
    "@/src/lib/dancr/request-terms": {},
  }).default;
  const send = renderToStaticMarkup(React.createElement(Prompt, { onClose() {}, onAccept() {} }));
  assert.match(send, /type="checkbox"[^>]*required/);
  assert.ok(send.includes(accessTerms.TABLE_REQUEST_NOTICE));
  const cancel = renderToStaticMarkup(React.createElement(Prompt, { dancerName: "Kelly", onClose() {}, onConfirm() {} }));
  assert.match(cancel, /Cancel request for Kelly\?/);
  assert.match(cancel, /Keep request/);
  assert.match(cancel, />Cancel request<\/button>/);
  assert.doesNotMatch(cancel, /checkbox|Privacy Policy|User Terms|shared table link/i);
});

const documents = [
  ["terms", "user-terms"],
  ["club-agreement", "club-agreement"],
  ["dancer-agreement", "dancer-agreement"],
  ["privacy", "privacy"],
  ["dmca", "dmca"],
  ["privacy/california", "california-privacy"],
  ["dancer-verification", "dancer-verification"],
  ["report-harmful-content", "report-harmful-content"],
  ["federal-performer-records", "federal-performer-records"],
];

for (const [route, slug] of documents) {
  test(`${route} displays the revised document and retains its exact source file`, () => {
    const document = JSON.parse(readFileSync(new URL(`../src/content/legal/${slug}.json`, import.meta.url), "utf8"));
    const source = readFileSync(new URL(`../public${document.downloadHref}`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), document.sourceSha256);
    if (slug !== "dmca") assert.match(document.sourceFile, /2026-10-30/);
    else {
      assert.match(document.sourceFile, /2026-10-31/);
      assert.doesNotMatch(document.html, /\[Registered DMCA agent/);
    }
    const Page = loadAgreementComponent(`../${route}/page.tsx`, {}, {
      [`@/src/content/legal/${slug}.json`]: { default: document },
    }).default;
    const html = renderToStaticMarkup(React.createElement(Page));
    assert.ok(html.includes(document.html));
    assert.ok(html.includes(`aria-label="${document.title}"`));
    if (route !== "dancer-agreement") assert.ok(html.includes(document.downloadHref));
  });
}

test("the legal hub exposes all public documents alongside the versioned access terms", () => {
  const Page = loadAgreementComponent("../legal/page.tsx", {}, {
    "@/src/lib/dancr/access-terms": accessTerms,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Page));
  for (const [route] of documents) assert.ok(html.includes(`href="/${route}"`));
  assert.ok(html.includes('href="/privacy/california"'));
  assert.ok(html.includes(`href="${accessTerms.ACCESS_TERMS_HREF}"`));
});

test("retired public agreement links redirect to the approved package without rendering old terms", async () => {
  const redirect = href => { throw Object.assign(new Error("redirect"), { href }); };
  const navigation = { permanentRedirect: redirect, notFound: () => { throw new Error("not found"); } };
  const dancer = loadAgreementComponent("../dancer-agreement/2026-10-08-v3/page.tsx", {}, { "next/navigation": navigation }).default;
  assert.throws(() => dancer(), error => error.href === "/dancer-agreement/2026-10-30");
  const guest = loadAgreementComponent("../terms/user/2026-10-08-v3/page.tsx", {}, {
    "next/navigation": navigation, "@/src/lib/dancr/user-terms-version": userTerms,
  }).default;
  assert.throws(() => guest(), error => error.href === userTerms.USER_TERMS_HREF);
  const octoberTerms = JSON.parse(readFileSync(new URL("../src/content/legal/vip-table-2026-10-30.json", import.meta.url), "utf8"));
  const document = JSON.parse(readFileSync(new URL("../src/content/legal/vip-table.json", import.meta.url), "utf8"));
  const vip = loadAgreementComponent("../terms/vip-table/[version]/page.tsx", {}, {
    "next/navigation": navigation, "@/src/lib/dancr/access-terms": accessTerms,
    "@/src/content/legal/vip-table-2026-10-30.json": { default: octoberTerms },
    "@/src/content/legal/vip-table.json": { default: document },
  }).default;
  await assert.rejects(vip({ params: Promise.resolve({ version: "2026-10-08" }) }), error => error.href === accessTerms.ACCESS_TERMS_HREF);
  await assert.rejects(vip({ params: Promise.resolve({ version: "unknown" }) }), /not found/);
  assert.ok(renderToStaticMarkup(await vip({ params: Promise.resolve({ version: accessTerms.ACCESS_TERMS_VERSION }) })).includes(document.html));
  assert.ok(renderToStaticMarkup(await vip({ params: Promise.resolve({ version: octoberTerms.version }) })).includes(octoberTerms.html));
  assert.equal(createHash("sha256").update(readFileSync(new URL(`../public${document.downloadHref}`, import.meta.url))).digest("hex"), document.sourceSha256);
});
