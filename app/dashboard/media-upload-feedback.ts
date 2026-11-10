export type UploadReceipt = { saved: boolean; failed?: boolean };

/** Draft counts describe only new items, not media already awaiting approval. */
export function mediaDraftSummary(counts: { photos: number; videos: number } | null | undefined, total = 0) {
  const parts = [counts?.photos ? `${counts.photos} new photo${counts.photos === 1 ? "" : "s"}` : "",
    counts?.videos ? `${counts.videos} new video${counts.videos === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(" and ") || (total ? `${total} new item${total === 1 ? "" : "s"}` : "");
}

export function mediaDraftSubmissionHint(counts: { photos: number; videos: number } | null | undefined, total = 0) {
  const label = mediaDraftSummary(counts, total);
  return label ? `${label} ready to submit.` : "";
}

/** Only a server acknowledgment counts as saved; 100% transferred is not enough. */
export function mediaBatchSummary(entries: UploadReceipt[]) {
  if (!entries.length) return null;
  const completed = entries.filter(entry => entry.saved).length;
  return { completed, total: entries.length, needsAttention: entries.some(entry => entry.failed),
    allSaved: completed === entries.length && !entries.some(entry => entry.failed) };
}

/** Upload failures get a short next action. Human review notes are kept separately. */
export function mediaUploadError(error: unknown, kind: "photo" | "video") {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/cancel|abort/i.test(message)) return "Upload canceled.";
  if (/sign in|session|authorization|unauthorized/i.test(message)) return "Sign in again, then tap Retry.";
  if (/25\s?MB|too large|file size|size limit/i.test(message)) return `Choose a ${kind} under 25 MB.`;
  if (/30 seconds|too long|duration.*exceed/i.test(message)) return "Choose a video up to 30 seconds.";
  if (/higher-resolution.*portrait/i.test(message)) return "Choose a higher-resolution video for a portrait crop.";
  if (/vertical|square|portrait|landscape/i.test(message)) return "Use a portrait (9:16) crop.";
  if (/library.*full|slots|maximum|profile.*full/i.test(message)) return `Remove a ${kind} to make room.`;
  if (/rate limit|too many|try.*later/i.test(message)) return "Uploads are busy. Wait a moment, then tap Retry.";
  if (/decode|convert|format|mime|JPEG|HEIC|MP4|MOV|empty|unreadable/i.test(message)) {
    return kind === "photo" ? "Photo couldn't be read. Replace it with a JPEG or PNG." : "Video couldn't be read. Replace it with an MP4 or MOV.";
  }
  if (/consent|rights/i.test(message)) return "Confirm consent and content rights, then retry.";
  if (/network|fetch|connection|interrupt|stalled|timeout|timed out/i.test(message)) return "Upload interrupted. Check your connection, then tap Retry.";
  return "Upload didn't finish. Tap Retry.";
}
