import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, tvFeed] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
]);

test("public discovery keeps final card geometry instead of visible loading copy", () => {
  assert.match(liveShell, /const cardCount = tabName === "venues" \? 1 : 3/);
  assert.match(liveShell, /class="home-discovery-loading-card" aria-hidden="true"/);
  assert.match(liveShell, /\.home-discovery-loading-card \{[\s\S]*?aspect-ratio: 9 \/ 16/);
  assert.match(liveShell, /\.home-discovery-loading\.is-venues \.home-discovery-loading-card \{[\s\S]*?min-height: 390px/);
  assert.match(liveShell, /aria-label="\$\{loadingLabel\}" aria-live="polite" aria-busy="true"/);
  assert.doesNotMatch(liveShell, /<strong>\$\{loadingLabel\}<\/strong>/);
  assert.doesNotMatch(liveShell, /"Loading clubs\.\.\."|"Loading live profiles\.\.\."/);
});

test("home TV uses a poster-shaped shell without a black loading box", () => {
  assert.match(liveShell, /className = "home-tv-feed-loading"[\s\S]*?home-tv-feed-loading-copy/);
  assert.match(liveShell, /\.home-tv-feed-loading \{[\s\S]*?min-height: clamp\(520px[\s\S]*?radial-gradient/);
  assert.match(liveShell, /\.home-tv-feed-loading-copy span:first-child/);
  assert.doesNotMatch(liveShell, /setHomeTvFeedCount\("Loading videos…"/);
  assert.match(liveShell, /id="homeTvLaunchCount" aria-live="polite">Videos<\/span>/);
  assert.match(liveShell, /count\.textContent = "Videos"/);
});

test("standalone TV renders a stable media card while its feed settles", () => {
  assert.match(tvFeed, /isLoading && !videos\.length \? \([\s\S]*?className="tv-slide tv-loading-slide"[\s\S]*?className="tv-loading-player"/);
  assert.match(tvFeed, /className="tv-sr-only" role="status">Loading MyDancr TV videos<\/span>/);
  assert.match(tvFeed, /\.tv-loading-player \{[\s\S]*?width: min\(100%, 620px\)[\s\S]*?height: 100%/);
  assert.doesNotMatch(tvFeed, /<div className="tv-loading" role="status">/);
  assert.match(tvFeed, /!isLoading && !videos\.length \? \([\s\S]*?className="tv-empty"/);
});
