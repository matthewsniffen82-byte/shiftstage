"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_DANCER_PROFILE_PHOTOS, MAX_DANCER_PROFILE_VIDEOS } from "@/src/lib/dancr/media-limits";
import { DancerMediaPreviewContext, type ProfileUploadKind } from "./DancerProfileUploadContext";
import { mergeMediaLibraryItems, type MediaLibraryItem } from "./media-library-items";
import DancerVideoThumbnail from "./DancerVideoThumbnail";
import "./dancer-media-library.css";

type PreviewItem = { id: string; imageUrl?: string | null; videoUrl?: string | null; status: string };

export default function DancerMediaLibrarySection({ kind, items, removedIds = [], attentionIds = [], open, busy, loading = false, error = "", onOpen, onClose, children }: {
  kind: ProfileUploadKind; items: PreviewItem[]; open: boolean; busy: boolean;
  removedIds?: string[];
  attentionIds?: string[];
  loading?: boolean; error?: string; onOpen: () => void; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const [uploadSnapshot, setUploadSnapshot] = useState("[]");
  const previews = kind === "videos" ? mergeMediaLibraryItems(items, JSON.parse(uploadSnapshot) as MediaLibraryItem[], removedIds) : items;
  const title = kind === "photos" ? "My Photos" : "My Videos";
  const singular = kind === "photos" ? "photo" : "video";
  const processing = previews.filter(item => ["uploading", "moderating"].includes(item.status)).length;
  const needsAttention = (item: PreviewItem) => ["failed", "rejected"].includes(item.status) || attentionIds.includes(item.id);
  const attention = previews.filter(needsAttention).length;
  const pending = previews.filter(item => !needsAttention(item) && !["approved", "uploading", "moderating"].includes(item.status)).length;
  const capacity = kind === "photos" ? MAX_DANCER_PROFILE_PHOTOS : MAX_DANCER_PROFILE_VIDEOS;
  const previewSlots = Math.max(6, previews.length + (previews.length < capacity ? 1 : 0));
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
      <div className="dancer-media-library-strip" role="group" aria-label={`${title} preview`}>
        {Array.from({ length: previewSlots }, (_, index) => {
          const item = previews[index];
          return <button type="button" key={item?.id || `empty-${index}`} disabled={busy}
            aria-label={item ? `Edit ${singular} ${index + 1}` : `Add ${singular}`}
            onClick={onOpen}>
            {kind === "videos" && item ? <DancerVideoThumbnail posterUrl={item.videoUrl?.startsWith("blob:") ? undefined : item.imageUrl} videoUrl={item.videoUrl} />
              : item?.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : !item ? <span aria-hidden="true">+</span> : null}
          </button>;
        })}
      </div>
      <div className="dancer-media-library-footer">
        <p role="status">{previews.length
          ? <>{`${previews.length} ${previews.length === 1 ? singular : kind}${processing ? ` · ${processing} processing` : ""}${pending ? ` · ${pending} awaiting approval` : ""}`}{attention ? <span className="dancer-media-needs-attention"> · {attention} need attention</span> : null}</>
          : loading ? "Loading videos…" : error ? "Videos unavailable. Open Edit to retry."
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
        <DancerMediaPreviewContext.Provider value={setUploadSnapshot}>{children}</DancerMediaPreviewContext.Provider>
      </div>
    </dialog>
  </section>;
}
