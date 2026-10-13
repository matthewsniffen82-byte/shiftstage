import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [liveShell, tvFeed] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
]);

test("dancer discovery shows visible compact progress while clubs retain their loading card", () => {
  const start = liveShell.indexOf('    function homeDiscoveryLoadingStateMarkup(');
  const source = liveShell.slice(start, liveShell.indexOf('\n    }', start) + '\n    }'.length);
  const context = vm.createContext({ activeTab: 'dancers', escapeHtml: value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') });
  vm.runInContext(source, context);
  for (const tab of ['dancers', 'tonight']) {
    const markup = context.homeDiscoveryLoadingStateMarkup('Las Vegas', tab);
    assert.match(markup, /role="status".*aria-live="polite" aria-busy="true"/);
    assert.match(markup, /home-discovery-loading-spinner" aria-hidden="true"/);
    assert.match(markup, /<span>Loading (?:dancers|who is working) in Las Vegas…<\/span>/);
    assert.doesNotMatch(markup, /home-discovery-loading-card|home-discovery-loading-copy/);
  }
  const clubs = context.homeDiscoveryLoadingStateMarkup('Las Vegas', 'venues');
  assert.match(clubs, /class="home-discovery-loading-card" aria-hidden="true"/);
  assert.match(clubs, /aria-label="Loading clubs in Las Vegas"/);
  assert.doesNotMatch(clubs, /home-discovery-loading-spinner/);
  const escaped = context.homeDiscoveryLoadingStateMarkup('<img src=x>"', 'dancers');
  assert.ok(escaped.includes('&lt;img src=x&gt;&quot;'));
  assert.doesNotMatch(escaped, /<img/);
  assert.match(liveShell, /\.home-discovery-loading\.is-dancers \{[^}]*display: flex;[^}]*min-height: 120px;[^}]*color: #d4d4dc;/);
  assert.match(liveShell, /@media \(prefers-reduced-motion: reduce\) \{\s*\.home-discovery-loading-card::after,\s*\.home-discovery-loading-spinner \{ animation: none; \}/);
  assert.match(liveShell, /\.home-discovery-loading\.is-venues \.home-discovery-loading-card \{[\s\S]*?min-height: 390px/);
});

test("home TV uses a poster-shaped shell without a black loading box", () => {
  assert.match(liveShell, /className = "home-tv-feed-loading"[\s\S]*?home-tv-feed-loading-copy/);
  assert.match(liveShell, /\.home-tv-feed-loading \{[\s\S]*?min-height: var\(--dancr-scroll-card-height\)[\s\S]*?radial-gradient/);
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
