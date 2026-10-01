import { cropProfilePhoto } from "./profile-photo-crop";
import { DASHBOARD_SESSION_KEY, readSession, requestDashboardJson, requestDancerPhotosJson, requestDancerProfileJson } from "./dashboard-session";

export type SavedPhotoCropSource = { id: string; isPrimary: boolean; sortOrder: number };
const savedSelections = new WeakMap<SavedPhotoCropSource, { file: File; preview: string; owner: string }>();

export async function uploadMainProfilePhoto(source: File | SavedPhotoCropSource, options: {
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
    const saved = "id" in source ? source : null;
    let file = source as File;
    let preview: string | undefined;
    if (saved) {
      let cached = savedSelections.get(saved);
      if (cached && cached.owner !== owner) throw new DOMException("Sign in again to crop your photo.", "AbortError");
      if (!cached) {
        const form = new FormData();
        form.set("photoId", saved.id);
        const prepared = await requestDashboardJson("/api/dancer/photos/preview", {
          method: "POST", body: form, signal: controller.signal, expectedRole: "dancer",
          fallbackMessage: "Unable to load your saved photo. Please try again.",
        });
        assertOwner();
        if (typeof prepared.imageDataUrl !== "string" || !prepared.imageDataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Unable to prepare your saved photo.");
        const bytes = Uint8Array.from(atob(prepared.imageDataUrl.split(",")[1]), character => character.charCodeAt(0));
        cached = { file: new File([bytes], "saved-photo.jpg", { type: "image/jpeg" }), preview: prepared.imageDataUrl, owner };
        savedSelections.set(saved, cached);
      }
      file = cached.file;
      preview = cached.preview;
    }
    const cropped = await cropProfilePhoto(file, controller.signal, assertOwner, 3 / 4, preview);
    assertOwner();
    if (!cropped) return null;
    options.onUploadStart?.();
    const body = new FormData();
    body.set("file", cropped);
    body.set("isPrimary", String(saved ? saved.isPrimary : true));
    body.set("sortOrder", String(saved ? saved.sortOrder : 0));
    const replacementPhotoId = saved?.id || options.replacementPhotoId;
    body.set("replaceExisting", String(Boolean(replacementPhotoId)));
    if (replacementPhotoId) body.set("replacementPhotoId", replacementPhotoId);
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
