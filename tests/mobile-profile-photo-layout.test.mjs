import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const layout = postcss.parse(readFileSync("public/dancer-profile-layout.css", "utf8"));
const mobile = layout.nodes.find(node => node.type === "atrule" && node.name === "layer" && node.params === "dancr-mobile-profile");
const rules = [];
mobile.walkRules(rule => rules.push(rule));
const ruleEnding = ending => rules.find(rule => rule.selector.endsWith(ending));
const value = (rule, property) => rule?.nodes.find(node => node.prop === property)?.value;

test("phone profiles put the full-width photo ahead of identity, actions and gallery across all entry points", () => {
  assert.equal(mobile.nodes[0].name, "media");
  assert.equal(mobile.nodes[0].params, "(max-width: 759px)", "desktop keeps its existing layout");
  const shell = rules[0];
  assert.ok(shell.selector.includes("#profileBackdrop #profileModal, .public-profile-shell"));
  assert.ok(shell.selector.endsWith(":not(.dancer-profile-preview-shell)"), "leave the upload editor alone");
  assert.equal(value(shell, "grid-template-columns"), "minmax(0, 1fr)");
  assert.equal(value(shell, "--profile-frame-row-end"), "5");
  assert.equal(value(ruleEnding("> .profile-details-column"), "display"), "contents", "Internal details join the same rows");
  for (const [ending, row] of [
    ["> .profile-featured-column", "1"],
    [":is(.profile-modal-summary, .profile-titlebar)", "2"],
    ["> .live-actions", "3"],
    ["> .profile-tonight-card", "4"],
    ["> :is(.profile-modal-media, .profile-media-section)", "5"],
    ['> p[role="status"]', "6"],
  ]) {
    const rule = ruleEnding(ending);
    assert.equal(value(rule, "grid-row"), row, ending);
    assert.equal(rule.nodes.find(node => node.prop === "grid-row").important, true, "override legacy embedded row placement");
  }
});

test("the full-width photo uses the split frame height while containing and centering the entire image", () => {
  const column = ruleEnding("> .profile-featured-column");
  let splitFrame;
  layout.walkRules(rule => {
    if (rule.selector.endsWith("> .profile-featured-column") && value(rule, "min-height") === "var(--profile-featured-frame-height)") splitFrame = rule;
  });
  assert.ok(splitFrame, "the original split frame defines the shared height");
  assert.equal(value(column, "height"), value(splitFrame, "min-height"));
  assert.equal(value(layout.nodes.find(node => node.type === "rule"), "--profile-featured-frame-height"), "clamp(400px, 64vw, 760px)");
  assert.equal(value(column, "min-height"), "0");
  assert.equal(value(column, "align-self"), "start");
  const button = ruleEnding(":is(.profile-featured-open, #modalImage)");
  assert.equal(value(button, "position"), "relative");
  assert.equal(value(button, "height"), "100%");
  const photo = ruleEnding(" .profile-featured-photo");
  for (const [property, expected] of Object.entries({ position: "static", width: "100%", height: "100%", "min-height": "0", "max-height": "100%", "aspect-ratio": "auto", "object-fit": "contain", "object-position": "center", transform: "none" })) {
    const declaration = photo.nodes.find(node => node.prop === property);
    assert.equal(declaration.value, expected, property);
    assert.equal(declaration.important, true, property);
  }
  assert.equal(value(ruleEnding("> .profile-featured-column:not(:has(.profile-featured-photo))"), "min-height"), "180px", "empty profiles retain a readable placeholder");
});

test("Back and options remain above a tall photo with separate touch targets", () => {
  assert.equal(value(rules[0], "position"), "relative");
  assert.match(value(rules[0], "padding-top"), /60px/);
  const title = ruleEnding(":is(.profile-modal-summary, .profile-titlebar)");
  assert.equal(value(title, "position"), "static", "the profile shell anchors the controls");
  assert.equal(value(title, "backdrop-filter"), "none");
  const controls = ruleEnding(":is(.profile-modal-header-controls, .profile-titlebar-controls)");
  assert.equal(value(controls, "position"), "absolute");
  assert.match(value(controls, "inset"), /8px/);
  assert.equal(value(controls, "width"), "auto");
  assert.equal(value(controls, "z-index"), "4");
});

test("the actual featured-photo component retains saved dimensions and requests a full-width phone image", () => {
  const source = readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  const file = ts.createSourceFile("carousel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let featured;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "aside" && node.openingElement.getText(file).includes('className="profile-featured-column"')) featured = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(featured);
  const compiled = ts.transpileModule(`export function renderFeatured() { return (${featured}); }`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, require: createRequire(import.meta.url), viewerStatus: "Working Now", stageName: "Ty",
    featuredPhotoIndex: 0, featuredPhoto: null, openViewer() {}, markImageReady() {}, markImageUnavailable() {}, settleImageElement() {}, imageFocalPointCss: () => "0% 0%" });
  vm.runInContext(compiled, context);
  for (const [width, height] of [[900, 1600], [1600, 900], [900, 2400]]) {
    context.featuredPhoto = { imageUrl: "/approved-crop.webp", imageWidth: width, imageHeight: height, focalX: 0 };
    const html = renderToStaticMarkup(context.exports.renderFeatured());
    assert.match(html, new RegExp(`width="${width}" height="${height}"`));
    assert.match(html, /sizes="\(max-width: 759px\) 100vw, \(max-width: 1180px\) 54vw, 638px"/);
    assert.match(html, /src="\/approved-crop.webp"/);
    assert.match(html, /aria-label="Open Ty main photo"/);
  }
  context.featuredPhoto = null;
  assert.match(renderToStaticMarkup(context.exports.renderFeatured()), /No approved profile photos yet/);
  const live = readFileSync("src/live-shell/app/11-post-verified-shift.js", "utf8");
  assert.match(live, /image.sizes = "\(max-width: 759px\) 100vw, \(max-width: 1180px\) 54vw, 638px"/);
});
