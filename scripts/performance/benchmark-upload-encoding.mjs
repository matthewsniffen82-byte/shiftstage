// Local synthetic media benchmark; no browser, accounts, or production writes.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-upload-benchmark-"));
const execute = args => execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { windowsHide: true, timeout: 90_000 });
try {
  const source = path.join(workspace, "synthetic.mp4");
  execute(["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", source]);
  const samples = [];
  // Alternate order so the second preset does not always benefit from warm caches.
  for (const [round, presets] of [[1, ["medium", "veryfast"]], [2, ["veryfast", "medium"]]]) {
    for (const preset of presets) {
      const output = path.join(workspace, `${round}-${preset}.mp4`);
      const start = performance.now();
      execute(["-i", source, "-map", "0:v:0", "-vf", "scale=720:1280:flags=lanczos", "-c:v", "libx264", "-preset", preset,
        "-crf", "22", "-maxrate", "2500k", "-bufsize", "5000k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
      samples.push({ round, preset, milliseconds: Math.round(performance.now() - start), bytes: (await stat(output)).size });
    }
  }
  console.log(JSON.stringify({ source: "synthetic 6-second 1080x1920 clip", samples }, null, 2));
} finally {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(workspace));
  if (!relative.startsWith("mydancr-upload-benchmark-") || relative.includes(path.sep)) throw new Error("Unexpected benchmark cleanup path.");
  await rm(workspace, { recursive: true, force: true });
}
