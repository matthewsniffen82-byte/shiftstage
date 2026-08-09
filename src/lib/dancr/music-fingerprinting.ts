import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { getServerEnv } from "../env";

export const MUSIC_FINGERPRINT_PROVIDER_MODEL = "acrcloud-identification-v1";
export const MUSIC_FINGERPRINT_SAMPLE_SECONDS = 10;
export const MAX_MUSIC_FINGERPRINT_SAMPLES = 3;
const MAX_SAMPLE_BYTES = 5_000_000;
const DEFAULT_REVIEW_THRESHOLD = 80;
const DEFAULT_TIMEOUT_MS = 15_000;

export type MusicFingerprintSample = {
  path: string;
  offsetSeconds: number;
};

export type MusicFingerprintMatch = {
  acrid: string;
  title: string;
  artists: string[];
  album: string | null;
  label: string | null;
  isrc: string | null;
  score: number;
  sampleOffsetsSeconds: number[];
  playOffsetMs: number | null;
};

export type MusicFingerprintResult = {
  decision: "approved" | "review";
  reasonCodes: string[];
  details: {
    provider: "acrcloud";
    model: typeof MUSIC_FINGERPRINT_PROVIDER_MODEL;
    checked: boolean;
    status: "no_audio" | "no_match" | "matched";
    sampleCount: number;
    reviewThreshold: number;
    matchFound: boolean;
    reviewRequired: boolean;
    matches: MusicFingerprintMatch[];
  };
};

type AcrCloudCredentials = {
  host: string;
  accessKey: string;
  accessSecret: string;
};

type FingerprintOptions = {
  credentials?: AcrCloudCredentials;
  fetchImpl?: typeof fetch;
  now?: () => number;
  reviewThreshold?: number;
  timeoutMs?: number;
};

export function getMusicFingerprintSampleOffsets(
  durationSeconds: number,
  sampleSeconds = MUSIC_FINGERPRINT_SAMPLE_SECONDS,
  maxSamples = MAX_MUSIC_FINGERPRINT_SAMPLES,
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("The video duration could not be determined for music fingerprinting.");
  }
  if (!Number.isFinite(sampleSeconds) || sampleSeconds <= 0 || !Number.isInteger(maxSamples) || maxSamples < 1) {
    throw new Error("Music fingerprint sampling is misconfigured.");
  }

  const sampleCount = Math.min(maxSamples, Math.max(1, Math.ceil(durationSeconds / sampleSeconds)));
  if (sampleCount === 1) return [0];

  const finalOffset = Math.max(0, durationSeconds - sampleSeconds);
  return Array.from({ length: sampleCount }, (_, index) =>
    Number(((finalOffset * index) / (sampleCount - 1)).toFixed(3)),
  );
}

export function createAcrCloudSignature(input: {
  accessKey: string;
  accessSecret: string;
  timestamp: number;
}) {
  const stringToSign = [
    "POST",
    "/v1/identify",
    input.accessKey,
    "audio",
    "1",
    String(input.timestamp),
  ].join("\n");
  return createHmac("sha1", input.accessSecret).update(stringToSign, "utf8").digest("base64");
}

export async function fingerprintMusicSamples(
  samples: MusicFingerprintSample[],
  options: FingerprintOptions = {},
): Promise<MusicFingerprintResult> {
  const reviewThreshold = clampReviewThreshold(
    options.reviewThreshold ?? Number(process.env.DANCR_MUSIC_MATCH_REVIEW_THRESHOLD),
  );
  const usableSamples = samples
    .filter((sample) => sample && typeof sample.path === "string" && Number.isFinite(sample.offsetSeconds))
    .slice(0, MAX_MUSIC_FINGERPRINT_SAMPLES);

  if (!usableSamples.length) {
    return buildResult([], 0, reviewThreshold);
  }

  const credentials = normalizeCredentials(options.credentials || {
    host: getServerEnv("ACRCLOUD_HOST"),
    accessKey: getServerEnv("ACRCLOUD_ACCESS_KEY"),
    accessSecret: getServerEnv("ACRCLOUD_ACCESS_SECRET"),
  });
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  const matches: MusicFingerprintMatch[] = [];
  for (const sample of usableSamples) {
    const sampleStat = await stat(sample.path).catch(() => null);
    if (!sampleStat?.size) continue;
    if (sampleStat.size > MAX_SAMPLE_BYTES) {
      throw new Error("Music fingerprint sample exceeds the provider size limit.");
    }
    const bytes = await readFile(sample.path);
    const payload = await identifyAcrCloudSample({
      bytes,
      offsetSeconds: sample.offsetSeconds,
      credentials,
      fetchImpl,
      now,
      timeoutMs,
    });
    matches.push(...evaluateAcrCloudMusicResponse(payload, sample.offsetSeconds));
  }

  return buildResult(mergeMatches(matches), usableSamples.length, reviewThreshold);
}

export function evaluateAcrCloudMusicResponse(payload: unknown, sampleOffsetSeconds: number) {
  const response = asRecord(payload);
  const status = asRecord(response.status);
  const statusCode = Number(status.code);

  if (statusCode === 1001) return [] as MusicFingerprintMatch[];
  if (statusCode !== 0) {
    throw new Error("Music fingerprint provider returned an unsuccessful response.");
  }

  const metadata = asRecord(response.metadata);
  const music = Array.isArray(metadata.music) ? metadata.music : [];
  return music
    .map((item) => normalizeMatch(item, sampleOffsetSeconds))
    .filter((match): match is MusicFingerprintMatch => Boolean(match));
}

