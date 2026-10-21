"use client";
import { useState } from "react";
import "./admin-venue-colors.css";

// Keep the embed tools in the existing club setup location. All clubs share
// MyDancr's palette; older saved colors are no longer presentation settings.
export default function AdminVenueColors({ slug, name }: { venueId: string; slug: string; name: string }) {
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const link = slug ? `https://www.mydancr.com/embed/venues/${encodeURIComponent(slug)}` : "";
  const code = `<iframe src="${link}" title="Dancers working now" width="100%" height="720" style="display:block;border:0;border-radius:12px" loading="lazy"></iframe>`;
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setFailed(false); setStatus(`${label} copied.`); }
    catch { setFailed(true); setStatus("Copy is unavailable. Select and copy the text below."); }
  }
  return <section className="admin-venue-colors" aria-label={`${name} website embed`}>
    <h3>Website embed</h3>
    <p>Table QR pages, profiles, and website embeds use the MyDancr colors.</p>
    {link ? <details className="admin-venue-embed-code"><summary>Website embed link &amp; code</summary>
      <p>Use this link on this location’s website page.</p>
      <label>Embed link<input readOnly value={link} onFocus={event => event.target.select()} /></label>
      <button type="button" onClick={() => void copy(link, "Embed link")}>Copy link</button>
      <label>HTML embed code<textarea readOnly rows={4} value={code} onFocus={event => event.target.select()} /></label>
      <button type="button" onClick={() => void copy(code, "Embed code")}>Copy code</button>
    </details> : null}
    {status ? <p role={failed ? "alert" : "status"}>{status}</p> : null}
  </section>;
}
