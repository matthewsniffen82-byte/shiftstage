export const MYDANCR_PREVIEW_TITLE = "TEST SITE";
export const MYDANCR_PREVIEW_MESSAGE =
  "All profiles, affiliations, schedules, offers, and activity shown are test data.";

export function MyDancrPreviewBanner() {
  return (
    <aside className="mydancr-preview-banner" aria-label="Test site notice" role="note">
      <strong>{MYDANCR_PREVIEW_TITLE}</strong>
      <span>{MYDANCR_PREVIEW_MESSAGE}</span>
    </aside>
  );
}

// The discovery homepage is a checked-in HTML shell served by app/route.ts,
// so it receives the same notice without maintaining a second copy of its text.
export const myDancrPreviewBannerHtml =
  `<aside class="mydancr-preview-banner" aria-label="Test site notice" role="note">`
  + `<strong>${MYDANCR_PREVIEW_TITLE}</strong><span>${MYDANCR_PREVIEW_MESSAGE}</span></aside>`;
