import assert from "node:assert/strict";
import test from "node:test";
import { videoDecoderFixture, storedVideoFixture } from "./helpers/video-decoder-fixture.mjs";

const inspector = "src/lib/dancr/video-upload-validation.ts";
const output = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':\n  Duration: 00:00:01.000, start: 0.000000, bitrate: 8 kb/s\n  Stream #0:0: Video: h264, yuv420p, 240x320 [SAR 1:1 DAR 3:4]";
const iso = Buffer.alloc(32); iso.write("ftyp", 4);
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("synthetic-webm")]);
const rejected = [
  ["HTML", Buffer.from("<html>synthetic</html>")],
  ["SVG", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")],
  ["PDF", Buffer.from("%PDF-1.7 synthetic")],
  ["playlist", Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1/synthetic.ts\n")],
  ["PNG", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")],
  ["WAV", Buffer.from("RIFF0000WAVEfmt synthetic")],
  ["truncated ISO header", Buffer.from("0000000866747970", "hex")],
];
for (const mime of ["video/mp4", "video/quicktime", "video/webm"]) for (const [label, buffer] of rejected) test(`${label} claimed as ${mime} is rejected before a decoder or temporary file is created`, async () => {
  const f = videoDecoderFixture(inspector, { output }), stored = storedVideoFixture(buffer, mime);
  await assert.rejects(f.exports.inspectStoredMyDancrTvVideo(stored.admin, stored.input));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.files, []);
});
for (const [buffer, mime] of [[iso, "video/webm"], [webm, "video/mp4"], [webm, "video/quicktime"], [iso, "application/octet-stream"]]) test(`container/MIME mismatch for ${mime} is rejected before decoding`, async () => {
  const f = videoDecoderFixture(inspector, { output }), stored = storedVideoFixture(buffer, mime);
  await assert.rejects(f.exports.inspectStoredMyDancrTvVideo(stored.admin, stored.input), /format does not match/);
  assert.equal(f.calls.length, 0);
});
for (const [buffer, mime] of [[iso, "video/mp4"], [iso, "video/quicktime"], [webm, "video/webm"]]) test(`${mime} retains post-decoder validation of actual dimensions and duration`, async () => {
  const text = mime === "video/webm" ? output.replace("mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm") : output;
  const f = videoDecoderFixture(inspector, { output: text }), stored = storedVideoFixture(buffer, mime);
  const result = await f.exports.inspectStoredMyDancrTvVideo(stored.admin, stored.input);
  assert.equal(result.durationSeconds, 1); assert.equal(result.width, 240); assert.equal(result.height, 320);
  assert.equal(f.calls.length, 1);
});
for (const patch of [{ expectedBytes: iso.length + 1 }, { maxBytes: iso.length - 1 }]) test("byte mismatch or an oversized stored object never reaches the decoder", async () => {
  const f = videoDecoderFixture(inspector, { output }), stored = storedVideoFixture(iso, "video/mp4", patch);
  await assert.rejects(f.exports.inspectStoredMyDancrTvVideo(stored.admin, stored.input), /size could not be verified/);
  assert.equal(f.calls.length, 0);
});

for (const [file, extra, invoke] of [
  [inspector, "\nexport { inspectVideoWithFfmpeg };", exports => exports.inspectVideoWithFfmpeg("synthetic.mp4")],
  ["src/lib/dancr/video-moderation.ts", "\nexport { runFfmpeg };", exports => exports.runFfmpeg(["-i", "synthetic.mp4", "-f", "null", "-"])],
  ["src/lib/dancr/media-watermark.ts", "\nexport { runVideoPosterFfmpeg };", exports => exports.runVideoPosterFfmpeg("synthetic.mp4", "synthetic.png")],
  ["src/lib/dancr/media-watermark.ts", "\nexport { runVideoWatermarkFfmpeg };", exports => exports.runVideoWatermarkFfmpeg({ sourcePath: "synthetic.mp4", overlayPath: "generated.png", resultPath: "result.mp4", storageMime: "video/mp4", width: 240, height: 320 })],
]) test(`${file} restricts untrusted video input protocols and demuxers`, async () => {
  const f = videoDecoderFixture(file, { extra, output });
  await invoke(f.exports);
  const args = f.calls[0].args, inputIndex = args.indexOf("-i");
  for (const option of ["-protocol_whitelist", "-format_whitelist", "-max_pixels"]) assert.ok(args.indexOf(option) >= 0 && args.indexOf(option) < inputIndex);
  assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file");
  assert.deepEqual(args[args.indexOf("-format_whitelist") + 1].split(",").sort(), ["matroska", "mov", "webm"]);
  assert.equal(Number(args[args.indexOf("-max_pixels") + 1]), 7680 ** 2);
  assert.equal(f.calls[0].options.windowsHide, true);
});
