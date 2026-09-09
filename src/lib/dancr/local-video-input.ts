import { MAX_STORED_VIDEO_DIMENSION } from "./video-upload-policy.ts";

// Apply before the untrusted video input, not to generated image overlays.
// Uploaded videos are local files; playlists and network protocols are unnecessary.
export const LOCAL_VIDEO_INPUT_OPTIONS = [
  "-protocol_whitelist", "file",
  "-format_whitelist", "mov,matroska,webm",
  "-max_pixels", String(MAX_STORED_VIDEO_DIMENSION ** 2),
] as const;
