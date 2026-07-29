import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync("outputs/index.html", "utf8");

test("mobile navigation cannot cover profile actions while an overlay is open", () => {
  assert.match(
    homeSource,
    /body\.overlay-open #discoveryTabs \{\s+visibility: hidden !important;\s+pointer-events: none !important;\s+\}/,
  );
  assert.match(
    homeSource,
    /const overlayOpen = !!document\.querySelector\("\.page-panel\.show, \.modal-backdrop\.show,[^"]+"\);\s+document\.body\.classList\.toggle\("overlay-open", overlayOpen\);/,
  );
  assert.match(
    homeSource,
    /<button class="action-btn secondary[^"]*" id="reportBtn"[^>]*>\$\{profileActionButtonMarkup\("report", "Report", "public"\)\}<\/button>/,
  );
});
