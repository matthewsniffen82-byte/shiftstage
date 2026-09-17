import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { AvatarFaceRequiredError } from "../src/lib/dancr/avatar-face-core.ts";
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

test("approved avatars preserve the wider portrait framing before being stored", async () => {
  const sample = await avatarSample();
  const originalFace = await detector.locateAvatarFace(sample.buffer);
  assert.ok(originalFace);
  const avatar = await avatarRuntime().prepareFaceCenteredAvatar(sample);
  assert.equal(avatar.width, Math.min(sample.width, sample.height), "keep the body visible without zooming into the face");
  assert.equal(avatar.width, avatar.height);
  assert.equal(avatar.contentType, "image/jpeg");
  assert.equal(avatar.sha256, createHash("sha256").update(avatar.buffer).digest("hex"));
  const face = await detector.locateAvatarFace(avatar.buffer);
  assert.ok(face);
  assert.ok(Math.abs(face.top - originalFace.top) < 0.02, "preserve the source headroom near the top edge");
  assert.ok(Math.abs((face.right - face.left) - (originalFace.right - originalFace.left)) < 0.02,
    "keep the face at its original scale within the square");
});

test("an unlocalized verified face retains its original square instead of a guessed crop", async () => {
  const sample = await avatarSample();
  const avatar = await avatarRuntime({ locate: async () => null }).prepareFaceCenteredAvatar(sample);
  assert.equal(avatar.width, 223);
  assert.equal(avatar.height, 223);
});

test("local face detection never bypasses the existing face verification", async () => {
  const sample = await avatarSample();
  const runtime = avatarRuntime({
    createResponse: async () => ({ output_text: JSON.stringify({ clearFace: false, fullyVisible: false, selectedCandidate: "none", confidence: 0.99 }) }),
    locate: async () => assert.fail("rejected images must not proceed to cropping"),
  });
  await assert.rejects(runtime.prepareFaceCenteredAvatar(sample), AvatarFaceRequiredError);
});

test("flat images cannot generate a confident face location", async () => {
  const buffer = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#d4a28b" } }).jpeg().toBuffer();
  assert.equal(await detector.locateAvatarFace(buffer), null);
});
