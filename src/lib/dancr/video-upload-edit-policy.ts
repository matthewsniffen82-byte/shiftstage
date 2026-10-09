import { PublicApiError } from "../api-error-policy.ts";

export const VIDEO_UPLOAD_MAX_SECONDS = 30;
export const VIDEO_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_SOURCE_MAX_SECONDS = 600;

export type VideoUploadEdit = {
  version: 1;
  source: { durationSeconds: number; width: number; height: number; mimeType: string; fileSize: number };
  startSeconds: number;
  endSeconds: number;
  crop: { x: number; y: number; width: number; height: number };
};

export function normalizeVideoUploadEdit(value: unknown): VideoUploadEdit {
  const edit = value as VideoUploadEdit | null;
  const source = edit?.source;
  const crop = edit?.crop;
  if (!edit || edit.version !== 1 || !source || !crop
    || !["video/mp4", "video/webm", "video/quicktime"].includes(source.mimeType)
    || !Number.isSafeInteger(source.fileSize) || source.fileSize < 1 || source.fileSize > VIDEO_UPLOAD_MAX_BYTES
    || !Number.isFinite(source.durationSeconds) || source.durationSeconds < 1 || source.durationSeconds > VIDEO_SOURCE_MAX_SECONDS
    || ![source.width, source.height].every(n => Number.isSafeInteger(n) && n >= 240 && n <= 7680)
    || !Number.isFinite(edit.startSeconds) || !Number.isFinite(edit.endSeconds)
    || edit.startSeconds < 0 || edit.endSeconds > source.durationSeconds
    || edit.endSeconds - edit.startSeconds < 1 - 1e-9 || edit.endSeconds - edit.startSeconds > VIDEO_UPLOAD_MAX_SECONDS + 1e-9
    || ![crop.x, crop.y, crop.width, crop.height].every(n => Number.isSafeInteger(n) && n >= 0 && n % 2 === 0)
    || crop.width < 240 || crop.height < crop.width
    || crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
    throw new PublicApiError("INVALID_REQUEST", `Choose a vertical or square crop and a clip between 1 and 30 seconds (${VIDEO_UPLOAD_MAX_BYTES / (1024 * 1024)} MB maximum).`, 400);
  }
  // Store only validated fields, in a stable order, for exact upload retries.
  return {
    version: 1,
    source: { durationSeconds: source.durationSeconds, width: source.width, height: source.height, mimeType: source.mimeType, fileSize: source.fileSize },
    startSeconds: edit.startSeconds,
    endSeconds: edit.endSeconds,
    crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
  };
}

export function editedVideoDimensions(edit: VideoUploadEdit) {
  const scale = Math.min(1, 720 / edit.crop.width, 1280 / edit.crop.height);
  return { width: Math.floor(edit.crop.width * scale / 2) * 2, height: Math.floor(edit.crop.height * scale / 2) * 2 };
}

export function videoUploadSourcePath(video: { submitted_by: string; dancer_id: string; id: string }, edit: VideoUploadEdit) {
  const extension = edit.source.mimeType === "video/webm" ? "webm" : edit.source.mimeType === "video/quicktime" ? "mov" : "mp4";
  return `${video.submitted_by}/${video.dancer_id}/${video.id}-source.${extension}`;
}
