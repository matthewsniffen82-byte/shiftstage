"use client";
import SafetyReportForm from "./SafetyReportForm";
import type { SafetyDetails } from "@/src/lib/dancr/public-case-intake";
import { useEffect, useRef } from "react";
export type PublicReportReason = SafetyDetails;
export function PublicReportReasonDialog({ error, onClose, onReason, saving, title, titleId, receipt }: {
  error?: string; onClose: () => void; onReason: (details: SafetyDetails) => void;
  saving: boolean; title: string; titleId: string;
  receipt?: { id: string; createdAt: string } | null;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { dialog.current?.querySelector<HTMLElement>(receipt ? "button" : "select")?.focus(); }, [receipt]);
  return <div className="profile-report-gate public-report-reason-gate" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={dialog} aria-labelledby={titleId} aria-modal="true" className="profile-report-dialog public-report-reason-dialog" role="dialog" onKeyDown={event => {
      if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="public-report-reason-header"><h2 id={titleId}>{title}</h2><button data-close-control="" aria-label={`Close ${title.toLowerCase()}`} className="public-report-reason-close" disabled={saving} onClick={onClose} type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
      {receipt ? <section className="case-confirmation" role="status"><h3>Report received</h3><p>Case reference: <strong>{receipt.id}</strong></p><p>Received: {new Date(receipt.createdAt).toLocaleString()}</p><p>Save this reference for follow-up with <a href="mailto:support@mydancr.com">support@mydancr.com</a>. Your report is awaiting review; this confirmation does not mean content has been removed.</p><button type="button" onClick={onClose}>Done</button></section> : <SafetyReportForm onSubmit={onReason} saving={saving} error={error} hasTarget />}
    </section>
  </div>;
}
