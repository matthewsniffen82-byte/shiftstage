import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [guard, styles, layout, liveRoute, socialLinks] = await Promise.all([
  readFile(new URL("../public/third-party-social-link-warning.js", import.meta.url), "utf8"),
  readFile(new URL("../public/third-party-social-link-warning.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/SocialLinks.tsx", import.meta.url), "utf8"),
]);

test("the third-party warning is loaded by routed pages and the live homepage shell", () => {
  assert.match(layout, /import "\.\.\/public\/third-party-social-link-warning\.css"/);
  assert.match(layout, /third-party-social-link-warning\.js\?v=1/);
  assert.match(liveRoute, /third-party-social-link-warning\.css\?v=3/);
  assert.match(liveRoute, /third-party-social-link-warning\.js\?v=1/);
});

test("supported social destinations are gated without intercepting unrelated external links", () => {
  for (const domain of ["instagram.com", "tiktok.com", "snapchat.com", "onlyfans.com", "x.com", "twitter.com"]) {
    assert.match(guard, new RegExp(domain.replace(".", "\\.")));
  }
  assert.match(guard, /url\.protocol !== "https:" && url\.protocol !== "http:"/);
  assert.match(guard, /matchingSocialDestination\(url\.hostname\)/);
  assert.match(guard, /link\.target\.toLowerCase\(\) !== "_blank" && link\.dataset\.thirdPartySocialLink !== "true"/);
});

test("the warning requires a deliberate choice and safely replays only the approved click", () => {
  assert.match(guard, /You’re leaving MyDancr/);
  assert.match(guard, /This social link opens a third-party site\./);
  assert.match(guard, /Stay on MyDancr/);
  assert.match(guard, /Continue to \$\{destination\.label\}/);
  assert.match(guard, /event\.preventDefault\(\)/);
  assert.match(guard, /event\.stopImmediatePropagation\(\)/);
  assert.match(guard, /replayLinks\.add\(link\)/);
  assert.match(guard, /rel = "noopener noreferrer"/);
});

test("the warning is an accessible responsive modal and profile social links opt in explicitly", () => {
  assert.match(guard, /role="dialog" aria-modal="true"/);
  assert.match(guard, /event\.key === "Escape"/);
  assert.match(guard, /event\.key !== "Tab"/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(min-width: 430px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /#mydancrThirdPartySocialWarning \.mydancr-third-party-social-continue/);
  assert.match(styles, /background: linear-gradient\(135deg, #6d28d9, #4c1d95\) !important/);
  assert.match(socialLinks, /data-third-party-social-link="true"/);
  assert.match(socialLinks, /opens in a new tab after a third-party warning/);
});
