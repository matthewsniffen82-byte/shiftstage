"use client";
import { useEffect, useRef, useState } from "react";

export default function InternalTapEntry({ id, encrypted, mac }: { id: string; encrypted: string; mac: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [tested, setTested] = useState(false);
  const inFlight = useRef(false);
  const valid = /^[\da-f]{32}$/i.test(encrypted) && /^[\da-f]{16}$/i.test(mac);
  useEffect(() => { window.history.replaceState(window.history.state, "", window.location.pathname); }, []);
  async function open() {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/internal-tap/${encodeURIComponent(id)}`, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ e: encrypted, c: mac }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Tap the sticker again to try another connection.");
      if (data.tested) { setTested(true); return; }
      if (typeof data.href !== "string" || !/^\/internal\/club\/[\da-f-]{36}$/.test(data.href)) throw new Error("The club could not be opened. Tap again.");
      window.location.replace(data.href);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to connect. Tap the sticker again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="ir-shell ir-guest"><section className="ir-panel">
    <h1>{tested ? "Sticker verified" : "Open the club"}</h1>
    <p>{tested ? "The secure tap works. MyDancr can now activate this sticker in Site Admin." : "See who’s working and send table requests. Your access lasts 10 hours."}</p>
    {!valid ? <p role="alert">Tap the club’s NFC sticker to start. A saved link cannot open a new visit.</p> : !tested ? <button type="button" disabled={busy} onClick={() => void open()}>{busy ? "Checking tap…" : "Open club"}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section></div>;
}
