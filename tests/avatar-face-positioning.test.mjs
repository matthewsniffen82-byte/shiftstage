import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const responsiveImages = readFileSync(
  new URL("../src/lib/dancr/responsive-image.ts", import.meta.url),
  "utf8",
);
const publicService = readFileSync(
  new URL("../src/lib/dancr/public.ts", import.meta.url),
  "utf8",
);
const tvService = readFileSync(
  new URL("../src/lib/dancr/tv.ts", import.meta.url),
  "utf8",
);
const dancerProfile = readFileSync(
  new URL("../app/dancers/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const tvFeed = readFileSync(
  new URL("../app/tv/TvFeedClient.tsx", import.meta.url),
  "utf8",
);
const liveShell = readFileSync(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("uploaded photos persist a content-aware focal point in their storage manifest", () => {
  assert.match(responsiveImages, /position: sharp\.strategy\.attention/);
  assert.match(responsiveImages, /attentionX \/ width/);
  assert.match(responsiveImages, /attentionY \/ height/);
  assert.match(
    responsiveImages,
    /\.m\$\{image\.width\}x\$\{image\.height\}\.f\$\{image\.focalX\}x\$\{image\.focalY\}/,
  );
  assert.match(responsiveImages, /imageFocalX: manifest\.focalX/);
  assert.match(responsiveImages, /imageFocalY: manifest\.focalY/);
});

test("public dancer and TV payloads carry the stored avatar focal point", () => {
  assert.match(publicService, /avatarPhotoFocalX: avatarPhoto\?\.imageFocalX \?\? 50/);
  assert.match(publicService, /avatarPhotoFocalY: avatarPhoto\?\.imageFocalY \?\? 50/);
  assert.match(publicService, /focalX: image\?\.imageFocalX \?\? 50/);
  assert.match(tvService, /avatarPhotoFocalX: avatarPhoto\?\.imageFocalX \?\? 50/);
  assert.match(tvService, /avatarPhotoFocalY: avatarPhoto\?\.imageFocalY \?\? 50/);
});

test("every public avatar surface uses the face-aware position without changing full-card media", () => {
  assert.match(dancerProfile, /height: "100%"[\s\S]*?objectFit: "cover"/);
  assert.match(dancerProfile, /const avatarPhoto = profile\.avatarPhotoUrl \|\| heroPhoto/);
  assert.match(dancerProfile, /objectPosition: imageFocalPointCss\(avatarPhotoFocalX, avatarPhotoFocalY\)/);
  assert.match(dancerProfile, /objectPosition:[\s\S]*?width: "100%"/);
  assert.match(tvFeed, /backgroundPosition: imageFocalPointCss\([\s\S]*?avatarPhotoFocalX,[\s\S]*?avatarPhotoFocalY/);
  assert.match(liveShell, /function avatarPhotoPosition\(focalX, focalY\)/);
  assert.match(liveShell, /function customAvatarPhotoAttrs\(/);
  assert.match(liveShell, /function publicAvatarPhotoUrl\(profile\)/);
  assert.match(liveShell, /dancerPhotoImage\.style\.objectPosition = dancerPhotoPosition/);
  assert.match(liveShell, /modalProfileAvatar\.style\.setProperty\([\s\S]*?"--custom-photo-position"/);
  assert.match(
    liveShell,
    /\.home-venue-discovery-lineup-avatar \{[\s\S]*?background-position: var\(--custom-photo-position, center\)/,
  );

  const fullCard = liveShell.match(
    /function homeDiscoveryFeedSlide\(profile,[\s\S]*?\n    function renderHomeDiscoveryFeedMessage/,
  )?.[0] || "";
  assert.match(fullCard, /const portraitPhotoAttrs = customPhotoAttrs\(/);
  assert.doesNotMatch(fullCard, /customAvatarPhotoAttrs\(/);
});
