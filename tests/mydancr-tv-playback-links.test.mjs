import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const feedClient = fs.readFileSync("app/tv/TvFeedClient.tsx", "utf8");

test("MyDancr TV separates video playback from profile navigation", () => {
  assert.doesNotMatch(
    feedClient,
    /<Link[\s\r\n]+className="tv-profile-card"/,
  );
  assert.match(
    feedClient,
    /<div className="tv-profile-card">[\s\S]*?<video[\s\S]*?role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?onClick=\{\(event\) => toggleVideoPlayback\(video\.id, event\.currentTarget\)\}/,
  );
  assert.match(
    feedClient,
    /function toggleVideoPlayback\(videoId: string, element: HTMLVideoElement\) \{[\s\S]*?element\.paused[\s\S]*?attemptVideoPlayback\(videoId, element\)[\s\S]*?element\.pause\(\)/,
  );
  assert.match(
    feedClient,
    /className="tv-card-stage-link"[\s\S]*?href=\{dancerLiveProfileHref\(video\)\}[\s\S]*?video\.dancer\.stageName/,
  );
  assert.match(
    feedClient,
    /function dancerLiveProfileHref\(video: MyDancrTvVideo\) \{\s+const slug = video\.dancer\.slug\.trim\(\);\s+return slug \? `\/dancers\/\$\{encodeURIComponent\(slug\)\}` : "\/dancers";\s+\}/,
  );
  assert.doesNotMatch(
    feedClient,
    /return `\/\?city=\$\{encodeURIComponent\(city\)\}&profile=\$\{encodeURIComponent\(profile\)\}`/,
  );
  assert.match(
    feedClient,
    /className="tv-profile-destination"[\s\S]*?View Profile[\s\S]*?→/,
  );
  assert.match(
    feedClient,
    /className="tv-card-venue-line"[\s\S]*?href=\{venueLiveProfileHref\(video\)\}[\s\S]*?video\.venue\.name/,
  );
  assert.match(
    feedClient,
    /function venueLiveProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?video\.venue\.slug\.trim\(\)[\s\S]*?return `\/venues\/\$\{encodeURIComponent\(venue\)\}`/,
  );
});
