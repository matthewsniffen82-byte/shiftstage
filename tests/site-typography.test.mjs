import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { staticAssetVersions } from "../src/generated/static-asset-versions.mjs";
import { venueEmbedPolicy } from "../src/lib/security/venue-embed-policy.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const css = read("public/dancr-typography.v1.css");
const sheet = postcss.parse(css);

test("every text font ships as a valid, content-addressed local WOFF2 with its license", () => {
  const families = new Set();
  sheet.walkAtRules("font-face", rule => {
    const declarations = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]));
    families.add(declarations["font-family"].replaceAll("'", ""));
    assert.equal(declarations["font-display"], "swap");
    const [, family, hash] = declarations.src.match(/url\(\/fonts\/([a-z]+)-([a-f0-9]{12})\.woff2\)/) || [];
    assert.ok(family, "Font requests stay on the site's own origin");
    const bytes = readFileSync(new URL(`../public/fonts/${family}-${hash}.woff2`, import.meta.url));
    assert.equal(bytes.toString("ascii", 0, 4), "wOF2");
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), hash);
    assert.match(read(`public/fonts/${family}-OFL.txt`), /SIL OPEN FONT LICENSE/);
  });
  assert.deepEqual([...families].sort(), ["Inter", "Manrope", "Outfit"]);
  assert.match(venueEmbedPolicy, /font-src 'self'/, "Club embeds permit the same local fonts");
  assert.equal(staticAssetVersions["/dancr-typography.v1.css"], createHash("sha256").update(css.replace(/\r\n?/g, "\n")).digest("hex").slice(0, 16));
});

test("React pages and standalone guest documents all load the shared typography", () => {
  assert.match(read("app/layout.tsx"), /import "\.\.\/public\/dancr-typography\.v1\.css"/);
  for (const file of [
    "src/live-shell/shell.html", "app/embed/venues/[slug]/route.ts",
    "app/auth/callback/route.ts", "app/auth/email-action/route.ts",
    "app/auth/venue-approval/route.ts", "app/auth/vip-setup/route.ts",
  ]) {
    assert.match(read(file), /href="\/dancr-typography\.v1\.css"/, file);
    assert.doesNotMatch(read(file), /fonts\.googleapis\.com/, file);
  }
  for (const file of ["app/internal/layout.tsx", "app/pickups/layout.tsx", "app/venue-team/invite/[token]/page.tsx"]) {
    assert.doesNotMatch(read(file), /next\/font\/google/, "Nested layouts must use the shared font faces");
  }
});

test("shared text rules cannot replace icon pseudo-elements or club-logo artwork", () => {
  sheet.walkRules(rule => {
    assert.doesNotMatch(rule.selector, /::(?:before|after)/);
    rule.walkDecls(declaration => {
      assert.ok(!["background", "background-image", "color", "width", "height", "object-fit", "object-position"].includes(declaration.prop), declaration.prop);
    });
  });
  assert.match(read("public/dancr-aesthetic.v1.css"), /font-family: "MyDancr Profile Socials" !important/);
});
