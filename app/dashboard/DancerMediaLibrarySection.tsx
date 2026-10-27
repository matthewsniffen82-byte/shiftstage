"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ProfileUploadKind } from "./DancerProfileUploadContext";
import "./dancer-media-library.css";

type PreviewItem = { id: string; imageUrl?: string | null; status: string };

export default function DancerMediaLibrarySection({ kind, items, open, busy, loading = false, error = "", onOpen, onClose, children }: {
  kind: ProfileUploadKind; items: PreviewItem[]; open: boolean; busy: boolean;
  loading?: boolean; error?: string; onOpen: () => void; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const title = kind === "photos" ? "My Photos" : "My Videos";
  const singular = kind === "photos" ? "photo" : "video";
  const pending = items.filter(item => item.status !== "approved").length;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, [open]);
  return <section className="dancer-media-library-section" aria-labelledby={`dancer-${kind}-library-title`}>
    <h3 id={`dancer-${kind}-library-title`}>{title}</h3>
    <div className="dancer-media-library-card">
      <div className="dancer-media-library-strip" aria-label={`${title} preview`}>
        {Array.from({ length: 6 }, (_, index) => {
          const item = items[index];
          const more = index === 5 ? Math.max(0, items.length - 6) : 0;
          return <button type="button" key={item?.id || `empty-${index}`} disabled={busy}
            aria-label={item ? `Edit ${singular} ${index + 1}${more ? ` and ${more} more` : ""}` : `Add ${singular}`}
            onClick={onOpen}>
            {item?.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : !item ? <span aria-hidden="true">+</span> : null}
          </button>;
        })}
      </div>
      <div className="dancer-media-library-footer">
        <p role="status">{loading ? "Loading videos…" : error ? "Videos unavailable. Open Edit to retry." : items.length
          ? `${items.length} ${items.length === 1 ? singular : kind}${pending ? ` · ${pending} awaiting approval` : ""}`
          : kind === "photos" ? "Add your main photo and profile pictures." : "Add videos to your profile."}</p>
        <button ref={edit} type="button" className="dancer-media-library-edit" aria-label={`Edit ${title.toLowerCase()}`} aria-haspopup="dialog" disabled={busy} onClick={onOpen}>Edit</button>
      </div>
    </div>
    <dialog ref={dialog} className="dancer-media-library-dialog" aria-labelledby={`dancer-${kind}-editor-title`}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!busy) onClose(); }}
      onClose={event => { if (event.target !== event.currentTarget) return; onClose(); edit.current?.focus({ preventScroll: true }); }}>
      <header className="dancer-media-library-heading">
        <h3 id={`dancer-${kind}-editor-title`}>{title}</h3>
        <button type="button" className="dancer-media-library-done" aria-label={`Done editing ${kind}`} title="Done" disabled={busy} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </button>
      </header>
      <div className="dancer-media-library-content">
        <p className="dancer-media-library-hint">{kind === "photos" ? "Tap a photo to edit. Choose + to add more." : "Tap a video to play. Choose + to add more."}</p>
        {children}
      </div>
    </dialog>
  </section>;
}
