import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const liveApp = fs.readFileSync("outputs/index.html", "utf8");
const publicPhotoCarousel = fs.readFileSync(
  "app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "utf8",
);
const publicProfilePage = fs.readFileSync("app/dancers/[slug]/page.tsx", "utf8");

test("full dancer profiles share the exact TV video being viewed", () => {
  assert.match(
    publicPhotoCarousel,
    /function viewerShareUrl\(item: ProfileMedia\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(item\.id\)\}`[\s\S]*?url\.searchParams\.set\("media", "photo"\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /async function shareViewerItem\(\)[\s\S]*?navigator\.share\([\s\S]*?await copyViewerShareUrl\(url\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /aria-label=\{activeViewerItem\.kind === "video" \? "Share this TV video" : "Share this profile photo"\}[\s\S]*?className="profile-media-viewer-share"[\s\S]*?onClick=\{shareViewerItem\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /setShareStatus\(isVideo \? "Video shared\." : "Photo shared\."\)[\s\S]*?setShareStatus\(isVideo \? "Video link copied\." : "Photo link copied\."\)/,
  );
  assert.match(publicPhotoCarousel, /className="profile-media-viewer-share-status"/);
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-share \{[^}]*min-height: 40px;[^}]*border-radius: 999px;/,
  );
});

test("shared profile-photo links open the exact photo in the full-screen collection", () => {
  assert.match(
    publicPhotoCarousel,
    /const requestedKind = params\.get\("media"\)[\s\S]*?Number\(params\.get\("mediaIndex"\)\)[\s\S]*?setActiveTab\(requestedKind\);[\s\S]*?setViewer\(\{ kind: requestedKind, index \}\);/,
  );
  assert.doesNotMatch(publicPhotoCarousel, /setActiveIndex/);
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
    /function openSharedProfileMedia\(params\)[\s\S]*?selectModalMediaThumb\(photoThumbs\[photoIndex\], \{ syncViewer: true \}\);[\s\S]*?openPhotoViewerFromElement\(modalImage, photoIndex\);/,
  );
  const sharedPhotoHandler = liveApp.match(
    /function openSharedProfileMedia\(params\)[\s\S]*?(?=\n    async function openSharedProfileFromUrl)/,
  )?.[0] || "";
  assert.match(sharedPhotoHandler, /syncViewer: true[\s\S]*?openPhotoViewerFromElement\(modalImage, photoIndex\)/);
  assert.match(
    liveApp,
    /openProfileModal\(profileReferenceValue\(profile\)\);[\s\S]*?openSharedProfileMedia\(params\);/,
  );
  assert.match(
    liveApp,
    /function clearProfileDeepLink\(\)[\s\S]*?url\.searchParams\.delete\("media"\)[\s\S]*?url\.searchParams\.delete\("mediaIndex"\)/,
  );
});

test("profile media sharing keeps video downloads disabled", () => {
  assert.match(
    publicPhotoCarousel,
    /controlsList="nofullscreen noremoteplayback nodownload"[\s\S]*?src=\{index === viewerIndex[\s\S]*?\? item\.videoUrl : undefined\}/,
  );
  assert.match(
    liveApp,
    /video\.setAttribute\("controlslist", "nofullscreen noremoteplayback nodownload"\)[\s\S]*?async function shareProfileTvVideo\(\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(videoId\)\}`/,
  );
});
