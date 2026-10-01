import type { VideoUploadEdit } from "../../src/lib/dancr/video-upload-edit-policy";
import { versionedStaticAssetUrl } from "../../src/lib/dancr/static-asset-cache.mjs";

declare global {
  interface Window {
    DancrVideoCrop?: { crop(file: File, options?: { signal?: AbortSignal }): Promise<VideoUploadEdit | null> };
  }
}

let editorLoad: Promise<void> | undefined;
export async function cropProfileVideo(file: File, signal: AbortSignal) {
  if (!window.DancrVideoCrop) {
    editorLoad ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = versionedStaticAssetUrl("/profile-video-crop.js");
      script.async = true;
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (ok) resolve();
        else { script.remove(); reject(new Error("Unable to load the video editor. Please try again.")); }
      };
      const timer = setTimeout(() => finish(false), 15000);
      script.onload = () => finish(Boolean(window.DancrVideoCrop));
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    }).catch(error => { editorLoad = undefined; throw error; });
    await editorLoad;
  }
  if (signal.aborted) throw new DOMException("Video selection closed.", "AbortError");
  if (!window.DancrVideoCrop) throw new Error("The video editor is still loading. Please try again.");
  return window.DancrVideoCrop.crop(file, { signal });
}
