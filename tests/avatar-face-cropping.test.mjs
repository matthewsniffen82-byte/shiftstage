import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  AvatarFaceRequiredError,
  computeAvatarSquareCrop,
  parseAvatarFaceAnalysis,
} = await import(new URL("../src/lib/dancr/avatar-face.ts", import.meta.url));

const [avatarFaceSource, moderationSource, avatarRouteSource] = await Promise.all([
  readFile(new URL("../src/lib/dancr/avatar-face.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/avatar/route.ts", import.meta.url), "utf8"),
]);

test("avatar face analysis accepts a clear primary face and rejects missing faces", () => {
  const analysis = parseAvatarFaceAnalysis({
    clearFace: true,
    faceCount: 1,
    primaryFace: {
      centerX: 52,
      centerY: 19,
      width: 21,
      height: 17,
      confidence: 0.97,
    },
    rejectionReason: "",
  });
  assert.equal(analysis.primaryFace.centerY, 19);
  assert.throws(
    () =>
      parseAvatarFaceAnalysis({
        clearFace: false,
        faceCount: 0,
        primaryFace: { centerX: 0, centerY: 0, width: 0, height: 0, confidence: 0 },
        rejectionReason: "No clear face",
      }),
    AvatarFaceRequiredError,
  );
});

test("avatar crop centers the face in a square while staying inside the source", () => {
  const crop = computeAvatarSquareCrop(
    { centerX: 52, centerY: 19, width: 21, height: 17, confidence: 0.97 },
    784,
    1168,
  );
  assert.equal(crop.size, 640);
  assert.ok(crop.left >= 0);
  assert.ok(crop.left + crop.size <= 784);
  assert.ok(crop.top >= 0);
  assert.ok(crop.top + crop.size <= 1168);
  assert.ok(0.52 * 784 >= crop.left && 0.52 * 784 <= crop.left + crop.size);
  assert.ok(0.19 * 1168 >= crop.top && 0.19 * 1168 <= crop.top + crop.size);
});

test("avatar crop refuses a face too small to produce a dependable avatar", () => {
  assert.throws(
    () =>
      computeAvatarSquareCrop(
        { centerX: 50, centerY: 20, width: 2, height: 2, confidence: 0.99 },
        1200,
        1800,
      ),
    AvatarFaceRequiredError,
  );
});

test("avatar uploads use structured face detection and a physical square crop", () => {
  assert.match(avatarFaceSource, /openai\.responses\.create\(/);
  assert.match(avatarFaceSource, /type: "input_image"/);
  assert.match(avatarFaceSource, /type: "json_schema"/);
  assert.match(avatarFaceSource, /\.extract\(\{ left: crop\.left, top: crop\.top, width: crop\.size, height: crop\.size \}\)/);
  assert.match(avatarFaceSource, /width !== height/);
  assert.match(moderationSource, /const publicationImage = isAvatar[\s\S]*?prepareFaceCenteredAvatar\(image\)/);
  assert.match(moderationSource, /image: publicationImage/);
  assert.match(avatarRouteSource, /isAvatarFaceRequiredError\(error\)[\s\S]*?422/);
  assert.match(avatarRouteSource, /isAvatarFaceDetectionUnavailableError\(error\)[\s\S]*?503/);
});

test("gallery photo processing remains separate from avatar face cropping", () => {
  assert.match(moderationSource, /const publicationImage = isAvatar[\s\S]*?: image/);
  assert.match(moderationSource, /input\.isAvatar[\s\S]*?\? \{\}[\s\S]*?: \{ archiveOriginal: true, watermark: true \}/);
});
