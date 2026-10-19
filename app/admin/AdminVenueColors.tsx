"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { requestAdminJson } from "./admin-session";
import { DEFAULT_GUEST_ACCENT, normalizeGuestAccent, venueGuestTheme, type VenueGuestColors } from "@/src/lib/dancr/venue-guest-theme";
import "./admin-venue-colors.css";

export default function AdminVenueColors({ venueId, slug, name }: { venueId: string; slug: string; name: string }) {
  const [saved, setSaved] = useState<(VenueGuestColors & { configured?: boolean }) | null>(null);
  const [draft, setDraft] = useState({ internalAccent: "", embedAccent: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setLoading(true); setSaved(null); setStatus(""); setFailed(false);
    void requestAdminJson(`/api/admin/venues/colors?venueId=${encodeURIComponent(venueId)}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      fallbackMessage: "Unable to load guest colors.",
    }).then(data => {
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId || !data.colors) throw new Error("Guest colors could not be confirmed.");
      setSaved(data.colors); setDraft({ internalAccent: data.colors.internalAccent || "", embedAccent: data.colors.embedAccent || "" });
    }).catch(error => {
      if (!controller.signal.aborted) { setFailed(true); setStatus(error.message || "Unable to load guest colors."); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [venueId, revision]);

  const keys = ["internalAccent", "embedAccent"] as const;
  const valid = keys.every(key => !draft[key].trim() || normalizeGuestAccent(draft[key]));
  const colors = { internalAccent: normalizeGuestAccent(draft.internalAccent), embedAccent: normalizeGuestAccent(draft.embedAccent) };
  const dirty = Boolean(saved && (saved.configured === false || keys.some(key => colors[key] !== saved[key])));
  const link = slug ? `https://www.mydancr.com/embed/venues/${encodeURIComponent(slug)}` : "";
  const code = `<iframe src="${link}" title="Dancers working now" width="100%" height="720" style="display:block;border:0;border-radius:12px" loading="lazy"></iframe>`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saved || !valid || !dirty || inFlight.current || !lifetime.current) return;
    const controller = lifetime.current;
    inFlight.current = true; setBusy(true); setStatus(""); setFailed(false);
    try {
      const data = await requestAdminJson("/api/admin/venues/colors", { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, colors }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), fallbackMessage: "Unable to save guest colors." });
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId || !data.colors) throw new Error("Color save could not be confirmed.");
      setSaved(data.colors); setDraft({ internalAccent: data.colors.internalAccent || "", embedAccent: data.colors.embedAccent || "" });
      setStatus("Guest colors saved.");
    } catch (error) {
      if (!controller.signal.aborted) { setFailed(true); setStatus(error instanceof Error ? error.message : "Unable to save guest colors."); }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setFailed(false); setStatus(`${label} copied.`); }
    catch { setFailed(true); setStatus("Copy is unavailable. Select and copy the text below."); }
  }
  return <section className="admin-venue-colors" aria-label={`${name} guest colors`}>
    <h3>Guest colors</h3>
    <p>Accent colors for this location’s table QR pages and website embed. MyDancr’s public app and staff dashboard keep their usual colors.</p>
    {loading ? <p role="status">Loading colors…</p> : saved ? <form onSubmit={save}>
      <div className="admin-venue-color-fields">{keys.map(key => {
        const label = key === "internalAccent" ? "Table QR color" : "Website embed color";
        const preview = normalizeGuestAccent(draft[key]) || DEFAULT_GUEST_ACCENT;
        return <fieldset key={key} disabled={busy}>
          <legend>{label}</legend>
          <div className="admin-venue-color-inputs">
            <input type="color" aria-label={`${label} picker`} value={preview} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} />
            <input type="text" aria-label={`${label} hex code`} value={draft[key]} maxLength={7} placeholder="MyDancr default" spellCheck={false}
              aria-invalid={Boolean(draft[key].trim() && !normalizeGuestAccent(draft[key]))}
              onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} />
          </div>
          <span className="admin-venue-color-preview" style={venueGuestTheme(preview) as CSSProperties}>{key === "internalAccent" ? "Request" : "Open profile"}</span>
          <button type="button" disabled={!draft[key]} onClick={() => setDraft(value => ({ ...value, [key]: "" }))}>Use MyDancr default</button>
          <small>{key === "internalAccent" ? "Includes profiles opened from a table QR page." : "Includes profiles opened inside the website embed."}</small>
        </fieldset>;
      })}</div>
      {!valid ? <p role="alert">Enter a six-digit hex color, including #.</p> : null}
      <button type="submit" disabled={busy || !dirty || !valid}>{busy ? "Saving…" : "Save guest colors"}</button>
    </form> : <button type="button" onClick={() => setRevision(value => value + 1)}>Retry loading colors</button>}
    {status ? <p role={failed ? "alert" : "status"}>{status}</p> : null}
    {link ? <details className="admin-venue-embed-code"><summary>Website embed link &amp; code</summary>
      <p>Use this link on this location’s website page. Saved colors update automatically.</p>
      <label>Embed link<input readOnly value={link} onFocus={event => event.target.select()} /></label>
      <button type="button" onClick={() => void copy(link, "Embed link")}>Copy link</button>
      <label>HTML embed code<textarea readOnly rows={4} value={code} onFocus={event => event.target.select()} /></label>
      <button type="button" onClick={() => void copy(code, "Embed code")}>Copy code</button>
    </details> : null}
  </section>;
}
