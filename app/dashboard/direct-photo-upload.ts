import { getPublicEnv } from "../../src/lib/env";
import { DASHBOARD_SESSION_KEY, readSession, type DashboardJsonRequestOptions } from "./dashboard-session";

type RequestJson = (path: string, options: DashboardJsonRequestOptions) => Promise<any>;

export function checkedPhotoUploadUrl(value: string, owner: string, id: string) {
  const base = new URL(getPublicEnv().supabaseUrl);
  const url = new URL(value);
  const storageHost = base.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || ![base.host, storageHost].includes(url.host)
    || url.pathname !== `/storage/v1/object/upload/sign/dancer-photo-uploads/${owner}/${id}`
    || !url.searchParams.get("token")) throw new Error("Invalid photo upload destination.");
  return url.href;
}

export function photoUploadMime(file: File) {
  // Some phones omit HEIC MIME types or use image/heic-sequence. Preserve
  // those files as binary; the server still verifies their actual image bytes.
  const type = file.type.toLowerCase();
  return ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type) ? type : "application/octet-stream";
}

function transferPhoto(url: string, file: File, signal: AbortSignal, progress?: (percent: number) => void) {
  return new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      xhr.upload.onprogress = xhr.upload.onload = null;
      xhr.onload = xhr.onerror = xhr.onabort = null;
      if (error) reject(error); else resolve(xhr.status);
    };
    const abort = () => { xhr.abort(); finish(new DOMException("Photo upload canceled.", "AbortError")); };
    if (signal.aborted) { abort(); return; }
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", photoUploadMime(file));
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total) progress?.(Math.min(99, Math.floor(event.loaded / event.total * 100)));
    };
    xhr.onload = () => finish();
    xhr.onerror = () => finish(new Error("Photo upload interrupted. Tap Retry to try again."));
    xhr.onabort = () => finish(new DOMException("Photo upload canceled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    try { xhr.send(file); } catch (error) { finish(error instanceof Error ? error : new Error("Unable to upload photo.")); }
  });
}

/** Shared by gallery, main photo, and saved-photo crops. */
export async function directPhotoUpload(options: DashboardJsonRequestOptions, request: RequestJson) {
  const body = options.body;
  if (!(body instanceof FormData)) throw new Error("Photo file is required.");
  const file = body.get("file");
  if (!(file instanceof File)) throw new Error("Photo file is required.");
  const owner = readSession()?.account?.id;
  if (!owner) throw new Error("Sign in required.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const assertOwner = () => {
    if (options.signal?.aborted || controller.signal.aborted || readSession()?.account?.id !== owner || readSession()?.account?.role !== "dancer") {
      abort(); throw new DOMException("Photo upload canceled. Sign in again.", "AbortError");
    }
  };
  const changed = (event: StorageEvent) => {
    if (event.key === null || event.key === DASHBOARD_SESSION_KEY) { try { assertOwner(); } catch { abort(); } }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  window.addEventListener("storage", changed);
  try {
    assertOwner();
    const reservationBody = JSON.stringify({
      uploadKey: options.headers?.["idempotency-key"] || body.get("idempotencyKey"),
      bytes: file.size, mime: file.type || "application/octet-stream",
      isPrimary: body.get("isPrimary") === "true", sortOrder: Number(body.get("sortOrder") || 0),
      replaceExisting: body.get("replaceExisting") === "true", replacementPhotoId: body.get("replacementPhotoId") || null,
    });
    const reserve = async () => {
      const data = await request("/api/dancer/photos/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: reservationBody,
        expectedRole: "dancer", signal: controller.signal, fallbackMessage: "Unable to prepare your photo upload." });
      assertOwner();
      if (!data.upload?.id || typeof data.upload.uploadComplete !== "boolean") throw new Error("Unable to confirm your photo upload.");
      return data.upload;
    };
    const upload = await reserve();
    if (!upload.uploadComplete) {
      const status = await transferPhoto(checkedPhotoUploadUrl(upload.signedUrl, owner, upload.id), file, controller.signal, options.onUploadProgress);
      assertOwner();
      if (status < 200 || status >= 300) {
        // A lost success response can leave the immutable object already stored.
        const retry = await reserve();
        if (!retry.uploadComplete || retry.id !== upload.id) throw new Error("Photo upload interrupted. Tap Retry to try again.");
      }
    }
    options.onUploadProgress?.(100);
    assertOwner();
    const result = await request("/api/dancer/photos", { ...options, method: "POST", onUploadProgress: undefined,
      signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId: upload.id }) });
    assertOwner();
    return result;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    window.removeEventListener("storage", changed);
    controller.abort();
  }
}
