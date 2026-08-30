import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("public discovery cannot remain in a permanent loading state", () => {
  assert.match(homeSource, /const LIVE_JSON_REQUEST_TIMEOUT_MS = 12000/);
  assert.match(homeSource, /const PUBLIC_DISCOVERY_REQUEST_RETRIES = 1/);
  assert.match(homeSource, /Promise\.race\(\[\s*fetch\(url,/);
  assert.match(homeSource, /if \(controller\) controller\.abort\(\)/);
  assert.match(
    homeSource,
    /fetchJson\(`\/api\/public\/discovery\?\$\{query\}`, \{\s*timeoutMs: LIVE_JSON_REQUEST_TIMEOUT_MS,\s*retries: PUBLIC_DISCOVERY_REQUEST_RETRIES\s*\}\)/,
  );
  assert.match(homeSource, /liveMarketState\[city\] = hasCurrentResults \? "ready" : "error"/);
});

test("a transient discovery failure retries without erasing already rendered public content", () => {
  assert.match(homeSource, /const hasCurrentResults = Boolean\(markets\[city\]\?\.dancers\?\.length \|\| markets\[city\]\?\.venues\?\.length\)/);
  assert.match(homeSource, /liveMarketState\[city\] = hasCurrentResults \? "ready" : "error"/);
  assert.doesNotMatch(homeSource, /markets\[city\]\.dancers = \[\]/);
  assert.doesNotMatch(homeSource, /markets\[city\]\.stats\.dancers = 0/);
  assert.match(homeSource, /unavailableDiscovery[\s\S]*?\? "Unavailable"/);
  assert.match(homeSource, /unavailable[\s\S]*?\? "Live results unavailable"/);
});

test("failed discovery offers an in-place retry instead of a false empty state", () => {
  assert.match(homeSource, /data-retry-live-discovery="\$\{escapeHtml\(city\)\}"/);
  assert.match(homeSource, /Live \$\{contentLabel\} could not load\./);
  assert.match(homeSource, /const liveDiscoveryRetry = event\.target\.closest\("\[data-retry-live-discovery\]"\)/);
  assert.match(homeSource, /loadLiveDiscovery\(retryCity, \{ force: true \}\)/);
});
