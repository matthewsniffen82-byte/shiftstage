import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveSource = readFileSync("outputs/index.html", "utf8");
const reactSource = readFileSync("app/components/ClubDealCard.tsx", "utf8");

test("live Club Deal QR overlays restore the exact venue profile position", () => {
  assert.match(liveSource, /let clubDealOverlayReturnContext = null/);
  assert.match(
    liveSource,
    /function captureClubDealOverlayReturnContext[\s\S]*?windowScrollY: window\.scrollY[\s\S]*?resultsScrollTop: results\?\.scrollTop/,
  );
  assert.match(
    liveSource,
    /function restoreClubDealOverlayReturnContext[\s\S]*?results\.scrollTop = returnContext\.resultsScrollTop[\s\S]*?window\.scrollTo\(\{ top: returnContext\.windowScrollY[\s\S]*?requestAnimationFrame/,
  );
  assert.match(liveSource, /openDealPassOverlay\(pass, revenueTrigger\)/);
  assert.match(liveSource, /openDealPassOverlay\(pass, trigger\)/);
  assert.match(liveSource, /if \(restorePosition\) restoreClubDealOverlayReturnContext\(\)/);
});

test("multi-offer Club Deal flow preserves one return position through QR creation", () => {
  assert.match(liveSource, /openClubDealHub\(config, revenueTrigger\)/);
  assert.match(liveSource, /closeClubDealHub\(false\);\s*openDealPassOverlay\(pass\)/);
});

test("standalone Club Deal dialogs also restore scroll and focus after closing", () => {
  assert.match(reactSource, /const dialogReturnContext = useRef/);
  assert.match(reactSource, /windowScrollY: window\.scrollY/);
  assert.match(reactSource, /scrollContainer\?\.scrollTop \|\| 0/);
  assert.match(reactSource, /returnContext\.scrollContainer\.scrollTop = returnContext\.scrollTop/);
  assert.match(reactSource, /window\.scrollTo\(\{ top: returnContext\.windowScrollY/);
  assert.match(reactSource, /returnContext\.focusTarget\.focus\(\{ preventScroll: true \}\)/);
});
