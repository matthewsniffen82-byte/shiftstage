"use client";
import { useEffect, useState } from "react";

export default function InternalTapEntry({ id, encrypted, mac }: { id: string; encrypted: string; mac: string }) {
  const [tested, setTested] = useState(false);
  const [error, setError] = useState("");
  const valid = /^[\da-f]{32}$/i.test(encrypted) && /^[\da-f]{16}$/i.test(mac);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!valid) return;
    let disposed = false;
    let submitted = false;

    async function verifyVisibleTap() {
      if (disposed || submitted || document.visibilityState !== "visible") return;
      submitted = true;
      try {
        const response = await fetch(`/api/internal-tap/${encodeURIComponent(id)}`, {
          method: "POST",
          credentials: "same-origin",
          mode: "same-origin",
          referrerPolicy: "origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ e: encrypted, c: mac }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (disposed) return;
        if (!response.ok || data.ok !== true) {
          setError(typeof data.error === "string" && data.error ? data.error : "Tap the table sticker again to open the grid.");
          return;
        }
        if (data.tested === true) {
          setTested(true);
          return;
        }
        if (typeof data.href !== "string" || !/^\/internal\/club\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(data.href)) {
          setError("The grid could not be opened. Tap the table sticker again.");
          return;
        }
        window.location.replace(data.href);
      } catch {
        if (!disposed) setError("Unable to connect. Tap the table sticker again.");
      }
    }

    // Only the visible, still-mounted entry may spend this single-use tap.
    document.addEventListener("visibilitychange", verifyVisibleTap);
    queueMicrotask(verifyVisibleTap);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", verifyVisibleTap);
    };
  }, [id, encrypted, mac, valid]);

  if (valid && !error && !tested) return null;

  return <div className="ir-shell ir-guest">
    {tested ? <section className="ir-panel">
      <h1>Sticker verified</h1>
      <p>Activate this sticker in Site Admin to open the grid for customers.</p>
    </section> : <p role="alert">{error || "Tap the club’s NFC sticker to start a new visit."}</p>}
  </div>;
}
