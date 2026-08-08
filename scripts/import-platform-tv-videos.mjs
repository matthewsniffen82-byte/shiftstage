import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";

const MAX_BYTES = 75 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30;
const BUCKET = "mydancr-tv-videos";

const options = parseArguments(process.argv.slice(2));
loadEnvironmentFile(options.envFile);
const importKey = String(process.env.DANCR_MEDIA_IMPORT_KEY || "").trim();
if (importKey.length < 32) fail("DANCR_MEDIA_IMPORT_KEY is missing or invalid.");

const videos = [
  ...options.profileVideos.map((filePath) => inspectVideo(filePath, "profile_and_feed")),
  ...options.feedVideos.map((filePath) => inspectVideo(filePath, "feed_only")),
];
if (!videos.length) fail("Provide at least one --profile-video or --feed-video.");

let state = readState(options.stateFile, options, videos);
if (!state) {
  const prepared = await importRequest(options.endpoint, importKey, {
    action: "prepare",
    dancerSlug: options.dancer,
    batchId: options.batch,
    replaceExisting: false,
    videos: videos.map(({ fileSize, durationSeconds, width, height, mimeType, distributionScope }) => ({
      fileSize,
      durationSeconds,
      width,
      height,
      mimeType,
      distributionScope,
    })),
  });
  if (!Array.isArray(prepared.uploads) || prepared.uploads.length !== videos.length) {
    fail("The import service returned an incomplete upload batch.");
  }
  state = {
    version: 1,
    endpoint: options.endpoint,
    dancer: options.dancer,
    batch: options.batch,
    publicSupabaseUrl: prepared.publicSupabaseUrl,
    publicSupabaseAnonKey: prepared.publicSupabaseAnonKey,
    videos: videos.map((video, index) => ({
      ...video,
      upload: prepared.uploads[index],
      uploaded: false,
      published: false,
    })),
  };
  saveState(options.stateFile, state);
}

const supabase = createClient(state.publicSupabaseUrl, state.publicSupabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

for (const video of state.videos) {
  if (video.uploaded) continue;
  const file = readFileSync(video.filePath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(video.upload.path, video.upload.token, file, {
      contentType: video.mimeType,
      upsert: false,
    });
  if (error) fail(`Upload failed for ${path.basename(video.filePath)}: ${error.message}`);
  video.uploaded = true;
  saveState(options.stateFile, state);
  process.stdout.write(`Uploaded ${path.basename(video.filePath)}\n`);
}

for (const video of state.videos) {
  if (video.published) continue;
  const finalized = await importRequest(options.endpoint, importKey, {
    action: "finalize",
    batchId: options.batch,
    videoId: video.upload.videoId,
    recoverPreparedVideo: true,
  });
  if (finalized.video?.status !== "approved") {
    fail(`Publication did not approve ${path.basename(video.filePath)}.`);
  }
  video.published = true;
  saveState(options.stateFile, state);
  process.stdout.write(`Published ${path.basename(video.filePath)} (${video.distributionScope})\n`);
}

const summary = {
  batch: options.batch,
  dancer: options.dancer,
  profileVideos: state.videos.filter((video) => video.distributionScope === "profile_and_feed").length,
  feedOnlyVideos: state.videos.filter((video) => video.distributionScope === "feed_only").length,
  videoIds: state.videos.map((video) => video.upload.videoId),
};
unlinkSync(options.stateFile);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function parseArguments(args) {
  const values = { profileVideos: [], feedVideos: [] };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name.startsWith("--") || !value || value.startsWith("--")) fail(`Missing value for ${name}.`);
    index += 1;
    if (name === "--profile-video") values.profileVideos.push(path.resolve(value));
    else if (name === "--feed-video") values.feedVideos.push(path.resolve(value));
    else if (name === "--endpoint") values.endpoint = value.replace(/\/+$/, "");
    else if (name === "--dancer") values.dancer = value.trim().toLowerCase();
    else if (name === "--batch") values.batch = value.trim().toLowerCase();
    else if (name === "--env-file") values.envFile = path.resolve(value);
    else if (name === "--state-file") values.stateFile = path.resolve(value);
    else fail(`Unsupported argument: ${name}`);
  }
  values.endpoint ||= "https://mydancr.com";
  if (!/^https:\/\//i.test(values.endpoint) && !/^http:\/\/localhost(?::\d+)?$/i.test(values.endpoint)) {
    fail("Use an HTTPS endpoint (or localhost for development). ");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(values.dancer || "")) fail("Provide a valid --dancer slug.");
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(values.batch || "")) fail("Provide a valid --batch ID.");
  if (!values.envFile) fail("Provide --env-file with DANCR_MEDIA_IMPORT_KEY.");
  values.stateFile ||= path.resolve(`.platform-tv-import-${values.batch}.json`);
  return values;
}

function loadEnvironmentFile(filePath) {
  if (!existsSync(filePath)) fail(`Environment file not found: ${filePath}`);
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2").replace(/\\n/g, "\n");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

function inspectVideo(filePath, distributionScope) {
  if (!existsSync(filePath)) fail(`Video file not found: ${filePath}`);
  const fileSize = statSync(filePath).size;
  if (fileSize < 1 || fileSize > MAX_BYTES) fail(`${path.basename(filePath)} must be 75 MB or smaller.`);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === ".mp4" ? "video/mp4" : extension === ".webm" ? "video/webm" : "";
  if (!mimeType) fail(`${path.basename(filePath)} must be MP4 or WebM.`);
  const probe = spawnSync(ffmpegPath, ["-hide_banner", "-i", filePath], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const dimensionMatch = output.match(/Video:[^\r\n]*?\b(\d{3,5})x(\d{3,5})\b/);
  if (!durationMatch || !dimensionMatch) fail(`Unable to read video metadata for ${path.basename(filePath)}.`);
  const durationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const width = Number(dimensionMatch[1]);
  const height = Number(dimensionMatch[2]);
  if (durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
    fail(`${path.basename(filePath)} must be between 1 and ${MAX_DURATION_SECONDS} seconds.`);
  }
  if (width < 240 || height < width || height > 7680) fail(`${path.basename(filePath)} must be vertical or square.`);
  return { filePath, fileSize, durationSeconds, width, height, mimeType, distributionScope };
}

async function importRequest(endpoint, importKey, body) {
  const response = await fetch(`${endpoint}/api/admin/tv/import`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mydancr-media-import-key": importKey },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) fail(payload.error || `Import request failed with HTTP ${response.status}.`);
  return payload;
}

function readState(filePath, optionsToMatch, inspectedVideos) {
  if (!existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const expectedPaths = inspectedVideos.map((video) => video.filePath);
  const statePaths = Array.isArray(parsed.videos) ? parsed.videos.map((video) => video.filePath) : [];
  if (
    parsed.version !== 1 || parsed.endpoint !== optionsToMatch.endpoint || parsed.dancer !== optionsToMatch.dancer ||
    parsed.batch !== optionsToMatch.batch || JSON.stringify(statePaths) !== JSON.stringify(expectedPaths)
  ) {
    fail(`Resume state does not match this import: ${filePath}`);
  }
  return parsed;
}

function saveState(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
