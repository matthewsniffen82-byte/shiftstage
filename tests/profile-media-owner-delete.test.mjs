import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [shell, carousel, uploads, dancer, tv] = await Promise.all([
  read("outputs/index.html"), read("app/dancers/[slug]/DancerPhotoCarousel.tsx"),
  read("app/dashboard/DancerProfileMediaUploads.tsx"), read("src/lib/dancr/dancer.ts"), read("src/lib/dancr/tv.ts"),
]);

test("signed-in full-profile grids and viewers have no owner media management controls", () => {
  assert.doesNotMatch(shell, /verifyProfileMediaOwner|syncProfileMediaDeleteControls|profileMediaDeleteButton|profileMediaPinMenu|deleteOpenProfileMedia|pinOpenProfileMedia/);
  assert.doesNotMatch(carousel, /canDeleteMedia|deleteMedia|pinMedia|DancerMediaPinButton|profile-media-delete|profile-media-viewer-delete/);
  assert.doesNotMatch(carousel, /fetch\("\/api\/dancer\/profile"/);
  assert.match(carousel, /function orderPinnedMedia/);
  assert.match(carousel, /className="profile-media-grid-cell"/);
  assert.match(carousel, /className="profile-media-viewer-actions"/);
  assert.match(shell, /function profilePhotoThumbMarkup/);
});

test("dashboard previews retain confirmed deletion and approved-only pin options", () => {
  assert.match(uploads, /window\.confirm\("Delete this photo from your profile\?"\)/);
  assert.match(uploads, /window\.confirm\("Delete this video from your profile\?"\)/);
  assert.match(uploads, /className="profile-upload-delete"/);
  assert.match(uploads, /onMediaPinned && item\.status === "approved" \? <DancerMediaPinButton/);
  assert.match(dancer, /\.eq\("id", photoId\)[\s\S]*?\.eq\("dancer_id", profile\.id\)/);
  assert.match(tv, /function hideOwnMyDancrTvVideo[\s\S]*?\.eq\("id", videoId\)[\s\S]*?\.eq\("submitted_by", userId\)/);
});