async function identifyAcrCloudSample(input: {
  bytes: Buffer;
  offsetSeconds: number;
  credentials: AcrCloudCredentials;
  fetchImpl: typeof fetch;
  now: () => number;
  timeoutMs: number;
}) {
  const timestamp = Math.floor(input.now() / 1000);
  const form = new FormData();
  form.append("access_key", input.credentials.accessKey);
  form.append("sample_bytes", String(input.bytes.byteLength));
  form.append("timestamp", String(timestamp));
  form.append("signature", createAcrCloudSignature({
    accessKey: input.credentials.accessKey,
    accessSecret: input.credentials.accessSecret,
    timestamp,
  }));
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append(
    "sample",
    new Blob([new Uint8Array(input.bytes)], { type: "audio/mpeg" }),
    `music-${Math.round(input.offsetSeconds * 1000)}.mp3`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(
      `https://${input.credentials.host}/v1/identify`,
      { method: "POST", body: form, signal: controller.signal },
    );
  } catch {
    if (controller.signal.aborted) throw new Error("Music fingerprint provider timed out.");
    throw new Error("Music fingerprint provider request failed.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error("Music fingerprint provider request failed.");
  try {
    return await response.json();
  } catch {
    throw new Error("Music fingerprint provider returned invalid JSON.");
  }
}

function buildResult(
  matches: MusicFingerprintMatch[],
  sampleCount: number,
  reviewThreshold: number,
): MusicFingerprintResult {
  if (!sampleCount) {
    return {
      decision: "approved",
      reasonCodes: ["music_fingerprint_no_audio"],
      details: {
        provider: "acrcloud",
        model: MUSIC_FINGERPRINT_PROVIDER_MODEL,
        checked: false,
        status: "no_audio",
        sampleCount: 0,
        reviewThreshold,
        matchFound: false,
        reviewRequired: false,
        matches: [],
      },
    };
  }

  const reviewRequired = matches.some((match) => match.score >= reviewThreshold);
  return {
    decision: reviewRequired ? "review" : "approved",
    reasonCodes: [
      reviewRequired
        ? "music_rights_match_requires_review"
        : matches.length
          ? "music_fingerprint_low_confidence_match"
          : "music_fingerprint_no_match",
    ],
    details: {
      provider: "acrcloud",
      model: MUSIC_FINGERPRINT_PROVIDER_MODEL,
      checked: true,
      status: matches.length ? "matched" : "no_match",
      sampleCount,
      reviewThreshold,
      matchFound: matches.length > 0,
      reviewRequired,
      matches: matches.slice(0, 5),
    },
  };
}

function normalizeMatch(value: unknown, sampleOffsetSeconds: number): MusicFingerprintMatch | null {
  const item = asRecord(value);
  const acrid = text(item.acrid, 100);
  const title = text(item.title, 300);
  if (!acrid || !title) return null;

  const artists = (Array.isArray(item.artists) ? item.artists : [])
    .map((artist) => text(asRecord(artist).name, 200))
    .filter(Boolean)
    .slice(0, 10);
  const externalIds = asRecord(item.external_ids);
  return {
    acrid,
    title,
    artists,
    album: text(asRecord(item.album).name, 300) || null,
    label: text(item.label, 300) || null,
    isrc: text(externalIds.isrc, 32) || null,
    score: clampScore(item.score),
    sampleOffsetsSeconds: [Number(sampleOffsetSeconds.toFixed(3))],
    playOffsetMs: finiteNumber(item.play_offset_ms),
  };
}

function mergeMatches(matches: MusicFingerprintMatch[]) {
  const merged = new Map<string, MusicFingerprintMatch>();
  for (const match of matches) {
    const key = match.acrid || match.isrc || `${match.title}:${match.artists.join(",")}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, match);
      continue;
    }
    merged.set(key, {
      ...(match.score > existing.score ? match : existing),
      sampleOffsetsSeconds: [...new Set([
        ...existing.sampleOffsetsSeconds,
        ...match.sampleOffsetsSeconds,
      ])].sort((left, right) => left - right),
    });
  }
  return [...merged.values()].sort((left, right) => right.score - left.score);
}

function normalizeCredentials(credentials: AcrCloudCredentials) {
  const accessKey = credentials.accessKey.trim();
  const accessSecret = credentials.accessSecret.trim();
  const rawHost = credentials.host.trim();
  const url = new URL(rawHost.includes("://") ? rawHost : `https://${rawHost}`);
  if (
    url.protocol !== "https:" ||
    url.port ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash ||
    !url.hostname.toLowerCase().endsWith(".acrcloud.com")
  ) {
    throw new Error("ACRCLOUD_HOST must be an ACRCloud HTTPS identification host.");
  }
  if (!accessKey || !accessSecret) {
    throw new Error("ACRCloud music fingerprint credentials are incomplete.");
  }
  return { host: url.hostname.toLowerCase(), accessKey, accessSecret };
}

function clampReviewThreshold(value: number) {
  return Number.isFinite(value) ? Math.max(70, Math.min(100, value)) : DEFAULT_REVIEW_THRESHOLD;
}

function normalizeTimeout(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(1_000, Math.min(30_000, Number(value))) : DEFAULT_TIMEOUT_MS;
}

function clampScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
