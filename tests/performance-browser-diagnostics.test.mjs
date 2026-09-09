import assert from "node:assert/strict";
import test from "node:test";
import { isWebkitNavigationCancellation } from "../scripts/performance/browser-diagnostics.mjs";
for (const path of ["/api/public/tv", "/api/public/tv/count"]) {
  test(`a matched WebKit navigation cancellation is retained as a diagnostic: ${path}`, () => {
    const error = { message: `/www.mydancr.com${path}?city=Las+Vegas due to access control checks.`, stack: "at web-inspector://bootstrap.js:365:20", lastCompletedPhase: "venue-route" };
    const request = { path, failure: "Load request cancelled", lastCompletedPhase: "venue-route" };
    assert.equal(isWebkitNavigationCancellation(error, [request], "webkit"), true);
    assert.equal(isWebkitNavigationCancellation(error, [request], "chromium"), false);
    assert.equal(isWebkitNavigationCancellation(error, [], "webkit"), false);
    assert.equal(isWebkitNavigationCancellation(error, [{ ...request, path: "/api/public/discovery" }], "webkit"), false);
    assert.equal(isWebkitNavigationCancellation(error, [{ ...request, lastCompletedPhase: "different-page" }], "webkit"), false);
    assert.equal(isWebkitNavigationCancellation(error, [{ ...request, failure: "Failed to fetch" }], "webkit"), false);
    assert.equal(isWebkitNavigationCancellation({ ...error, stack: "at application.js" }, [request], "webkit"), false);
    assert.equal(isWebkitNavigationCancellation({ ...error, message: "TypeError: failed to render" }, [request], "webkit"), false);
  });
}
