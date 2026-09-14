import { requestDashboardJson } from "./dashboard-session";
import { versionedStaticAssetUrl } from "../../src/lib/dancr/static-asset-cache.mjs";

declare global {
  interface Window {
    DancrPhotoCrop?: {
      crop(file: File, options: { signal?: AbortSignal; prepare(file: File, signal: AbortSignal): Promise<string> }): Promise<File | null>;
    };
  }
}

export async function cropProfilePhoto(file: File, signal: AbortSignal) {
  await loadPhotoEditor();
  if (signal.aborted) throw new DOMException("Photo selection closed.", "AbortError");
  if (!window.DancrPhotoCrop) throw new Error("The photo editor is still loading. Please try again.");
  return window.DancrPhotoCrop.crop(file, {
    signal,
    prepare: async (original, previewSignal) => {
      const body = new FormData();
      body.set("file", original);
      const data = await requestDashboardJson("/api/dancer/photos/preview", {
        method: "POST", body, signal: previewSignal,
        fallbackMessage: "Unable to prepare this photo for cropping.",
      });
      return data.imageDataUrl;
    },
  });
}

let editorLoad: Promise<void> | undefined;
function loadPhotoEditor() {
  if (window.DancrPhotoCrop) return Promise.resolve();
  if (editorLoad) return editorLoad;
  editorLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = versionedStaticAssetUrl("/profile-photo-crop.js");
    script.async = true;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (ok) resolve();
      else {
        script.remove();
        reject(new Error("Unable to load the photo editor. Please try again."));
      }
    };
    const timer = setTimeout(() => finish(false), 15000);
    script.onload = () => finish(Boolean(window.DancrPhotoCrop));
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  }).catch(error => { editorLoad = undefined; throw error; });
  return editorLoad;
}
