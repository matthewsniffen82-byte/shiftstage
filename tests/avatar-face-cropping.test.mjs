import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  AvatarFaceRequiredError,
  computeAvatarCandidateCrops,
  parseAvatarCandidateSelection,
} = await import(new URL("../src/lib/dancr/avatar-face.ts", import.meta.url));

const [avatarFaceSource, moderationSource, avatarRouteSource, recenterRouteSource] = await Promise.all([
  readFile(new URL("../src/lib/dancr/avatar-face.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/avatar/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/avatars/recenter/route.ts", import.meta.url), "utf8"),
]);

test("avatar candidate selection accepts a complete visible face and rejects missing faces", () => {
  const selection = parseAvatarCandidateSelection(
    {
      clearFace: true,
      fullyVisible: true,
      selectedCandidate: "start",
      confidence: 0.97,
      rejectionReason: "",
    },
    ["start", "middle", "end"],
  );
  assert.equal(selection.selectedCandidate, "start");
  assert.throws(
    () =>
      parseAvatarCandidateSelection(
        {
          clearFace: false,
          fullyVisible: false,
          selectedCandidate: "none",
          confidence: 0.99,
          rejectionReason: "No complete face",
        },
        ["start", "middle", "end"],
      ),
    AvatarFaceRequiredError,
  );
});

test("avatar candidate selection cannot choose a crop that was not supplied", () => {
  assert.throws(
    () =>
      parseAvatarCandidateSelection(
        {
          clearFace: true,
          fullyVisible: true,
          selectedCandidate: "end",
          confidence: 0.99,
          rejectionReason: "",
        },
        ["start"],
      ),
    AvatarFaceRequiredError,
  );
});

test("portrait uploads generate top, middle, and bottom square candidates", () => {
  assert.deepEqual(computeAvatarCandidateCrops(768, 1360), [
    { position: "start", left: 0, top: 0, size: 768 },
    { position: "middle", left: 0, top: 296, size: 768 },
    { position: "end", left: 0, top: 592, size: 768 },
  ]);
});

test("landscape uploads generate left, middle, and right square candidates", () => {
  assert.deepEqual(computeAvatarCandidateCrops(1360, 768), [
    { position: "start", left: 0, top: 0, size: 768 },
    { position: "middle", left: 296, top: 0, size: 768 },
    { position: "end", left: 592, top: 0, size: 768 },
  ]);
});

test("square uploads produce one candidate without duplicate analysis", () => {
  assert.deepEqual(computeAvatarCandidateCrops(900, 900), [
    { position: "start", left: 0, top: 0, size: 900 },
  ]);
});

test("avatar uploads compare real square crops and publish the selected physical crop", () => {
  assert.match(avatarFaceSource, /openai\.responses\.create\(/);
  assert.match(avatarFaceSource, /Candidate \$\{candidate\.position\}/);
  assert.match(avatarFaceSource, /type: "input_image"/);
  assert.match(avatarFaceSource, /type: "json_schema"/);
  assert.match(avatarFaceSource, /selectedCandidate/);
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

test("existing approved avatars can be securely reprocessed from an original approved photo", () => {
  assert.match(recenterRouteSource, /timingSafeEqual\(expectedBuffer, providedBuffer\)/);
  assert.match(recenterRouteSource, /DANCR_MEDIA_IMPORT_KEY/);
  assert.match(recenterRouteSource, /\.eq\("slug", dancerSlug\)/);
  assert.match(recenterRouteSource, /\.from\("dancer_photos"\)[\s\S]*?\.eq\("review_status", "approved"\)/);
  assert.match(recenterRouteSource, /\.download\(sourcePath\)/);
  assert.match(recenterRouteSource, /prepareFaceCenteredAvatar\(sourceImage\)/);
  assert.match(recenterRouteSource, /setApprovedDancerAvatar/);
  assert.match(recenterRouteSource, /restoreDancerAvatar/);
  assert.match(recenterRouteSource, /removeResponsiveImage/);
});

test("avatar maintenance bounds metadata and keeps infrastructure failures private", () => {
  assert.match(recenterRouteSource, /const MAX_RECENTER_BODY_BYTES = 4_096/);
  assert.match(recenterRouteSource, /readBoundedJsonObject\(request, \{/);
  assert.match(recenterRouteSource, /maxBytes: MAX_RECENTER_BODY_BYTES/);
  assert.match(
    recenterRouteSource,
    /tooLargeMessage: "Avatar maintenance request is too large\."/,
  );
  assert.match(recenterRouteSource, /throw forbidden\("Avatar maintenance access denied\."\)/);
  assert.match(recenterRouteSource, /new PublicApiError\("NOT_FOUND"/);
  assert.match(recenterRouteSource, /new PublicApiError\([\s\S]*?"CONFLICT"/);
  assert.match(recenterRouteSource, /return apiError\(error, "Unable to recenter dancer avatar\."\)/);
  assert.doesNotMatch(
    recenterRouteSource,
    /apiError\(error, "Unable to recenter dancer avatar\.", 400\)/,
  );
});
