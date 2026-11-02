"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { mediaLibraryFilters, type MediaLibraryFilter } from "@/src/lib/dancr/club-media-status";
import type { ProfileUploadKind } from "./DancerProfileUploadContext";
import "./dancer-media-editor.css";

export default function DancerMediaEditor({ open, kind, busy, onClose, onKindChange, clubContext, footer, filter, onFilterChange, children }: {
  open: boolean; kind: ProfileUploadKind; busy: boolean; onClose: () => void;
  onKindChange: (kind: ProfileUploadKind) => void; clubContext?: ReactNode; footer?: ReactNode;
  filter: MediaLibraryFilter; onFilterChange: (filter: MediaLibraryFilter) => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { element.close(); return; }
    const focus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    if (!element.open) element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; if (focus?.isConnected) focus.focus({ preventScroll: true }); };
  }, [open]);
  return <dialog ref={dialog} className="dancer-media-library-dialog dancer-media-editor" aria-labelledby="dancer-media-editor-title"
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dancer-media-library-heading">
      <h3 id="dancer-media-editor-title">My Media</h3>
      <button type="button" className="dancer-media-editor-close" aria-label="Close My Media" disabled={busy} onClick={onClose}>×</button>
    </header>
    <div className="dancer-media-editor-navigation">
      {clubContext}
      <div className="dancer-media-editor-tabs" role="tablist" aria-label="Media type">
        {(["photos", "videos"] as const).map(tab => <button key={tab} type="button" role="tab" id={`media-tab-${tab}`}
          aria-selected={kind === tab} aria-controls={`media-panel-${tab}`} tabIndex={kind === tab ? 0 : -1}
          onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault(); const next = event.key === "Home" ? "photos" : event.key === "End" ? "videos" : tab === "photos" ? "videos" : "photos";
            onKindChange(next); dialog.current?.querySelector<HTMLButtonElement>(`#media-tab-${next}`)?.focus();
          } }} onClick={() => onKindChange(tab)}>{tab === "photos" ? "Photos" : "Videos"}</button>)}
      </div>
      <div className="dancer-media-editor-filters" role="group" aria-label="Media status">
        {mediaLibraryFilters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => onFilterChange(value)}>{label}</button>)}
      </div>
    </div>
    <div className="dancer-media-library-content">{children}</div>
    {footer ? <footer className="dancer-media-editor-footer">{footer}</footer> : null}
  </dialog>;
}
