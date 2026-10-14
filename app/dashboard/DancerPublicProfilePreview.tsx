"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PublicDancerProfile, { type PublicDancerProfileProps } from "@/app/dancers/[slug]/PublicDancerProfile";
import { requestDashboardJson } from "./dashboard-session";
import type { DancerPhotoItem, DancerPreviewVideo, LoadState } from "./dashboard-types";
import "./dancer-public-profile-preview.css";

export default function DancerPublicProfilePreview({ name, city, avatarUrl, photos, videos, slug, profile: owner, onClose }: {
  name: string; city: string; avatarUrl: string; photos: DancerPhotoItem[]; videos: DancerPreviewVideo[];
  slug: string; profile?: LoadState["profile"]; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<PublicDancerProfileProps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
  }, [mounted]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setContent(null);
    void requestDashboardJson("/api/dancer/profile/preview", { expectedRole: "dancer", cache: "no-store", signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setContent(data.content || null); })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to load your profile activity. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, owner?.id, retry]);

  const approvedPhotos = photos.filter(photo => photo.status === "approved");
  const main = approvedPhotos.find(photo => photo.isPrimary);
  const savedPhotos = Array.isArray(owner?.dancer_photos) ? owner.dancer_photos as Array<Record<string, unknown>> : [];
  const gallery = approvedPhotos.map((photo, index) => {
    const saved = savedPhotos.find(item => item.id === photo.id);
    return {
      ...photo, isPrimary: photo.isPrimary === true, sortOrder: photo.sortOrder ?? index,
      imageSrcSet: typeof saved?.imageSrcSet === "string" ? saved.imageSrcSet : null,
      imageWidth: Number(saved?.imageWidth) || null, imageHeight: Number(saved?.imageHeight) || null,
      focalX: Number(saved?.focalX ?? 50), focalY: Number(saved?.focalY ?? 50),
      likeCount: Number(saved?.like_count ?? content?.profile.photos.find(item => item.id === photo.id)?.likeCount) || 0,
    };
  });
  const mainImage = gallery.find(photo => photo.id === main?.id);
  const profile: PublicDancerProfileProps["profile"] = {
    id: String(owner?.id || "preview"), slug, stageName: name || "Your stage name", city: city || "Your city",
    verified: false, currentRank: null, venueName: null, venueSlug: null, shiftId: null,
    shiftLabel: null, shiftStartsAt: null, shiftEndsAt: null, followerCount: 0, goingCount: 0,
    socialLinks: [], upcomingShifts: [], ...content?.profile,
    // The draft wins over saved public data, including intentionally empty photo slots.
    primaryPhotoUrl: main?.imageUrl || null, avatarPhotoUrl: avatarUrl,
    primaryPhotoSrcSet: mainImage?.imageSrcSet, primaryPhotoFocalX: mainImage?.focalX, primaryPhotoFocalY: mainImage?.focalY,
    primaryPhotoWidth: mainImage?.imageWidth, primaryPhotoHeight: mainImage?.imageHeight,
    avatarPhotoSrcSet: typeof owner?.avatarPhotoSrcSet === "string" ? owner.avatarPhotoSrcSet : null,
    avatarPhotoFocalX: Number(owner?.avatarPhotoFocalX ?? 50), avatarPhotoFocalY: Number(owner?.avatarPhotoFocalY ?? 50),
    photos: gallery,
  };
  profile.stageName = name || "Your stage name";
  profile.city = city || "Your city";
  const publicVideos = videos.filter(video => video.status === "approved" && video.videoUrl).map(video => {
    const published = content?.tvVideos.find(item => item.id === video.id);
    return { ...video, likeCount: published?.likeCount || 0, publishedAt: published?.publishedAt || video.createdAt };
  });

  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} className="dancer-public-preview-dialog" aria-label="Your public profile preview" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dancer-public-preview-toolbar">
      <span>Profile preview · Visitor actions are off</span>
      <button type="button" onClick={onClose}>Back to builder</button>
    </div>
    {loading ? <p role="status">Loading your profile preview…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
      : <PublicDancerProfile {...content} profile={profile} tvVideos={publicVideos} preview onClose={onClose} />}
  </dialog>, document.body);
}
