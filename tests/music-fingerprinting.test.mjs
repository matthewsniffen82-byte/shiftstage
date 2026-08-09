import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAcrCloudSignature,
  evaluateAcrCloudMusicResponse,
  fingerprintMusicSamples,
  getMusicFingerprintSampleOffsets,
} from "../src/lib/dancr/music-fingerprinting.ts";

test("music fingerprint sampling covers short and full-length TV uploads", () => {
  assert.deepEqual(getMusicFingerprintSampleOffsets(7), [0]);
  assert.deepEqual(getMusicFingerprintSampleOffsets(20), [0, 5, 10]);
  assert.deepEqual(getMusicFingerprintSampleOffsets(30), [0, 10, 20]);
  assert.throws(() => getMusicFingerprintSampleOffsets(0), /duration could not be determined/);
});

test("ACRCloud signatures follow the Identification API v1 protocol", () => {
  const timestamp = 1_700_000_000;
  const expected = createHmac("sha1", "test-secret")
    .update([
      "POST",
      "/v1/identify",
      "test-access-key",
      "audio",
      "1",
      String(timestamp),
    ].join("\n"), "utf8")
    .digest("base64");

  assert.equal(createAcrCloudSignature({
    accessKey: "test-access-key",
    accessSecret: "test-secret",
    timestamp,
  }), expected);
});

test("ACRCloud music responses retain bounded rights evidence", () => {
  const matches = evaluateAcrCloudMusicResponse({
    status: { code: 0, msg: "Success" },
    metadata: {
      music: [{
        acrid: "acr-123",
        title: "Recognized Song",
        artists: [{ name: "Artist One" }],
        album: { name: "Album One" },
        label: "Label One",
        score: 96,
        play_offset_ms: 12345,
        external_ids: { isrc: "USAAA2600001" },
      }],
    },
  }, 10);

  assert.deepEqual(matches, [{
    acrid: "acr-123",
    title: "Recognized Song",
    artists: ["Artist One"],
    album: "Album One",
    label: "Label One",
    isrc: "USAAA2600001",
    score: 96,
    sampleOffsetsSeconds: [10],
    playOffsetMs: 12345,
  }]);
  assert.deepEqual(evaluateAcrCloudMusicResponse({
    status: { code: 1001, msg: "No result" },
  }, 0), []);
  assert.throws(() => evaluateAcrCloudMusicResponse({
    status: { code: 3003, msg: "Limit exceeded" },
  }, 0), /unsuccessful response/);
});

test("recognized commercial music enters human review with auditable metadata", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-music-test-"));
  const samplePath = path.join(workspace, "sample.mp3");
  await writeFile(samplePath, Buffer.from("bounded-test-audio"));

  try {
    let requestCount = 0;
    const result = await fingerprintMusicSamples(
      [{ path: samplePath, offsetSeconds: 0 }],
      {
        credentials: {
          host: "identify-us-west-2.acrcloud.com",
          accessKey: "test-access-key",
          accessSecret: "test-secret",
        },
        now: () => 1_700_000_000_000,
        fetchImpl: async (url, init) => {
          requestCount += 1;
          assert.equal(String(url), "https://identify-us-west-2.acrcloud.com/v1/identify");
          assert.equal(init?.method, "POST");
          assert.ok(init?.body instanceof FormData);
          assert.equal(init.body.get("data_type"), "audio");
          assert.equal(init.body.get("signature_version"), "1");
          assert.equal(init.body.get("access_key"), "test-access-key");
          assert.ok(init.body.get("signature"));
          assert.ok(init.body.get("sample") instanceof Blob);
          return new Response(JSON.stringify({
            status: { code: 0, msg: "Success" },
            metadata: {
              music: [{
                acrid: "acr-commercial",
                title: "Commercial Track",
                artists: [{ name: "Known Artist" }],
                score: 93,
                external_ids: { isrc: "USAAA2600002" },
              }],
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );

    assert.equal(requestCount, 1);
    assert.equal(result.decision, "review");
    assert.deepEqual(result.reasonCodes, ["music_rights_match_requires_review"]);
    assert.equal(result.details.provider, "acrcloud");
    assert.equal(result.details.reviewRequired, true);
    assert.equal(result.details.matches[0].isrc, "USAAA2600002");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("no audio or no catalog match permits the safety decision to continue", async () => {
  const noAudio = await fingerprintMusicSamples([]);
  assert.equal(noAudio.decision, "approved");
  assert.equal(noAudio.details.status, "no_audio");

  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-music-none-"));
  const samplePath = path.join(workspace, "sample.mp3");
  await writeFile(samplePath, Buffer.from("bounded-test-audio"));
  try {
    const noMatch = await fingerprintMusicSamples(
      [{ path: samplePath, offsetSeconds: 0 }],
      {
        credentials: {
          host: "identify-us-west-2.acrcloud.com",
          accessKey: "test-access-key",
          accessSecret: "test-secret",
        },
        fetchImpl: async () => new Response(JSON.stringify({
          status: { code: 1001, msg: "No result" },
        }), { status: 200 }),
      },
    );
    assert.equal(noMatch.decision, "approved");
    assert.deepEqual(noMatch.reasonCodes, ["music_fingerprint_no_match"]);
    assert.equal(noMatch.details.status, "no_match");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("music fingerprinting rejects untrusted provider hosts", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-music-host-"));
  const samplePath = path.join(workspace, "sample.mp3");
  await writeFile(samplePath, Buffer.from("bounded-test-audio"));
  try {
    await assert.rejects(
      fingerprintMusicSamples(
        [{ path: samplePath, offsetSeconds: 0 }],
        {
          credentials: {
            host: "https://example.com",
            accessKey: "test-access-key",
            accessSecret: "test-secret",
          },
          fetchImpl: async () => {
            throw new Error("must not be called");
          },
        },
      ),
      /ACRCloud HTTPS identification host/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
