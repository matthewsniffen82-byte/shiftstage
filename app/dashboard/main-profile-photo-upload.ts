import { cropProfilePhoto } from "./profile-photo-crop";
import { DASHBOARD_SESSION_KEY, readSession, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";

export async function uploadMainProfilePhoto(file: File, options: {
  signal: AbortSignal;
  uploadKey: string;
  replacementPhotoId?: string;
  onUploadStart?: () => void;
}) {
  const owner = readSession()?.account?.id;
  if (!owner || readSession()?.account?.role !== "dancer") throw new Error("Sign in as a dancer to upload your main photo.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const assertOwner = () => {
    const session = readSession();
    if (controller.signal.aborted || options.signal.aborted || !session?.accessToken || session.account?.id !== owner || session.account?.role !== "dancer") {
      throw new DOMException("Photo upload canceled. Select your photo again after signing in.", "AbortError");
    }
  };
  const changedAccount = (event: StorageEvent) => {
    if (event.key !== DASHBOARD_SESSION_KEY && event.key !== null) return;
    try { assertOwner(); } catch { cancel(); }
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  window.addEventListener("storage", changedAccount);
  try {
    assertOwner();
    const cropped = await cropProfilePhoto(file, controller.signal, assertOwner, 3 / 4);
    assertOwner();
    if (!cropped) return null;
    options.onUploadStart?.();
    const body = new FormData();
    body.set("file", cropped);
    body.set("isPrimary", "true");
    body.set("sortOrder", "0");
    body.set("replaceExisting", String(Boolean(options.replacementPhotoId)));
    if (options.replacementPhotoId) body.set("replacementPhotoId", options.replacementPhotoId);
    body.set("idempotencyKey", options.uploadKey);
    const data = await requestDancerPhotosJson({
      method: "POST", headers: { "idempotency-key": options.uploadKey }, body,
      signal: controller.signal, fallbackMessage: "Unable to upload your main photo. Try again.",
    });
    assertOwner();
    const decision = String(data.decision || "");
    if (!["approved", "review", "pending", "moderation_retry", "moderation_error", "rejected"].includes(decision)) {
      throw new Error("Unable to confirm your photo upload. Try again.");
    }
    // Once moderation acknowledges the upload, a failed refresh must not offer a duplicate upload.
    try {
      const refreshed = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal });
      assertOwner();
      return { decision, profile: refreshed.profile || null, refreshFailed: !refreshed.profile };
    } catch {
      assertOwner();
      return { decision, profile: null, refreshFailed: true };
    }
  } finally {
    options.signal.removeEventListener("abort", cancel);
    window.removeEventListener("storage", changedAccount);
    controller.abort();
  }
}
