"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_DANCER_PROFILE_PHOTOS, MAX_DANCER_PROFILE_VIDEOS } from "@/src/lib/dancr/media-limits";
import { DancerMediaPreviewContext, type ProfileUploadKind } from "./DancerProfileUploadContext";
import { mergeMediaLibraryItems, type MediaLibraryItem } from "./media-library-items";
import DancerVideoThumbnail from "./DancerVideoThumbnail";
import DancerMediaUploadRules from "./DancerMediaUploadRules";
import { mediaRejectionLabel, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { clubEditorMedia, type ClubMediaState } from "@/src/lib/dancr/club-media-status";
import "./dancer-media-library.css";

type PreviewItem = Pick<MediaLibraryItem, "id" | "imageUrl" | "videoUrl" | "status" | "moderationStatus" | "upload"> & {
  distributionScope?: "profile_and_feed" | "feed_only";
};

export default function DancerMediaLibrarySection({ kind, items, removedIds = [], attentionIds = [], minimumCount, open, busy, loading = false, error = "", onOpen, onClose, children, clubContext, clubMedia }: {
  kind: ProfileUploadKind; items: PreviewItem[]; open: boolean; busy: boolean;
  removedIds?: string[];
  attentionIds?: string[];
  minimumCount?: number;
  loading?: boolean; error?: string; onOpen: () => void; onClose: () => void; children: ReactNode;
  clubContext?: ReactNode;
  clubMedia?: ClubMediaState;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const [uploadSnapshot, setUploadSnapshot] = useState("[]");
  const allPreviews = kind === "videos" ? mergeMediaLibraryItems(items, JSON.parse(uploadSnapshot) as MediaLibraryItem[], removedIds) : items;
  const previews = clubEditorMedia(allPreviews, clubMedia, kind === "photos" ? "photo" : "video");
  const title = kind === "photos" ? "My Photos" : "My Videos";
  const singular = kind === "photos" ? "photo" : "video";
  const requirement = minimumCount ? `${minimumCount} approved ${minimumCount === 1 ? singular : kind} required. More ${kind} are optional.` : "";
  const needsAttention = (item: PreviewItem) => Boolean(item.upload?.error) || attentionIds.includes(item.id)
    || ["Not approved", "Upload failed", "Review delayed"].includes(mediaReviewLabel(item.status, item.moderationStatus, singular));
  const approvedCount = new Set(items.filter(item => item.status === "approved" && !needsAttention(item)
    && !removedIds.includes(item.id) && (kind !== "videos" || item.distributionScope !== "feed_only")).map(item => item.id)).size;
  const requirementMet = Boolean(minimumCount && approvedCount >= minimumCount);
  const requirementLine = requirement ? <p className="dancer-media-library-requirement" data-complete={requirementMet || undefined}>
    {requirementMet ? <><span role="img" aria-label="Requirement met">✓</span>{" "}</> : null}{requirement}
  </p> : null;
  const processing = previews.filter(item => !needsAttention(item) && ["uploading", "moderating"].includes(item.status)).length;
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
    {requirementLine}
    <h3 id={`dancer-${kind}-library-title`}>{title}</h3>
    <div className="dancer-media-library-card">
      <div className="dancer-media-library-strip" role="group" aria-label={`${title} preview`}>
        {Array.from({ length: previewSlots }, (_, index) => {
          const item = previews[index];
          return <button type="button" key={item?.id || `empty-${index}`} disabled={busy}
            data-needs-attention={Boolean(item && needsAttention(item)) || undefined}
            aria-label={item ? `Edit ${singular} ${index + 1}${needsAttention(item) ? `: ${["rejected", "denied"].includes(item.status) || attentionIds.includes(item.id) ? mediaRejectionLabel(singular) : "Needs attention"}` : ""}` : `Add ${singular}`}
            onClick={onOpen}>
            {kind === "videos" && item ? <DancerVideoThumbnail posterUrl={item.videoUrl?.startsWith("blob:") ? undefined : item.imageUrl} videoUrl={item.videoUrl} />
              : item?.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : !item ? <span aria-hidden="true">+</span> : null}
          </button>;
        })}
      </div>
      <div className="dancer-media-library-footer">
        <p role="status">{previews.length
          ? <>{`${previews.length} ${previews.length === 1 ? singular : kind}${processing ? ` · ${processing} processing` : ""}${pending ? ` · ${pending} awaiting approval` : ""}`}{attention ? <span className="dancer-media-needs-attention"> · {attention} need attention</span> : null}</>
          : clubMedia?.filterToClub ? clubMedia.loading ? "Checking club approvals…" : clubMedia.error ? "Club approvals unavailable."
            : clubMedia.selectedClub ? `Add ${kind} for ${clubMedia.selectedClub.name}.` : "Choose a club to edit its media."
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
        <div>
          {requirementLine}
          <h3 id={`dancer-${kind}-editor-title`}>{title}</h3>
        </div>
        <button type="button" className="dancer-media-library-done" aria-label={`Done editing ${kind}`} title="Done" disabled={busy} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </button>
      </header>
      <div className="dancer-media-library-content">
        {clubContext}
        <p className="dancer-media-library-hint">{kind === "photos" ? "Tap a photo to edit. Choose + to add more." : "Tap a video to play. Choose + to add more."}</p>
        <DancerMediaUploadRules kind={singular} />
        <DancerMediaPreviewContext.Provider value={setUploadSnapshot}>{children}</DancerMediaPreviewContext.Provider>
      </div>
    </dialog>
  </section>;
}
