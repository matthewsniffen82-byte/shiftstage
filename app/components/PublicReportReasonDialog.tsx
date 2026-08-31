"use client";

export const PUBLIC_REPORT_REASONS = [
  "Sexual or unsafe content",
  "Harassment or abuse",
  "Spam or misleading content",
  "Other safety concern",
] as const;

export type PublicReportReason = (typeof PUBLIC_REPORT_REASONS)[number];

export function PublicReportReasonDialog({
  error,
  onClose,
  onReason,
  saving,
  title,
  titleId,
}: {
  error?: string;
  onClose: () => void;
  onReason: (reason: PublicReportReason) => void;
  saving: boolean;
  title: string;
  titleId: string;
}) {
  return (
    <div
      className="profile-report-gate public-report-reason-gate"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="profile-report-dialog public-report-reason-dialog"
        role="dialog"
      >
        <header className="public-report-reason-header">
          <h2 id={titleId}>{title}</h2>
          <button
            aria-label={`Close ${title.toLowerCase()}`}
            className="public-report-reason-close"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>
        <div className="public-report-reason-options" role="menu">
          {PUBLIC_REPORT_REASONS.map((reason, index) => (
            <button
              autoFocus={index === 0}
              disabled={saving}
              key={reason}
              onClick={() => onReason(reason)}
              role="menuitem"
              type="button"
            >
              {reason}
            </button>
          ))}
        </div>
        {error ? <p className="profile-report-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
