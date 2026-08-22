import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROWSER_AUTH_SESSION_KEY,
  readBrowserAccessToken,
  readBrowserAuthSession,
} from "../src/lib/dancr/browser-session.ts";

const [
  boundarySource,
  headerSource,
  dancerActionsSource,
  venueActionsSource,
  directionsSource,
  tvSource,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/browser-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/PublicProfileHeader.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/VenueProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/DirectionsLink.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
]);

test("the browser auth boundary safely reads sessions and enforces optional account roles", () => {
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return stored.get(key) ?? null;
      },
      setItem(key, value) {
        stored.set(key, String(value));
      },
    },
  };

  try {
    stored.set(BROWSER_AUTH_SESSION_KEY, JSON.stringify({
      accessToken: "customer-access",
      account: { role: "customer", displayName: "Customer" },
    }));
    assert.deepEqual(readBrowserAuthSession(), {
      accessToken: "customer-access",
      account: { role: "customer", displayName: "Customer" },
    });
    assert.equal(readBrowserAccessToken(), "customer-access");
    assert.equal(readBrowserAccessToken("customer"), "customer-access");
    assert.equal(readBrowserAccessToken("dancer"), "");

    stored.set(BROWSER_AUTH_SESSION_KEY, "not-json");
    assert.equal(readBrowserAuthSession(), null);
    assert.equal(readBrowserAccessToken(), "");

    stored.set(BROWSER_AUTH_SESSION_KEY, JSON.stringify([]));
    assert.equal(readBrowserAuthSession(), null);

    stored.set(BROWSER_AUTH_SESSION_KEY, JSON.stringify({
      accessToken: 123,
      account: { role: "customer" },
    }));
    assert.equal(readBrowserAccessToken("customer"), "");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("public profile, venue, directions, and TV clients share one authenticated-session reader", () => {
  assert.match(boundarySource, /export const BROWSER_AUTH_SESSION_KEY = "dancrAuthSessionV1"/);
  assert.match(boundarySource, /typeof window === "undefined"/);
  assert.match(boundarySource, /!Array\.isArray\(parsed\)/);

  for (const source of [
    headerSource,
    dancerActionsSource,
    venueActionsSource,
    directionsSource,
    tvSource,
  ]) {
    assert.match(source, /from "@\/src\/lib\/dancr\/browser-session"/);
    assert.doesNotMatch(source, /const SESSION_KEY = "dancrAuthSessionV1"/);
    assert.doesNotMatch(source, /localStorage\.getItem\("dancrAuthSessionV1"\)/);
  }

  assert.match(headerSource, /readBrowserAuthSession\(\)/);
  assert.match(dancerActionsSource, /readBrowserAccessToken\("customer"\)/);
  assert.match(venueActionsSource, /readBrowserAccessToken\("customer"\)/);
  assert.match(directionsSource, /readBrowserAccessToken\(\)/);
  assert.match(tvSource, /readBrowserAccessToken\("customer"\)/);
  assert.match(tvSource, /readBrowserAccessToken\(\)/);
  assert.match(tvSource, /readBrowserAuthSession\(\)/);

  assert.match(tvSource, /const VIEWER_SESSION_KEY = "mydancrTvViewerSessionV1"/);
  assert.match(tvSource, /function readViewerSessionId\(\)/);
  assert.match(tvSource, /window\.localStorage\.getItem\(VIEWER_SESSION_KEY\)/);
  assert.match(tvSource, /window\.localStorage\.setItem\(VIEWER_SESSION_KEY, id\)/);
});
