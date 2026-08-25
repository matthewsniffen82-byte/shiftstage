import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/route.ts", import.meta.url), "utf8");
const controls = readFileSync(new URL("../public/profile-video-scroll-controls.css", import.meta.url), "utf8");

test("the live shell loads the full-profile TV-style playback indicator", () => {
  assert.match(route, /profile-video-scroll-controls\.css\?v=2/);
});

test("full-profile video uses the same quiet bottom progress line as TV cards", () => {
  assert.match(controls, /#profileBackdrop \.profile-modal-video-controls \{[\s\S]*?inset: 0 !important;[\s\S]*?background: transparent !important;/);
  assert.match(controls, /background: transparent !important;[\s\S]*?opacity: 1 !important;/);
  assert.match(controls, /bottom: 0 !important;[\s\S]*?width: calc\(100% - 28px\) !important/);
  assert.match(controls, /height: 3px;[\s\S]*?#f8f8fa 0 var\(--profile-video-progress\)/);
  assert.match(controls, /rgba\(255, 255, 255, 0\.18\) var\(--profile-video-progress\) 100%/);
  assert.match(controls, /::-webkit-slider-thumb \{[\s\S]*?opacity: 0;/);
  assert.match(controls, /#modalVideoPlayback \{[\s\S]*?top: 50% !important;[\s\S]*?left: 50% !important;/);
  assert.match(controls, /#modalVideoSound \{[\s\S]*?top: 14px !important;[\s\S]*?right: 14px !important;/);
  assert.match(controls, /\.profile-modal-media-expand \{[\s\S]*?right: 14px !important;[\s\S]*?bottom: 18px !important;/);
  assert.match(controls, /\.profile-modal-video-controls output \{[\s\S]*?clip-path: inset\(50%\) !important/);
});
