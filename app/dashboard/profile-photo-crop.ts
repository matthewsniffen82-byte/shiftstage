import { requestDashboardJson } from "./dashboard-session";

declare global {
  interface Window {
    DancrPhotoCrop?: {
      crop(file: File, options: { signal?: AbortSignal; prepare(file: File, signal: AbortSignal): Promise<string> }): Promise<File | null>;
    };
  }
}

export async function cropProfilePhoto(file: File, signal: AbortSignal) {
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
