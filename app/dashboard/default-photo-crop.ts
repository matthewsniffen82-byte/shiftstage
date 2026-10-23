import { requestDashboardJson } from "./dashboard-session";

/** Apply the same centered 9:16 crop shown in the batch previews, without a dialog. */
export async function keepDefaultPhotoCrop(file: File, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  let source: ImageBitmap | HTMLImageElement;
  let bitmap: ImageBitmap | undefined;
  let image: HTMLImageElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap;
    } catch {
      signal.throwIfAborted();
      const body = new FormData(); body.set("file", file);
      const data = await requestDashboardJson("/api/dancer/photos/preview", {
        method: "POST", body, signal, fallbackMessage: "Photo couldn't be read. Choose another photo.",
      });
      signal.throwIfAborted();
      if (typeof data.imageDataUrl !== "string" || !data.imageDataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Invalid photo format.");
      image = new Image(); image.src = data.imageDataUrl;
      await image.decode(); source = image;
    }
    signal.throwIfAborted();
    const width = bitmap ? bitmap.width : image!.naturalWidth;
    const height = bitmap ? bitmap.height : image!.naturalHeight;
    if (!width || !height || width * height > 64 * 1024 * 1024) throw new Error("Photo couldn't be decoded.");
    const cropWidth = Math.min(width, height * 9 / 16), cropHeight = cropWidth * 16 / 9;
    const scale = Math.min(1, 2400 / Math.max(cropWidth, cropHeight));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to crop photo.");
    context.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, "image/jpeg", .94));
    signal.throwIfAborted();
    if (!blob) throw new Error("Unable to crop photo.");
    return new File([blob], file.name.replace(/\.[^.]*$/, "") + "-card.jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap?.close();
    if (image) image.src = "";
    if (canvas) canvas.width = canvas.height = 0;
  }
}
