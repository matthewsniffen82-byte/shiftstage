"use client";

import { useEffect, useRef, useState } from "react";
import { renderTableQrPrintDocument, tableQrDownloadBlob, type TableQrPrintImage } from "./admin-table-qr-print";

export default function AdminTableQrPreview({ name, images, onClose }: {
  name: string;
  images: TableQrPrintImage[];
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const printFrame = useRef<HTMLIFrameElement>(null);
  const [downloads, setDownloads] = useState<Array<TableQrPrintImage & { url: string }>>([]);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [printReady, setPrintReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const urls: string[] = [];
    try {
      const prepared = images.map(image => {
        const url = URL.createObjectURL(tableQrDownloadBlob(image.imageDataUrl));
        urls.push(url);
        return { ...image, url };
      });
      setDownloads(prepared);
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: "start" });
    } catch {
      setError("The QR image could not be prepared. Close the preview and try again.");
    }
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [images]);

  useEffect(() => {
    if (!frameLoaded) return;
    const doc = printFrame.current?.contentDocument;
    if (!doc) { setError("Printing is unavailable. You can still download each QR image."); return; }
    let active = true;
    setPrintReady(false);
    void renderTableQrPrintDocument(doc, name, images).then(() => {
      if (active) setPrintReady(true);
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : "Unable to prepare printing. You can still download each QR image.");
    });
    return () => { active = false; };
  }, [frameLoaded, images, name]);

  function print() {
    const target = printFrame.current?.contentWindow;
    if (!printReady || !target) return;
    try { target.focus(); target.print(); }
    catch { setError("Printing is unavailable in this browser. Download the QR images to print them."); }
  }

  return <section ref={panel} className="admin-table-qr-preview" aria-label="Table QR preview" tabIndex={-1}>
    <div className="admin-table-qr-heading"><h3>{images.length === 1 ? images[0].label : `${images.length} table QR signs`}</h3>
      <button type="button" onClick={onClose}>Close preview</button></div>
    <button type="button" disabled={!printReady} onClick={print}>{printReady ? "Print / save PDF" : "Preparing print layout…"}</button>
    <p>Download the PNG, or open the full-size image and press and hold it to save.</p>
    <div className="admin-table-qr-preview-images">{downloads.map(image => <figure key={image.id}>
      <figcaption>{image.label}</figcaption>
      <img src={image.url} alt={`${name} · ${image.label} QR code`} width={720} height={720}
        onError={() => setError("A QR preview did not load. Close the preview and try again.")} />
      <div className="admin-table-qr-actions">
        <a href={image.url} download={`table-qr-${image.id}.png`}>Download PNG</a>
        <a href={image.url} target="_blank" rel="noopener noreferrer">Open full-size image</a>
      </div>
    </figure>)}</div>
    {error ? <p role="alert">{error}</p> : null}
    <iframe ref={printFrame} title="Table QR print layout" className="admin-table-qr-print-frame" aria-hidden="true" tabIndex={-1}
      srcDoc="<!doctype html><html><head></head><body></body></html>" onLoad={() => setFrameLoaded(true)} />
  </section>;
}
