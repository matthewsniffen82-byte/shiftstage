import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:http";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { createDancrVideoPoster } from "../src/lib/dancr/media-watermark.ts";
import { LOCAL_VIDEO_INPUT_OPTIONS } from "../src/lib/dancr/local-video-input.ts";
import { videoDecoderFixture, storedVideoFixture } from "./helpers/video-decoder-fixture.mjs";

const run = promisify(execFile);
for (const [extension, mime, hasAudio] of [["mp4", "video/mp4", true], ["mov", "video/quicktime", false], ["webm", "video/webm", true]]) test(`real ${extension} media remains inspectable, reviewable and previewable`, async () => {
  assert.ok(ffmpegPath, "The application's required decoder must be installed");
  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-video-security-"));
  try {
    const sourcePath = path.join(workspace, "source." + extension);
    await run(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=black:s=240x320:r=5",
      ...(hasAudio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000"] : []),
      "-t", "1.2", "-threads", "1",
      ...(extension === "webm" ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-c:a", "libopus"] : ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]),
      sourcePath,
    ], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
    const source = await readFile(sourcePath);
    if (extension === "mp4") {
      const options = { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 };
      const decode = ["-frames:v", "1", "-f", "null", "-"];
      // Exercise the native limit with a tiny fixture and a smaller test threshold.
      const pixelOptions = [...LOCAL_VIDEO_INPUT_OPTIONS];
      pixelOptions[pixelOptions.indexOf("-max_pixels") + 1] = String(240 * 320 - 1);
      await assert.rejects(run(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...pixelOptions, "-i", sourcePath, ...decode], options), error => /max pixel|picture size|image size/i.test(error.stderr));

      const imagePath = path.join(workspace, "not-a-video.png");
      await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } }).png().toFile(imagePath);
      await assert.rejects(run(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...LOCAL_VIDEO_INPUT_OPTIONS, "-i", imagePath, ...decode], options), error => /not on whitelist/i.test(error.stderr));

      let requests = 0;
      const server = createServer((_request, response) => { requests++; response.end(source); });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const url = `http://127.0.0.1:${server.address().port}/synthetic.mp4`;
        await assert.rejects(run(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...LOCAL_VIDEO_INPUT_OPTIONS, "-i", url, ...decode], options), error => /not on whitelist/i.test(error.stderr));
        assert.equal(requests, 0);
      } finally { await new Promise(resolve => server.close(resolve)); }
    }
    const stored = storedVideoFixture(source, mime);
    const inspector = videoDecoderFixture("src/lib/dancr/video-upload-validation.ts", { realFiles: true, spawnImpl: spawn });
    const metadata = await inspector.exports.inspectStoredMyDancrTvVideo(stored.admin, stored.input);
    assert.equal(metadata.width, 240); assert.equal(metadata.height, 320);
    assert.ok(metadata.durationSeconds >= 1 && metadata.durationSeconds < 2);

    // Run only local review extraction: no AI client, credentials or provider calls.
    const review = videoDecoderFixture("src/lib/dancr/video-moderation.ts", { realFiles: true, spawnImpl: spawn,
      extra: "\nexport { probeVideoDurationSeconds, extractVideoFrames, extractOptionalAudio };",
    });
    const duration = await review.exports.probeVideoDurationSeconds(sourcePath);
    const frames = await review.exports.extractVideoFrames(sourcePath, workspace, duration);
    assert.ok(frames.length > 0 && frames.length <= 10);
    const audio = await review.exports.extractOptionalAudio(sourcePath, workspace);
    if (hasAudio) assert.ok(audio && (await stat(audio)).size > 0);
    else assert.equal(audio, null);

    const poster = await createDancrVideoPoster(source, extension === "webm" ? "video/webm" : "video/mp4");
    const image = await sharp(poster).metadata();
    assert.equal(image.format, "webp"); assert.ok(image.width > 0 && image.width <= 640);
  } finally {
    const absolute = path.resolve(workspace);
    if (path.dirname(absolute) !== path.resolve(tmpdir()) || !path.basename(absolute).startsWith("mydancr-video-security-")) throw new Error("Unexpected test cleanup path");
    await rm(absolute, { recursive: true, force: true });
  }
});
