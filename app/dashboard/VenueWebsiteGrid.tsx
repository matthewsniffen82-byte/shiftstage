"use client";

import { useState } from "react";
import { canonicalVenueSlug } from "@/src/lib/dancr/venue-branding";

export default function VenueWebsiteGrid({ slug }: { slug: string }) {
  const [status, setStatus] = useState("");
  const [manualCopy, setManualCopy] = useState("");
  const canonical = canonicalVenueSlug(slug);
  const url = `https://www.mydancr.com/embed/venues/${encodeURIComponent(canonical)}`;
  const previewUrl = url;
  const dashboardPreviewUrl = `${previewUrl}?from=club-dashboard`;
  // Resolve the small viewport in the host page, so framed profiles use the
  // same portrait height as the homepage even on shorter phone screens.
  const code = `<iframe src="${previewUrl}" title="Dancers working now" width="100%" style="height:100vh;height:100svh;border:0;border-radius:16px" loading="lazy" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

  async function copy(value: string, label: string) {
    setManualCopy("");
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied.`);
    } catch {
      setManualCopy(value);
      setStatus("Select and copy the text below.");
    }
  }

  return (
    <section className="venue-publication-panel venue-website-grid" id="venue-website-grid" tabIndex={-1} aria-labelledby="venue-website-grid-heading">
      <div>
        <span className="eyebrow">Your website</span>
        <h2 id="venue-website-grid-heading">Website grid</h2>
        <p>The MyDancr dancer grid and full profiles, in your club’s colors.</p>
      </div>
      <div className="venue-publication-actions">
        <a href={dashboardPreviewUrl} target="_blank" rel="noopener noreferrer">Preview website grid</a>
        <button type="button" onClick={() => void copy(previewUrl, "Preview link")}>Copy preview link</button>
        <button type="button" onClick={() => void copy(code, "Embed code")}>Copy embed code</button>
      </div>
      {status && <p role="status">{status}</p>}
      {manualCopy && <textarea aria-label="Website grid text to copy" readOnly value={manualCopy} onFocus={event => event.currentTarget.select()} rows={4} />}
    </section>
  );
}
