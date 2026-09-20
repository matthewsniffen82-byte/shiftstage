"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DANCER_AGREEMENT_HREF } from "@/src/lib/dancr/dancer-agreement-version";
import { LegalDocumentBody, type DocumentContent } from "./LegalDocument";
import "./dancer-agreement-dialog.css";

function DancerAgreementDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [agreementDocument, setAgreementDocument] = useState<DocumentContent | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.documentElement.style.overflow;
    dialog?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.documentElement.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void import("@/src/content/legal/dancer-agreement.json").then(module => {
      if (!cancelled) setAgreementDocument(module.default);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [attempt]);

  function followSection(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const href = event.target.closest("a")?.getAttribute("href");
    if (!href?.startsWith("#")) return;
    const section = event.currentTarget.querySelector<HTMLElement>(href);
    if (section) {
      event.preventDefault();
      section.scrollIntoView({ block: "start" });
    }
  }

  return <dialog
    ref={dialogRef}
    className="dancer-agreement-dialog"
    aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
  >
    <header className="dancer-agreement-dialog-header">
      <h2 id={headingId}>Dancer Agreement</h2>
      <button type="button" aria-label="Close Dancer Agreement" onClick={onClose}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div className="dancer-agreement-dialog-body" onClick={followSection}>
      {agreementDocument ? <LegalDocumentBody document={agreementDocument} showDownload={false} /> : failed ? <div role="alert">
        <p>The agreement could not load. Please try again.</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
      </div> : <p role="status">Loading Dancer Agreement…</p>}
    </div>
  </dialog>;
}

export default function DancerAgreementLink({ children = "Dancer Agreement", className }: { children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);

  return <>
    <a
      className={className}
      href={DANCER_AGREEMENT_HREF}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }}
    >{children}</a>
    {open ? createPortal(<DancerAgreementDialog onClose={() => setOpen(false)} />, document.body) : null}
  </>;
}
