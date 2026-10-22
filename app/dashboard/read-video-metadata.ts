import { VIDEO_UPLOAD_MAX_BYTES, VIDEO_UPLOAD_MAX_SECONDS } from "../../src/lib/dancr/video-upload-edit-policy";

/** Inspect the original file without opening an editor or changing its framing. */
export async function readVideoMetadata(file: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) throw new Error("Choose an MP4, WebM, or MOV video.");
  if (file.size < 1 || file.size > VIDEO_UPLOAD_MAX_BYTES) throw new Error("Video files must be 25 MB or smaller.");
  return new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      video.onloadedmetadata = video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(metadata);
    };
    const abort = () => finish(new DOMException("Video selection closed.", "AbortError"));
    const timer = window.setTimeout(() => finish(new Error("Unable to read this video. Try another MP4, WebM, or MOV file.")), 20000);
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > VIDEO_UPLOAD_MAX_SECONDS) {
        finish(new Error("Over 30 seconds"));
      } else if (!Number.isFinite(video.duration) || video.duration < 1) {
        finish(new Error("Choose a video between 1 and 30 seconds."));
      } else if (!Number.isInteger(video.videoWidth) || !Number.isInteger(video.videoHeight) || video.videoWidth < 240 || video.videoHeight < video.videoWidth || video.videoHeight > 7680) {
        finish(new Error("Choose a vertical or square video, at least 240 pixels wide."));
      } else finish();
    };
    video.onerror = () => finish(new Error("Unable to read this video. Try another MP4, WebM, or MOV file."));
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    video.src = url;
  });
}
