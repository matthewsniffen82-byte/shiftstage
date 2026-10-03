export const MYDANCR_PREVIEW_TITLE = "DEMO MODE";
export const MYDANCR_PREVIEW_MESSAGE =
  "All profiles, venues, schedules, offers, and activity shown are fictional demo content.";

export function MyDancrPreviewBanner() {
  return (
    <aside className="mydancr-preview-banner" aria-label="Demo mode notice" role="note">
      <style>{".venue-demo-disclosure{display:none}"}</style>
      <strong>{MYDANCR_PREVIEW_TITLE}</strong>
      <span>{MYDANCR_PREVIEW_MESSAGE}</span>
      <details className="venue-demo-disclosure"><summary>DEMO MODE · Fictional data <span aria-hidden="true">ⓘ</span></summary><p>{MYDANCR_PREVIEW_MESSAGE}</p></details>
    </aside>
  );
}

// The discovery homepage is a checked-in HTML shell served by app/route.ts,
// so it receives the same notice without maintaining a second copy of its text.
export const myDancrPreviewBannerHtml =
  `<aside class="mydancr-preview-banner" aria-label="Demo mode notice" role="note">`
  + `<strong>${MYDANCR_PREVIEW_TITLE}</strong><span>${MYDANCR_PREVIEW_MESSAGE}</span></aside>`;
