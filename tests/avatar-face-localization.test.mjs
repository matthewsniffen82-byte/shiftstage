import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { avatarRuntime, avatarSample, detector } from "./helpers/avatar-face-runtime.mjs";

test("the locally bundled face cascade matches the reviewed upstream model", () => {
  const model = JSON.parse(readFileSync(new URL("../src/lib/dancr/vendor/pico/facefinder.json", import.meta.url), "utf8"));
  const buffer = Buffer.from(model.base64, "base64");
  assert.equal(buffer.length, 239632);
  assert.equal(createHash("sha256").update(buffer).digest("hex"), "d8014993e7298c7b1865d1f8b855d6dbf4ec5c808bf879e2091ab6837abf90cd");
});

test("pixel-based localization finds the face above the torso in a square portrait", async () => {
  const sample = await avatarSample();
  const face = await detector.locateAvatarFace(sample.buffer);
  assert.ok(face);
  assert.ok(face.left > 0.2 && face.right < 0.65);
  assert.ok(face.top < 0.1 && face.bottom < 0.4, "detect the face, not the upper body");
});

test("localization also finds a small face near the top of a full-body photo", async () => {
  const sample = await avatarSample({ left: 575, top: 469, width: 223, height: 225 });
  const face = await detector.locateAvatarFace(sample.buffer);
  assert.ok(face);
  assert.ok(face.left > 0.4 && face.right < 0.65);
  assert.ok(face.top < 0.06 && face.bottom < 0.16);
});

test("approved avatars enlarge the detected face while keeping it inside the circle", async () => {
  // The contact-sheet fixture starts at the forehead. Give this headshot test
  // actual source headroom; edge-clipped originals have separate coverage.
  const original = await avatarSample();
  const padded = await sharp(original.buffer).extend({ top: 60, bottom: 0, left: 30, right: 30, background: "#888" })
    .jpeg().toBuffer({ resolveWithObject: true });
  const sample = { ...original, buffer: padded.data, width: padded.info.width, height: padded.info.height };
  const originalFace = await detector.locateAvatarFace(sample.buffer);
  assert.ok(originalFace);
  const avatar = await avatarRuntime().prepareFaceCenteredAvatar(sample);
  assert.ok(avatar.width < Math.min(sample.width, sample.height), "crop around the head rather than the torso");
  assert.equal(avatar.width, avatar.height);
  assert.equal(avatar.contentType, "image/jpeg");
  assert.equal(avatar.sha256, createHash("sha256").update(avatar.buffer).digest("hex"));
  const face = await detector.locateAvatarFace(avatar.buffer);
  assert.ok(face);
  assert.ok(face.right - face.left > (originalFace.right - originalFace.left) * 1.2,
    "the face should be recognizable in a small avatar");
  for (const x of [face.left, face.right]) for (const y of [face.top, face.bottom]) {
    assert.ok(Math.hypot(x - .5, y - .5) < .5, "the face clears the circular mask");
  }
});

test("an unlocalized verified face retains its original square instead of a guessed crop", async () => {
  const sample = await avatarSample();
  const avatar = await avatarRuntime({ locate: async () => null }).prepareFaceCenteredAvatar(sample);
  assert.equal(avatar.width, 223);
  assert.equal(avatar.height, 223);
});

test("detector errors stop avatar generation instead of publishing an arbitrary crop", async () => {
  const sample = await avatarSample();
  const runtime = avatarRuntime({
    locate: async () => { throw new Error("Face detector unavailable"); },
  });
  await assert.rejects(runtime.prepareFaceCenteredAvatar(sample), /Face detector unavailable/);
});

test("flat images cannot generate a confident face location", async () => {
  const buffer = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#d4a28b" } }).jpeg().toBuffer();
  assert.equal(await detector.locateAvatarFace(buffer), null);
});
