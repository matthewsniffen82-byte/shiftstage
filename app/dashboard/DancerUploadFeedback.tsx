"use client";

import { createContext, useContext, useEffect } from "react";
import type { mediaBatchSummary } from "./media-upload-feedback";

// The containing workspace also checks other media uploads and unsaved details.
export const DancerCanLeaveUploadContext = createContext(true);
export const DancerPendingUploadsContext = createContext<(kind: string, pending: boolean) => void>(() => {});

export function usePendingUploadNotice(kind: string, pending: boolean) {
  const report = useContext(DancerPendingUploadsContext);
  useEffect(() => { report(kind, pending); return () => report(kind, false); }, [kind, pending, report]);
}

export function DancerUploadsSavedNotice({ saved }: { saved: boolean }) {
  const canLeave = useContext(DancerCanLeaveUploadContext);
  return saved && canLeave ? <small className="dancer-uploads-saved" role="status">
    Uploads saved. You can leave while approval is pending.
  </small> : null;
}

export function DancerMediaSubmissionReceipt({ waitingForClub = false }: { waitingForClub?: boolean }) {
  return <span className="dancer-media-submission-receipt">
    <strong><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="m2.5 8 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>Media submitted</strong>
    {waitingForClub && <span>At the club, tap the dancer check-in tag and request approval.</span>}
  </span>;
}

export function DancerUploadSummary({ summary, busy }: { summary: ReturnType<typeof mediaBatchSummary>; busy: boolean }) {
  if (!summary) return null;
  return <div className="dancer-upload-overall" role="status" aria-live="polite">
    <small>{summary.completed} of {summary.total} uploaded</small>
    {summary.needsAttention ? <small>Some uploads need attention.</small> : null}
    <DancerUploadsSavedNotice saved={summary.allSaved && !busy} />
  </div>;
}

export function DancerUploadProgress({ label, progress }: { label: string; progress?: number }) {
  return <span className={`dancer-upload-progress${progress === undefined ? " is-indeterminate" : ""}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
    <span style={progress === undefined ? undefined : { width: `${progress}%` }} />
  </span>;
}
