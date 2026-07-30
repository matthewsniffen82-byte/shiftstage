import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, globalNavigation] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
]);

test("Samsung Browser's native scroll-to-top control cannot cover a homepage button", () => {
  assert.match(homeSource, /const isSamsung = \/SamsungBrowser\/i\.test\(ua\)/);
  assert.match(
    homeSource,
    /html\.is-samsung-browser body,[\s\S]*?body\.is-samsung-browser \{[\s\S]*?padding-bottom: calc\(156px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    homeSource,
    /html\.is-samsung-browser\.samsung-scroll-control-visible #discoveryTabs \{[\s\S]*?bottom: calc\(78px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    homeSource,
    /const syncSamsungScrollClearance = \(\) => \{[\s\S]*?"samsung-scroll-control-visible",[\s\S]*?window\.scrollY > 120[\s\S]*?window\.addEventListener\("scroll", syncSamsungScrollClearance, \{ passive: true \}\)/,
  );
});

test("Samsung Browser's native scroll-to-top control cannot cover a routed-page button", () => {
  assert.match(
    globalNavigation,
    /const isSamsungBrowser = \/SamsungBrowser\/i\.test\([\s\S]*?window\.navigator\.userAgent,[\s\S]*?document\.documentElement\.classList\.add\("is-samsung-browser"\)[\s\S]*?document\.body\.classList\.add\("is-samsung-browser"\)/,
  );
  assert.match(
    globalNavigation,
    /html\.is-samsung-browser body \{[\s\S]*?padding-bottom: calc\(156px \+ env\(safe-area-inset-bottom\)\) !important/,
  );
  assert.match(
    globalNavigation,
    /html\.is-samsung-browser\.samsung-scroll-control-visible[\s\S]*?\.global-mobile-bottom-nav \{[\s\S]*?bottom: calc\(78px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    globalNavigation,
    /const syncSamsungScrollClearance = \(\) => \{[\s\S]*?"samsung-scroll-control-visible",[\s\S]*?isSamsungBrowser && window\.scrollY > 120[\s\S]*?window\.addEventListener\("scroll", syncSamsungScrollClearance,[\s\S]*?passive: true/,
  );
});
