import { clubEditorMedia, mediaClubStatuses, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";
import type { DancerPhotoItem, DancerPreviewVideo } from "./dashboard-types";

type Notice = { id: string; text: string; href: string; action: string; attention?: boolean; venueId?: string };

export function DancerOverviewAttention({ photos, videos, avatarPending, avatarRejected, videoError, videosLoading, clubMedia }: {
  photos: DancerPhotoItem[]; videos: DancerPreviewVideo[];
  avatarPending: boolean; avatarRejected: boolean; videoError: string; videosLoading: boolean;
  clubMedia: ClubMediaViewState;
}) {
  const notices: Notice[] = [];
  const photoLink = "#dancer-profile-media-library", videoLink = "#dancer-profile-video-library";
  const scope = clubMedia.activeClub && !clubMedia.error && !clubMedia.loading ? { ...clubMedia, selectedClub: clubMedia.activeClub } : undefined;
  const covered = new Set<string>();
  const addMedia = (kind: "photo" | "video", items: { id: string; status: string }[]) => {
    const groups = new Map<string, { count: number; rejected: boolean; venueId?: string; venueName?: string }>();
    for (const item of items) {
      const rejected = ["rejected", "denied"].includes(item.status);
      if (!rejected && !["pending", "uploading", "moderating", "submitted"].includes(item.status)) continue;
      const rows = clubMedia.error || clubMedia.loading ? [] : mediaClubStatuses(clubMedia.statuses, item.id, kind).filter(row => !row.hidden);
      const club = rows.find(row => row.venueId === clubMedia.selectedClub?.id) || rows[0];
      const key = `${kind}:${rejected ? "rejected" : "pending"}:${club?.venueId || "global"}`;
      const group = groups.get(key) || { count: 0, rejected, venueId: club?.venueId, venueName: club?.venueName };
      group.count += 1; groups.set(key, group);
      if (club) covered.add(`${club.venueId}:${kind}:${item.id}:${rejected ? "rejected" : "pending"}`);
    }
    for (const [key, group] of groups) {
      const { count, rejected, venueId, venueName } = group;
      const text = rejected ? `${count} ${kind}${count === 1 ? " needs" : "s need"} replacement.` : `${count} ${kind}${count === 1 ? " is" : "s are"} being checked.`;
      notices.push({ id: key, text: `${venueName ? `${venueName}: ` : ""}${text}`, href: kind === "photo" ? photoLink : videoLink,
        action: rejected ? `Review ${kind}s` : `View ${kind} review`, attention: rejected, venueId });
    }
  };
  addMedia("photo", scope ? clubEditorMedia(photos, scope) : photos);
  if (!videoError && !videosLoading) addMedia("video", scope ? clubEditorMedia(videos, scope, "video") : videos.filter(video => video.distributionScope !== "feed_only"));
  if (avatarRejected || avatarPending) notices.push({ id: "avatar", text: avatarRejected ? "Your avatar needs replacement." : "Your avatar is being checked.", href: "#dancer-main-photo", action: "Review main photo", attention: avatarRejected });
  if (videoError) notices.push({ id: "video-error", text: "Video review status is temporarily unavailable.", href: videoLink, action: "Open videos" });
  if (clubMedia.error) notices.push({ id: "club-error", text: clubMedia.error, href: photoLink, action: "Open club media" });
  else if (!clubMedia.loading) {
    const rows = clubMedia.statuses.filter(row => !row.hidden && (!clubMedia.activeClub || row.venueId === clubMedia.activeClub.id));
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!["pending", "submitted", "rejected"].includes(row.status)) continue;
      const item = (row.kind === "video" ? videos : photos).find(item => mediaClubStatuses([row], item.id, row.kind).length > 0);
      if (item && covered.has(`${row.venueId}:${row.kind}:${item.id}:${row.status === "rejected" ? "rejected" : "pending"}`)) continue;
      const key = `${row.venueId}:${row.kind === "video" ? "video" : "photo"}:${row.status === "rejected" ? "rejected" : "pending"}`;
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    for (const [key, group] of groups) {
      const row = group[0], kind = row.kind === "video" ? "video" : "photo";
      const rejected = row.status === "rejected";
      notices.push({ id: key, text: `${row.venueName}: ${group.length} ${kind}${group.length === 1 ? "" : "s"} ${rejected ? "not approved" : "awaiting club approval"}.`,
        href: kind === "photo" ? photoLink : videoLink, action: `Review ${kind}s`, attention: rejected, venueId: row.venueId });
    }
    for (const requirement of clubMedia.requirements || []) {
      if (clubMedia.activeClub && requirement.venueId !== clubMedia.activeClub.id) continue;
      const club = clubMedia.clubs.find(club => club.id === requirement.venueId);
      if (!club) continue;
      if ((requirement.approvedPhotos < 3 || !requirement.hasApprovedMain) && !notices.some(notice => notice.venueId === club.id && notice.href === photoLink)) {
        notices.push({ id: `${club.id}:photos-needed`, text: `${club.name}: ${requirement.approvedPhotos}/3 photos approved${requirement.hasApprovedMain ? "." : "; main photo approval needed."}`,
          href: photoLink, action: "Review photos", attention: true, venueId: club.id });
      }
      if (requirement.approvedVideos < 1 && !notices.some(notice => notice.venueId === club.id && notice.href === videoLink)) {
        notices.push({ id: `${club.id}:video-needed`, text: `${club.name}: 1 approved video needed.`, href: videoLink, action: "Review videos", attention: true, venueId: club.id });
      }
    }
  }
  if (!notices.length) return null;
  const needsAttention = notices.some(notice => notice.attention);
  return <section className="dancer-attention-note dancer-overview-attention" aria-label="Media review status" data-needs-attention={needsAttention || undefined}>
    <h3><span className="dancer-attention-dot" aria-hidden="true" />{needsAttention ? "Needs attention" : "Media updates"}</h3>
    <ul>{notices.map(notice => <li key={notice.id}><span>{notice.text}</span><a href={notice.href} onClick={() => { if (notice.venueId) clubMedia.onSelectClub?.(notice.venueId); }}>{notice.action} →</a></li>)}</ul>
  </section>;
}
