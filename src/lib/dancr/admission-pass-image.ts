export type AdmissionPassImage = {
  qrImage: string;
  venueName: string;
  title: string;
  arrivalLabel: string;
  expiresAt: string;
  timezone: string;
  offerHours: string;
};

export async function createAdmissionPassImage(pass: AdmissionPassImage): Promise<File> {
  // Use the issued QR, including its white quiet zone, without generating a new pass.
  const qr = new Image();
  await new Promise<void>((resolve, reject) => {
    qr.onload = () => resolve();
    qr.onerror = () => reject(new Error("Unable to prepare the QR image."));
    qr.src = pass.qrImage;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1112;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image saving is unavailable.");
  context.fillStyle = "#100d15";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  const text = (value: string, y: number, size: number, color = "#f8fafc") => {
    const label = value.replace(/\s+/g, " ").trim();
    let fontSize = size;
    context.font = `600 ${fontSize}px sans-serif`;
    while (context.measureText(label).width > 640 && fontSize > 18) {
      context.font = `600 ${--fontSize}px sans-serif`;
    }
    context.fillStyle = color;
    context.fillText(label, 360, y, 640);
  };
  text("MYDANCR · ADMISSION", 60, 20, "#c4a0f5");
  text(pass.venueName, 120, 36);
  text(pass.title, 170, 28, "#ded7e7");
  context.imageSmoothingEnabled = false;
  context.drawImage(qr, 40, 208, 640, 640);
  text("Show at the door · One guest", 892, 28);
  text(pass.arrivalLabel, 936, 24, "#ded7e7");
  const expiry = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: "short", timeZone: pass.timezone,
  }).format(new Date(pass.expiresAt));
  text(`Expires ${expiry}`, 978, 22, "#ded7e7");
  if (pass.offerHours) text(`Offer hours: ${pass.offerHours} (club local time)`, 1020, 20, "#ded7e7");
  text("Staff checks current validity. Club rules apply.", 1070, 20, "#bfc0cc");
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error("Unable to save the pass image.")), "image/png");
  });
  const club = pass.venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "club";
  return new File([blob], `mydancr-${club}-qr-pass.png`, { type: "image/png" });
}

export function saveAdmissionPassImage(file: File): void {
  // Prepare the file before the click, then let the browser save it to the device.
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
