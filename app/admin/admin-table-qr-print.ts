type PrintCode = { id: string; label: string; active: boolean };
export type TableQrPrintImage = { id: string; label: string; imageDataUrl: string };

export async function loadTableQrPrintImages(venueId: string, codes: PrintCode[], load: (path: string) => Promise<{ venueId: string; id: string; imageDataUrl: string }>) {
  const active = codes.filter(code => code.active).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const images: TableQrPrintImage[] = [];
  for (let index = 0; index < active.length; index += 4) {
    images.push(...await Promise.all(active.slice(index, index + 4).map(async code => {
      const data = await load(`/api/admin/venues/table-qr?venueId=${encodeURIComponent(venueId)}&download=${encodeURIComponent(code.id)}`);
      if (data.venueId !== venueId || data.id !== code.id || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.imageDataUrl)) {
        throw new Error("A saved QR code could not be confirmed. Refresh the table list before printing.");
      }
      return { id: code.id, label: code.label, imageDataUrl: data.imageDataUrl };
    })));
  }
  return images;
}

export function tableQrDownloadBlob(imageDataUrl: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) throw new Error("The QR image could not be confirmed.");
  const bytes = Uint8Array.from(atob(imageDataUrl.slice("data:image/png;base64,".length)), character => character.charCodeAt(0));
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    throw new Error("The QR image could not be confirmed.");
  }
  return new Blob([bytes], { type: "image/png" });
}

export function renderTableQrPrintDocument(doc: Document, name: string, images: TableQrPrintImage[]) {
  doc.title = `${name} · Table QR signs`;
  const style = doc.createElement("style");
  style.textContent = "body{font:16px system-ui;color:#111;background:#fff;margin:24px}.sign{break-inside:avoid;border:1px solid #bbb;padding:24px;margin:0 0 20px;text-align:center}.sign img{display:block;width:240px;height:240px;margin:12px auto}.sign h1{font-size:26px;margin:4px}.sign h2{font-size:24px}button{padding:12px 24px;margin-bottom:20px}@media print{button{display:none}.sign{break-after:page;border:0;margin:0;padding:20mm 0}.sign:last-child{break-after:auto}}";
  doc.head.append(style); doc.body.replaceChildren();
  const ready: Promise<void>[] = [];
  for (const image of images) {
    const section = doc.createElement("section"); section.className = "sign";
    const heading = doc.createElement("h1"); heading.textContent = name;
    const label = doc.createElement("h2"); label.textContent = image.label;
    const qr = doc.createElement("img"); qr.alt = `${image.label} QR code`;
    ready.push(new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { qr.onload = null; qr.onerror = null; reject(new Error("A QR image did not load. Close the preview and try again.")); }, 15000);
      qr.onload = () => { clearTimeout(timer); resolve(); };
      qr.onerror = () => { clearTimeout(timer); reject(new Error("A QR image failed to load. Please retry printing.")); };
    }));
    qr.src = image.imageDataUrl;
    const instruction = doc.createElement("p"); instruction.textContent = "Scan to see dancers and send a table request.";
    section.append(heading, label, qr, instruction); doc.body.append(section);
  }
  return Promise.all(ready);
}
