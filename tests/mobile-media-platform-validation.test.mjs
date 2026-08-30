import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { canWarmAdjacentVideo } from "../src/lib/dancr/use-adaptive-video-warmup.ts";

const [
  liveShell,
  rootLayout,
  globalNavigation,
  profileCarousel,
  publicProfile,
  tvFeed,
  autoplayRecovery,
  aesthetic,
] = await Promise.all([
  "../outputs/index.html",
  "../app/layout.tsx",
  "../app/components/GlobalMobileBottomNav.tsx",
  "../app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "../app/dancers/[slug]/page.tsx",
  "../app/tv/TvFeedClient.tsx",
  "../public/video-autoplay-recovery.js",
  "../public/dancr-aesthetic.v1.css",
].map((file) => readFile(new URL(file, import.meta.url), "utf8")));

function liveShellDeviceClasses(userAgent, platform = "") {
  const bootstrap = liveShell.match(
    /<script>\s*(\(\(\) => \{[\s\S]*?)\n\s*let dancrViewportTop/,
  )?.[1];
  assert.ok(bootstrap, "the live-shell device bootstrap must exist");

  const rootClasses = new Set();
  const bodyClasses = new Set();
  const classList = (classes) => ({ add: (...names) => names.forEach((name) => classes.add(name)) });
  const document = {
    body: { classList: classList(bodyClasses) },
    documentElement: { classList: classList(rootClasses) },
    readyState: "complete",
  };
  const window = { location: { search: "" } };
  vm.runInNewContext(`${bootstrap}\n})();`, {
    document,
    navigator: {
      userAgent,
      ...(platform ? { userAgentData: { platform } } : {}),
    },
    URLSearchParams,
    window,
  });
  return { bodyClasses, rootClasses };
}

test("Android, Samsung, and iPhone select only their intended mobile paint paths", () => {
  const android = liveShellDeviceClasses(
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/139 Mobile Safari/537.36",
    "Android",
  );
  for (const classes of [android.rootClasses, android.bodyClasses]) {
    assert.equal(classes.has("is-android"), true);
    assert.equal(classes.has("android-rendering"), true);
    assert.equal(classes.has("is-samsung-browser"), false);
  }

  const samsung = liveShellDeviceClasses(
    "Mozilla/5.0 (Linux; Android 15; SM-S938U) AppleWebKit/537.36 SamsungBrowser/28.0 Mobile Safari/537.36",
  );
  for (const classes of [samsung.rootClasses, samsung.bodyClasses]) {
    assert.equal(classes.has("is-android"), true);
    assert.equal(classes.has("is-samsung-browser"), true);
    assert.equal(classes.has("samsung-rendering"), true);
  }

  const iphone = liveShellDeviceClasses(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  );
  for (const classes of [iphone.rootClasses, iphone.bodyClasses]) {
    assert.equal(classes.has("is-android"), false);
    assert.equal(classes.has("is-samsung-browser"), false);
  }
  assert.match(rootLayout, /viewportFit: "cover"/);
  assert.match(liveShell, /viewport-fit=cover, interactive-widget=resizes-content/);
});

test("Android and iPhone keep media sizing stable and resource windows bounded", () => {
  assert.match(publicProfile, /min-height: 100vh[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(publicProfile, /height: 100vh; height: 100dvh;/);
  assert.match(
    profileCarousel,
    /src=\{Math\.abs\(index - viewerIndex\) <= 1 \? item\.imageUrl : undefined\}/,
  );
  assert.match(
    profileCarousel,
    /src=\{index === viewerIndex \|\| \([\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? item\.videoUrl : undefined\}/,
  );
  assert.match(tvFeed, /playsInline[\s\S]*?preload=\{/);
  assert.match(tvFeed, /setAttribute\("webkit-playsinline", ""\)/);
  assert.match(autoplayRecovery, /setAttribute\("webkit-playsinline", ""\)/);
  assert.match(
    aesthetic,
    /iOS Safari can evict filtered photo layers[\s\S]*?@supports \(-webkit-touch-callout: none\)[\s\S]*?filter: none !important;[\s\S]*?will-change: auto !important;/,
  );
  assert.match(
    aesthetic,
    /Android media luminance recovery must remain the final media layer[\s\S]*?-webkit-filter: brightness\(1\.14\) contrast\(1\.03\) !important;/,
  );
});

test("mobile bandwidth policy is conservative where Android exposes connection signals", () => {
  assert.equal(canWarmAdjacentVideo({}), true, "Safari without the Network Information API may warm one adjacent item");
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "4g" } }), true);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "2g" } }), false);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "4g", saveData: true } }), false);
});

test("mobile navigation and media cleanup preserve touch, back, and close behavior", () => {
  assert.match(globalNavigation, /const isIphoneWebKit =[\s\S]*?navigator\.maxTouchPoints > 1/);
  assert.match(globalNavigation, /window\.location\.assign\(destination\)/);
  assert.match(
    globalNavigation,
    /MOBILE_SWIPE_BLOCKED_SELECTOR[\s\S]*?\.profile-photo-viewer[\s\S]*?\.profile-media-viewer[\s\S]*?\.profile-tv-viewer/,
  );
  assert.match(
    liveShell,
    /function closeProfileTvViewer\(\)[\s\S]*?querySelectorAll\("video"\)\.forEach\(releaseDeferredVideoSource\)[\s\S]*?stage\.innerHTML = ""/,
  );
  assert.match(
    liveShell,
    /function closeProfilePhotoViewer\(\)[\s\S]*?profilePhotoViewerImage\.innerHTML = ""/,
  );
});
