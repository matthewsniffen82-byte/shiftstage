export const MYDANCR_PREVIEW_TITLE = "MyDancr Preview";
export const MYDANCR_PREVIEW_MESSAGE =
  "Venue participation, schedules, Club Deals, QR redemptions, and earnings are test-only.";

export function MyDancrPreviewBanner() {
  return (
    <aside className="mydancr-preview-banner" aria-label="MyDancr preview notice" role="note">
      <strong>{MYDANCR_PREVIEW_TITLE}</strong>
      <span>{MYDANCR_PREVIEW_MESSAGE}</span>
    </aside>
  );
}

// The discovery homepage is a checked-in HTML shell served by app/route.ts,
// so it receives the same notice without maintaining a second copy of its text.
export const myDancrPreviewBannerHtml =
  `<aside class="mydancr-preview-banner" aria-label="MyDancr preview notice" role="note">`
  + `<strong>${MYDANCR_PREVIEW_TITLE}</strong><span>${MYDANCR_PREVIEW_MESSAGE}</span></aside>`;
