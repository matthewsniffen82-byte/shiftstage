const preparedPhotos = new WeakMap<File, File>();
const MAX_UPLOAD_EDGE = 2560;
const MIN_OPTIMIZE_BYTES = 512 * 1024;

/** Reduce phone-camera originals before transfer; unsupported formats still use server conversion. */
export async function preparePhotoUpload(file: File, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  const cached = preparedPhotos.get(file);
  if (cached) return cached;
  if (file.size <= MIN_OPTIMIZE_BYTES || !/^image\/(jpeg|png|webp)$/.test(file.type)
    || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    signal.throwIfAborted();
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64 * 1024 * 1024) return file;
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Preserve transparency in PNG/WebP photos. JPEG camera images stay JPEG.
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, type, .88));
    signal.throwIfAborted();
    if (!blob || blob.size >= file.size) return file;
    const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
    const prepared = new File([blob], file.name.replace(/\.[^.]*$/, "") + "." + extension,
      { type: blob.type, lastModified: file.lastModified });
    preparedPhotos.set(file, prepared);
    return prepared;
  } catch (error) {
    if (signal.aborted) throw error;
    return file;
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
