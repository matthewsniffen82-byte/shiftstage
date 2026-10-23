"use client";

import DancerVideoThumbnail from "./DancerVideoThumbnail";
import "./dancer-pending-media-grid.css";

export type PendingMediaCard = {
  id: string;
  kind: "photo" | "video";
  label: string;
  isMainPhoto?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  disabled?: boolean;
  removing?: boolean;
  onRemove: () => void;
};

export default function DancerPendingMediaGrid({ items, addMore }: {
  items: PendingMediaCard[];
  addMore?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  if (!items.length) return null;
  return <div className="dancer-pending-media-box" role="group" aria-label="Awaiting final approval">
    <div className="dancer-pending-media-header">
      <strong className="dancer-pending-media-heading">Awaiting final approval</strong>
      {addMore ? <button className="dancer-pending-media-add" type="button" disabled={addMore.disabled} onClick={addMore.onClick}>{addMore.label}</button> : null}
    </div>
    <ul className="dancer-pending-media-grid">
      {items.map(item => <li key={`${item.kind}:${item.id}`}>
        <div className="dancer-pending-media-preview" role={item.kind === "video" ? "img" : undefined} aria-label={item.kind === "video" ? item.label : undefined}>
          {item.kind === "video" ? <DancerVideoThumbnail videoUrl={item.videoUrl} posterUrl={item.imageUrl} />
            : item.imageUrl ? <img src={item.imageUrl} alt={item.label} loading="lazy" /> : <span>{item.label}</span>}
          {item.isMainPhoto ? <strong className="dancer-pending-media-label">Main photo/avatar</strong> : null}
        </div>
        <button className="dancer-pending-media-remove" type="button" disabled={item.disabled || item.removing}
          aria-label={`Remove ${item.label.toLowerCase()}`} onClick={item.onRemove}>
          {item.removing ? "Removing…" : "Remove"}
        </button>
      </li>)}
    </ul>
  </div>;
}
