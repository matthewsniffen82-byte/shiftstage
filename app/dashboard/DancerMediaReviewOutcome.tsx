import "./dancer-media-review-outcome.css";

export default function DancerMediaReviewOutcome({ value, disabled = false, onAction }: {
  value: unknown; disabled?: boolean; onAction: (section: string) => void;
}) {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (typeof result.title !== "string" || typeof result.body !== "string" || typeof result.action !== "string") return null;
  const needsMedia = result.outcome === "needs_main" || result.outcome === "needs_media";
  const section = result.outcome === "needs_main" ? "dancer-main-photo"
    : String(result.emailPath).endsWith("#dancer-videos-title") ? "dancer-profile-video-library" : "dancer-profile-media-library";
  return <section className="dancer-review-outcome" aria-label="Media review results" data-needs-attention={needsMedia || undefined}>
    <h3>{result.title}</h3>
    {result.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {needsMedia ? <ul aria-label="Approved media requirements">
      <li>Main photo: {result.hasApprovedMain ? "Approved" : "Needed"}</li>
      <li>Photos: {Math.min(3, Number(result.approvedPhotos) || 0)}/3 approved</li>
      <li>Video: {Math.min(1, Number(result.approvedVideos) || 0)}/1 approved</li>
    </ul> : null}
    {result.outcome === "media_ready" ? <a href="/dashboard/dancer">{result.action}</a>
      : <button type="button" disabled={disabled} onClick={() => onAction(section)}>{result.action}</button>}
  </section>;
}
