import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  AvatarFaceRequiredError,
  AvatarFaceDetectionUnavailableError,
  computeAvatarCandidateCrops,
  computeFaceCenteredAvatarCrop,
  parseAvatarCandidateSelection,
} = await import(new URL("../src/lib/dancr/avatar-face-core.ts", import.meta.url));

const [avatarFaceSource, moderationSource, avatarRouteSource, recenterRouteSource, avatarMigration] = await Promise.all([
  readFile(new URL("../src/lib/dancr/avatar-face.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/avatar/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/avatars/recenter/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260912194200_make_avatar_publication_atomic.sql", import.meta.url), "utf8"),
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

test("body photos retain the full available width instead of zooming into the face", () => {
  for (const [width, height, position] of [[1000, 1600, "start"], [1600, 1000, "end"], [1000, 1000, "start"]]) {
    const candidate = computeAvatarCandidateCrops(width, height).find(crop => crop.position === position);
    const face = { left: 0.4, top: 0.2, right: 0.6, bottom: 0.4 };
    const crop = computeFaceCenteredAvatarCrop(width, height, candidate, face);
    assert.equal(crop.size, Math.min(width, height), "preserve the wider body-visible framing");
    assert.ok(Math.abs((candidate.left + 500 - crop.left) / crop.size - 0.5) < 0.005);
    assert.equal(crop.top, 0, "preserve the top of a portrait when the head is near the source edge");
    for (const x of [face.left, face.right]) for (const y of [face.top, face.bottom]) {
      const dx = candidate.left + x * candidate.size - crop.left - crop.size / 2;
      const dy = candidate.top + y * candidate.size - crop.top - crop.size / 2;
      assert.ok(Math.hypot(dx, dy) < crop.size * 0.45, "the full face must fit inside the avatar circle");
    }
  }
});

test("the circular avatar preserves the crown when a portrait starts close to the head", () => {
  const candidate = computeAvatarCandidateCrops(1000, 1250)[0];
  const face = { left: 0.36, top: 0.12, right: 0.6, bottom: 0.35 };
  const crop = computeFaceCenteredAvatarCrop(1000, 1250, candidate, face);
  // A rounded crown extends well above and beyond the detected face bounds.
  const headOutline = [[450, 20], [510, 20], [380, 55], [580, 55], [330, 110], [630, 110], [360, 350], [600, 350]];
  for (const [x, y] of headOutline) {
    const dx = x - crop.left - crop.size / 2;
    const dy = y - crop.top - crop.size / 2;
    assert.ok(Math.hypot(dx, dy) < crop.size * 0.49, "the crown and sides of the head must clear the circular edge");
  }
});

test("portrait candidate offsets map the face back into the original image", () => {
  const candidate = computeAvatarCandidateCrops(1000, 2000)[1];
  const crop = computeFaceCenteredAvatarCrop(1000, 2000, candidate, { left: 0.4, top: 0.2, right: 0.6, bottom: 0.4 });
  assert.deepEqual(crop, { position: "middle", left: 0, top: 270, size: 1000 });
});

test("face crops stay inside the source at every edge and for close-up portraits", () => {
  const candidate = computeAvatarCandidateCrops(900, 900)[0];
  for (const face of [
    { left: 0, top: 0, right: 0.2, bottom: 0.3 },
    { left: 0.8, top: 0.7, right: 1, bottom: 1 },
    { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 },
  ]) {
    const crop = computeFaceCenteredAvatarCrop(900, 900, candidate, face);
    assert.ok(crop.left >= 0 && crop.top >= 0 && crop.size > 0);
    assert.ok(crop.left + crop.size <= 900 && crop.top + crop.size <= 900);
    assert.ok(crop.left <= face.left * 900 && crop.top <= face.top * 900);
    assert.ok(crop.left + crop.size >= face.right * 900 && crop.top + crop.size >= face.bottom * 900);
  }
});

test("missing, malformed, or unbounded face coordinates never publish an arbitrary crop", () => {
  for (const faceBounds of [undefined, null, {},
    { left: "0.4", top: 0.2, right: 0.6, bottom: 0.4 },
    { left: 0.4, top: -0.2, right: 0.6, bottom: 0.4 },
    { left: 0.4, top: 0.2, right: 1.6, bottom: 0.4 },
    { left: 0.6, top: 0.2, right: 0.4, bottom: 0.4 },
    { left: 0.4, top: 0.2, right: 0.6, bottom: NaN },
  ]) {
    assert.throws(() => computeFaceCenteredAvatarCrop(1000, 1000,
      computeAvatarCandidateCrops(1000, 1000)[0], faceBounds), AvatarFaceDetectionUnavailableError);
  }
});

test("avatar uploads compare real square crops and publish the selected physical crop", () => {
  assert.match(avatarFaceSource, /openai\.responses\.create\(/);
  assert.match(avatarFaceSource, /Candidate \$\{candidate\.position\}/);
  assert.match(avatarFaceSource, /type: "input_image"/);
  assert.match(avatarFaceSource, /type: "json_schema"/);
  assert.match(avatarFaceSource, /selectedCandidate/);
  assert.match(avatarFaceSource, /computeFaceCenteredAvatarCrop\(sourceWidth, sourceHeight, candidate, face\)/);
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
  assert.match(recenterRouteSource, /createRequestSupabaseContext\(request\)/);
  assert.match(recenterRouteSource, /await requireAdmin\(client, user\.id\)/);
  assert.ok(
    recenterRouteSource.indexOf("await requireAdmin(client, user.id)")
      < recenterRouteSource.indexOf("readBoundedJsonObject(request"),
  );
  assert.match(recenterRouteSource, /timingSafeEqual\(expectedBuffer, providedBuffer\)/);
  assert.match(recenterRouteSource, /DANCR_MEDIA_IMPORT_KEY/);
  assert.match(recenterRouteSource, /\.eq\("slug", dancerSlug\)/);
  assert.match(recenterRouteSource, /\.from\("dancer_photos"\)[\s\S]*?\.eq\("review_status", "approved"\)/);
  assert.match(recenterRouteSource, /\.download\(sourcePath\)/);
  assert.match(recenterRouteSource, /prepareFaceCenteredAvatar\(sourceImage\)/);
  assert.match(recenterRouteSource, /recenterDancerAvatar\(admin, \{/);
  assert.match(recenterRouteSource, /reviewerId: user\.id, expected: dancer/);
  assert.match(recenterRouteSource, /sourcePath, sourcePhotoId: sourcePhoto\?\.id \?\? null/);
  assert.doesNotMatch(recenterRouteSource, /setApprovedDancerAvatar|restoreDancerAvatar/);
  assert.match(recenterRouteSource, /tryRetireGalleryStorageFiles/);
  assert.doesNotMatch(recenterRouteSource, /from\("admin_actions"\)\.insert/);
  assert.match(avatarMigration, /insert into public\.admin_actions\(admin_id,target_type,target_id,action,notes\)[\s\S]*?'recenter_dancer_avatar'/);
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
