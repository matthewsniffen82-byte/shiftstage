"use client";

import { useEffect, useRef, useState } from "react";
import type { DancerPhotoItem } from "./dashboard-types";
import { requestDancerInternalMainPhotoJson } from "./dashboard-session";
import "./internal-main-photo.css";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";

export default function DancerInternalMainPhotoPicker({ photos, disabled = false, onProfileChange }: { photos: DancerPhotoItem[]; disabled?: boolean; onProfileChange?: (profile: Record<string, unknown>) => void }) {
  const [selected, setSelected] = useState("");
  const [displayed, setDisplayed] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [cropping, setCropping] = useState(false);
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
    if (disabled || cropping || action.current || loading) return;
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
      setSelected(photoId); setDisplayed(photoId); setMessage("Club roster photo saved.");
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to save your main photo.");
    } finally {
      if (!controller.signal.aborted) { action.current = null; setSaving(""); }
    }
  }

  const currentPhoto = approved.find(photo => photo.id === (selected || displayed));
  return <details className="internal-main-photo-picker" aria-label="Internal main photo">
    <summary>Change club roster photo <small>Optional</small></summary>
    <p>Your main photo is used automatically unless you choose another approved photo.</p>
    {!approved.length ? <p>Your approved uploads will appear here so you can choose a main photo.</p> : <>
      <div className="internal-main-photo-options">
        {approved.map((photo, index) => <button key={photo.id} type="button"
          aria-label={`Use photo ${index + 1} as your Internal main photo`} aria-pressed={(selected || displayed) === photo.id}
          disabled={disabled || cropping || loading || Boolean(saving)} onClick={() => void choose(photo.id)}>
          {photo.imageUrl ? <img src={photo.imageUrl} alt={`Photo ${index + 1}`} loading="lazy" /> : <span className="internal-main-photo-missing">Photo {index + 1}</span>}
          <span>{saving === photo.id ? "Saving…" : (selected || displayed) === photo.id ? "✓ Selected" : "Choose photo"}</span>
        </button>)}
      </div>
      {currentPhoto ? <>
        <DancerSavedPhotoCrop key={currentPhoto.id} photo={currentPhoto} disabled={disabled || loading || Boolean(saving)} onBusyChange={setCropping} onProfileChange={onProfileChange} />
        <p>Crop changes apply wherever this gallery photo is used.</p>
      </> : null}
    </>}
    {loading ? <p role="status">Loading your photo choice…</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" disabled={disabled || Boolean(saving)} onClick={() => setRetry(value => value + 1)}>Reload photo choice</button></div> : null}
  </details>;
}
