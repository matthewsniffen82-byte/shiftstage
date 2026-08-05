import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const liveApp = fs.readFileSync("outputs/index.html", "utf8");
const publicPhotoCarousel = fs.readFileSync(
  "app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "utf8",
);
const publicProfilePage = fs.readFileSync("app/dancers/[slug]/page.tsx", "utf8");

test("full dancer profiles share the exact photo or TV video being viewed", () => {
  assert.match(
    publicPhotoCarousel,
    /function viewerShareUrl\(item: ProfileMedia, index: number\)[\s\S]*?item\.kind === "video"[\s\S]*?`\/tv\/\$\{encodeURIComponent\(item\.id\)\}`[\s\S]*?url\.searchParams\.set\("media", "photo"\)[\s\S]*?url\.searchParams\.set\("mediaIndex", String\(index\)\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /async function shareViewerItem\(\)[\s\S]*?navigator\.share\([\s\S]*?await copyViewerShareUrl\(url\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /aria-label=\{`Share this \$\{viewer\.kind === "photo" \? "photo" : "TV video"\}`\}[\s\S]*?className="profile-media-viewer-share"[\s\S]*?onClick=\{shareViewerItem\}/,
  );
  assert.match(publicPhotoCarousel, /className="profile-media-viewer-share-status"/);
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-share \{[^}]*min-height: 40px;[^}]*border-radius: 999px;/,
  );
});

test("shared profile-photo links reopen the exact selected photo", () => {
  assert.match(
    publicPhotoCarousel,
    /params\.get\("media"\) !== "photo"[\s\S]*?Number\(params\.get\("mediaIndex"\)\)[\s\S]*?setViewer\(\{ kind: "photo", index \}\)/,
  );
  assert.match(
    liveApp,
    /function profilePhotoShareUrl\(profileName, city = selectedCity\(\), photoIndex = 0\)[\s\S]*?url\.searchParams\.set\("media", "photo"\)[\s\S]*?url\.searchParams\.set\("mediaIndex"/,
  );
  assert.match(liveApp, /id="profilePhotoViewerShare"[^>]*aria-label="Share this profile photo"/);
  assert.match(
    liveApp,
    /async function shareProfilePhoto\(\)[\s\S]*?profilePhotoShareUrl\(profileName, citySelect\.value \|\| selectedCity\(\), activePhotoIndex\)[\s\S]*?navigator\.share\([\s\S]*?copyText\(url, "Photo link copied"\)/,
  );
  assert.match(
    liveApp,
    /function openSharedProfileMedia\(params\)[\s\S]*?selectModalMediaThumb\(photoThumbs\[photoIndex\], \{ syncViewer: true \}\)[\s\S]*?openPhotoViewerFromElement\(modalImage\)/,
  );
  assert.match(
    liveApp,
    /openProfileModal\(profile\.name\);[\s\S]*?openSharedProfileMedia\(params\);/,
  );
  assert.match(
    liveApp,
    /function clearProfileDeepLink\(\)[\s\S]*?url\.searchParams\.delete\("media"\)[\s\S]*?url\.searchParams\.delete\("mediaIndex"\)/,
  );
});

test("profile media sharing keeps video downloads disabled", () => {
  assert.match(
    publicPhotoCarousel,
    /controlsList="nofullscreen noremoteplayback nodownload"[\s\S]*?src=\{activeViewerItem\.videoUrl\}/,
  );
  assert.match(
    liveApp,
    /controlslist="nofullscreen noremoteplayback nodownload"[\s\S]*?async function shareProfileTvVideo\(\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(videoId\)\}`/,
  );
});
