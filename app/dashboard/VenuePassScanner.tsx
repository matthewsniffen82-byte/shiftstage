"use client";
import { useEffect, useRef, useState } from "react";
import { venuePassScanPath } from "@/src/lib/dancr/venue-pass-scan";

export default function VenuePassScanner({ active }: { active: boolean }) {
  const [scanning, setScanning] = useState(false), [message, setMessage] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active || !scanning) { setScanning(false); return; }
    let closed = false, controls: { stop: () => void } | undefined;
    const element = video.current;
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (closed || !element) return;
        controls = await new BrowserQRCodeReader().decodeFromConstraints({ video: { facingMode: "environment" }, audio: false }, element, (result, _error, scanner) => {
          if (!result || closed) return;
          const path = venuePassScanPath(result.getText(), window.location.origin);
          if (!path) { setMessage("Scan a MyDancr admission pass for this site."); return; }
          closed = true; scanner.stop(); window.location.assign(path);
        });
        if (closed) controls.stop();
      } catch { if (!closed) { setScanning(false); setMessage("Camera unavailable. Use your phone’s camera to scan the guest’s pass QR code."); } }
    })();
    return () => { closed = true; controls?.stop(); const stream = element?.srcObject; if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop()); };
  }, [active, scanning]);
  return <div className="venue-pass-scanner">
    <button type="button" className="venue-scan-primary" onClick={() => { setMessage(""); setScanning(value => !value); }}>{scanning ? "Stop scanning" : "Scan pass"}</button>
    {scanning && active && <video ref={video} muted playsInline aria-label="Admission pass scanner" />}
    {message && <p role="status">{message}</p>}
  </div>;
}
