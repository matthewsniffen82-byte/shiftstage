import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const live = fs.readFileSync("outputs/index.html", "utf8");
const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const page = fs.readFileSync("app/dancers/[slug]/page.tsx", "utf8");
const dealCard = fs.readFileSync("app/components/ClubDealCard.tsx", "utf8");
const css = fs.readFileSync("public/profile-media-card-feed.css", "utf8");
const functionSource = (name) => live.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0] || "";
const profile = {
  id: "dancer-id", name: "Star", city: "Las Vegas", verified: true,
  avatarPhotoUrl: "https://example.com/avatar.jpg", venue: "Echo House", venueId: "club-id", venueSlug: "echo-house",
  activeDeal: { id: "deal-id", dealTitle: "Free Entry" }, activeDeals: [{ id: "deal-id" }, { id: "deal-two" }],
  dealAttributionToken: "signed-token", dealAttributionTokens: { "deal-id": "signed-token", "deal-two": "second-token" },
};

test("live photo and video identity uses verified current presence and preserves every offer's attribution", () => {
  let encodedConfig;
  const context = vm.createContext({
    selectedCity: () => "Las Vegas",
    profileDiscoveryCity: (item) => item.city,
    isShiftLocationVerificationCurrent: (item) => item.verified,
    publicAvatarPhotoUrl: (item) => item.avatarPhotoUrl,
    publicAvatarPhotoSrcSet: () => "",
    avatarPhotoPosition: () => "50% 50%",
    venueExperienceHref: (item) => `/venues/${item.slug}`,
    actionIconMarkup: () => "<svg></svg>",
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    encodeDealPass: (config) => { encodedConfig = config; return "encoded-pass"; },
  });
  vm.runInContext(["isWorkingTonight", "dancerProfileClubDealConfig", "profileMediaIdentityMarkup"].map(functionSource).join("\n"), context);
  const html = context.profileMediaIdentityMarkup(profile, "Star", 4, 30);
  assert.match(html, /data-working-now="true"/);
  assert.match(html, /Working now/);
  assert.match(html, /https:\/\/example.com\/avatar.jpg/);
  assert.match(html, /profile-media-club-row[^]*?Echo House[^]*?Free Entry/);
  assert.match(html, /5\/30/);
  assert.equal(encodedConfig.sourceType, "dancer_profile");
  assert.equal(encodedConfig.dancerId, "dancer-id");
  assert.equal(encodedConfig.attributionToken, "signed-token");
  assert.equal(encodedConfig.dealAttributionTokens["deal-two"], "second-token");
  assert.equal(encodedConfig.deals.length, 2);
  for (const inactive of [
    { ...profile, verified: false }, { ...profile, checkedOutAt: "now" },
    { ...profile, workingStatus: "ended" }, { ...profile, internalRoster: true }, null,
  ]) {
    const hidden = context.profileMediaIdentityMarkup(inactive, "Star", 0, 1);
    assert.match(hidden, /Not working now/);
    assert.doesNotMatch(hidden, /data-working-now="true"|profile-media-entry|Echo House/);
  }
  const noOffer = context.profileMediaIdentityMarkup({ ...profile, activeDeal: null }, "Star", 0, 1);
  assert.match(noOffer, /Working now[^]*?Echo House/);
  assert.doesNotMatch(noOffer, /profile-media-entry/);
  assert.match(context.profileMediaIdentityMarkup(null, '<Star "test">', 0, 1), /&lt;Star &quot;test&quot;/);
});

function reactControlsContext() {
  const file = ts.createSourceFile("carousel.tsx", carousel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let controls;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "renderViewerControls") controls = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(controls);
  const compiled = ts.transpileModule(`export ${controls}`, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const context = vm.createContext({
    exports: {}, require, activeMediaReportTarget: () => null, reportedTargets: [], reportSaving: false,
    viewerStatus: "Working Now", viewerCity: "Las Vegas", stageName: "Star", viewerItems: [{}, {}],
    viewerAvatar: { url: "https://example.com/avatar.jpg", focalX: 42, focalY: 36 },
    featuredPhoto: null, viewerVenue: { name: "Echo House", href: "/venues/echo-house" }, viewerDeal: { deal: { id: "deal-id" } },
    closeViewer() {}, imageFocalPointCss: (x, y) => `${x}% ${y}%`,
    inlineMuted: true, mediaLikeStateFor: () => ({ liked: false, likeCount: 0, pending: false }),
    MediaLikeButton: () => null, DancerMediaFollowButton: () => null,
    ReportIcon: () => null, VenuePinIcon: () => null, EntryQrIcon: () => null, ShareIcon: () => null,
    shareStatusIndex: 0, shareStatus: "", viewerFullscreen: false,
  });
  vm.runInContext(compiled, context);
  return context;
}

test("standalone pictures and videos render the same live identity and eligible entry CTA", () => {
  const context = reactControlsContext();
  for (const kind of ["photo", "video"]) {
    const render = () => renderToStaticMarkup(context.exports.renderViewerControls({ kind, id: "media-id" }, 0, () => {}));
    context.viewerStatus = "Working Now";
    context.viewerDeal = { deal: { id: "deal-id" } };
    const html = render();
    assert.match(html, /data-working-now="true"/);
    assert.match(html, /object-position:42% 36%/);
    assert.match(html, /Working now[^]*?Echo House[^]*?Free Entry/);
    assert.match(html, /1\/2/);
    context.viewerStatus = "Not working now";
    assert.doesNotMatch(render(), /data-working-now="true"|Free Entry|Echo House/);
    context.viewerStatus = "Working Now";
    context.viewerDeal = null;
    assert.match(render(), /Working now[^]*?Echo House/);
    assert.doesNotMatch(render(), /Free Entry/);
  }
});

test("one existing deal controller serves every card and retains its viewer position", () => {
  assert.equal((carousel.match(/<ClubDealCard /g) || []).length, 1);
  assert.match(carousel, /<ClubDealCard \{\.\.\.deal\} renderTrigger=\{children\}/);
  assert.match(dealCard, /renderTrigger \? renderTrigger\(openDealDialog\)/);
  assert.match(dealCard, /#results\.venue-profile-overlay, \[data-profile-media-scroll-feed\]/);
  assert.match(carousel, /document\.querySelector\("\.club-deal-dialog-backdrop"\)\) return/);
  assert.match(page, /viewerDeal=\{activeShift && activeDeal \? \{[^]*?attributionToken: dealAttributionToken,[^]*?attributionTokens: dealAttributionTokens/);
  assert.match(css, /right: 76px;\s*bottom: 0;/);
  assert.match(css, /padding: 64px 0 32px 12px/);
  assert.match(css, /\.profile-media-club-row[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
});
