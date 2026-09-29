"use client";

import { useEffect, useRef, useState } from "react";
import type { DancerPhotoItem } from "./dashboard-types";
import { requestDancerInternalMainPhotoJson } from "./dashboard-session";
import "./internal-main-photo.css";

export default function DancerInternalMainPhotoPicker({ photos, disabled = false }: { photos: DancerPhotoItem[]; disabled?: boolean }) {
  const [selected, setSelected] = useState("");
  const [displayed, setDisplayed] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const action = useRef<AbortController | null>(null);
  const approved = photos.filter(photo => photo.status === "approved");
  const photoIds = approved.map(photo => photo.id).sort().join(",");

  useEffect(() => {
    const controller = new AbortController();
    action.current?.abort();
    action.current = controller;
    setLoading(true); setSaving(""); setError(""); setSelected(""); setDisplayed("");
    void requestDancerInternalMainPhotoJson({ signal: controller.signal, cache: "no-store" })
      .then(data => {
        if (controller.signal.aborted) return;
        setSelected(data.photoId || ""); setDisplayed(data.displayedPhotoId || "");
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load your main photo."); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); action.current = null; } });
    return () => { controller.abort(); action.current?.abort(); action.current = null; };
  }, [photoIds, retry]);

  async function choose(photoId: string) {
    if (disabled || action.current || loading) return;
    const controller = new AbortController();
    action.current = controller;
    setSaving(photoId); setError(""); setMessage("");
    try {
      const data = await requestDancerInternalMainPhotoJson({
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (data.photoId !== photoId) throw new Error("Unable to confirm your main photo. Try again.");
      setSelected(photoId); setDisplayed(photoId); setMessage("Internal main photo saved.");
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to save your main photo.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setSaving(""); }
    }
  }

  return <section className="internal-main-photo-picker" aria-label="Internal main photo">
    <h3>Choose your Internal main photo</h3>
    <p>Choose the full photo guests see on your club roster. Upload your avatar separately.</p>
    {!approved.length ? <p>Your approved uploads will appear here so you can choose a main photo.</p> : <>
      <div className="internal-main-photo-options">
        {approved.map((photo, index) => <button key={photo.id} type="button"
          aria-label={`Use photo ${index + 1} as your Internal main photo`} aria-pressed={selected === photo.id}
          disabled={disabled || loading || Boolean(saving)} onClick={() => void choose(photo.id)}>
          {photo.imageUrl ? <img src={photo.imageUrl} alt={`Photo ${index + 1}`} loading="lazy" /> : <span className="internal-main-photo-missing">Photo {index + 1}</span>}
          <span>{saving === photo.id ? "Saving…" : selected === photo.id ? "✓ Main photo" : "Choose photo"}</span>
        </button>)}
      </div>
      {!loading && !selected && displayed ? <p>Using your approved gallery photo for now. Choose one above to set your Internal main photo.</p> : null}
    </>}
    {loading ? <p role="status">Loading your photo choice…</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" disabled={disabled || Boolean(saving)} onClick={() => setRetry(value => value + 1)}>Reload photo choice</button></div> : null}
  </section>;
}
