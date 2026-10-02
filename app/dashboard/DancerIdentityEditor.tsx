"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { saveDancerProfileEditor } from "./DashboardShared";

export default function DancerIdentityEditor({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function save() {
    const dialog = dialogRef.current;
    if (!dialog?.open || savingRef.current) return;
    if (!dialog.querySelector<HTMLFormElement>("form")?.reportValidity()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await saveDancerProfileEditor();
      if (dialogRef.current !== dialog || !dialog.open) return;
      if (saved) dialog.close();
      else setError("Check the fields above and try again.");
    } catch (reason) {
      if (dialogRef.current === dialog && dialog.open) {
        setError(reason instanceof Error ? reason.message : "Unable to save your profile details. Try again.");
      }
    } finally {
      savingRef.current = false;
      if (dialogRef.current === dialog) setSaving(false);
    }
  }

  return <>
    <button className="dancer-profile-editor-launch-button" type="button" aria-haspopup="dialog" onClick={() => { setError(""); setOpen(true); }}>Edit</button>
    {open ? <dialog
      ref={dialogRef}
      className="dancer-profile-builder-panel dancer-profile-editor-modal dancer-identity-editor-dialog"
      data-section="identity"
      aria-labelledby={titleId}
      onCancel={event => { if (savingRef.current) event.preventDefault(); }}
      onClose={event => { if (!event.currentTarget.open) { setOpen(false); onClose(); } }}
      onSubmitCapture={event => { event.preventDefault(); event.stopPropagation(); void save(); }}
    >
      <header>
        <h2 id={titleId}>Stage name &amp; city</h2>
        <button aria-label="Close stage name and city editor" disabled={saving} onClick={() => dialogRef.current?.close()} type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </header>
      <div className="dancer-profile-editor-modal-body">
        <fieldset disabled={saving}>{children}</fieldset>
      </div>
      <footer className="dancer-profile-editor-modal-actions">
        <p role="status" aria-live="polite">{error}</p>
        <button aria-busy={saving} disabled={saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save"}</button>
      </footer>
    </dialog> : null}
  </>;
}
