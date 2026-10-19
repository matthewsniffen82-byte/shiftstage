export type ReviewKind = "application" | "photo" | "social" | "video";
export type ReviewTarget = { kind: ReviewKind; id: string };
export type AdminReviewItem = ReviewTarget & {
  key: string; label: string; date: string; dancerId?: string;
  source: "submission" | "moderation" | "video";
  record: Record<string, unknown>;
};
const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const pending = (value: unknown) => ["pending", "pending_review", "review"].includes(text(value));

export function adminReviewQueue(profiles: Array<Record<string, unknown>>, images: Array<Record<string, unknown>>, videos: Array<Record<string, unknown>>) {
  const items: AdminReviewItem[] = [];
  const moderatedPhotos = new Set(images.filter(row => row.decision === "review").map(row => text(row.image_id)).filter(Boolean));
  for (const profile of profiles) {
    const dancerId = text(profile.id), name = text(profile.stageName || profile.stage_name) || "Dancer";
    if (!dancerId || profile.status === "disabled") continue;
    const date = text(profile.createdAt || profile.created_at);
    for (const photo of rows(profile.photos)) {
      const id = text(photo.id);
      if (!id || moderatedPhotos.has(id) || !pending(photo.reviewStatus || photo.review_status)) continue;
      items.push({ key: `photo:${id}`, kind: "photo", id, dancerId, label: `${name} · Photo`, date: text(photo.createdAt) || date, source: "submission", record: profile });
    }
    for (const social of rows(profile.socialLinks || profile.social_links)) {
      const id = text(social.id);
      if (!id || social.isActive === false || social.is_active === false || !pending(social.reviewStatus || social.review_status)) continue;
      items.push({ key: `social:${id}`, kind: "social", id, dancerId, label: `${name} · ${text(social.platform) || "Social link"}`, date, source: "submission", record: profile });
    }
    if (["draft", "pending_review"].includes(text(profile.status))) {
      items.push({ key: `application:${dancerId}`, kind: "application", id: dancerId, dancerId, label: `${name} · Application`, date, source: "submission", record: profile });
    }
  }
  for (const record of images) {
    const id = text(record.id);
    if (!id || record.decision !== "review") continue;
    const dancer = text(record.user_id) ? profiles.find(profile => text(profile.userId) === text(record.user_id)) : undefined;
    items.push({ key: `moderation:${id}`, kind: "photo", id, dancerId: dancer ? text(dancer.id) : undefined,
      label: `${dancer ? text(dancer.stageName || dancer.stage_name) : "Photo"} · ${text(record.upload_context).replaceAll("_", " ") || "Safety review"}`,
      date: text(record.created_at), source: "moderation", record });
  }
  for (const record of videos) {
    const id = text(record.id), dancer = record.dancer as { id?: string; stageName?: string } | null;
    if (!id || record.status !== "submitted") continue;
    items.push({ key: `video:${id}`, kind: "video", id, dancerId: dancer?.id, label: `${dancer?.stageName || "Dancer"} · Video`,
      date: text(record.submittedAt), source: "video", record });
  }
  return items.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)
    || Number(a.kind === "application") - Number(b.kind === "application") || a.key.localeCompare(b.key));
}
