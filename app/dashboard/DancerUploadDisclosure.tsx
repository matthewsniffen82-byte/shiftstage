"use client";

import { useContext, useEffect, useRef, type ReactNode } from "react";
import { DancerProfileUploadContext, type ProfileUploadKind } from "./DancerProfileUploadContext";

function showMediaSourceSheet(element: HTMLDialogElement | null) {
  if (!element || element.open) return;
  element.showModal();
  element.querySelector<HTMLElement>(".dancer-media-source-heading h3")?.focus({ preventScroll: true });
}

// Keep file inputs mounted while the native dialog supplies focus trapping and Escape.
export function DancerMediaSourceSheet({ kind, active, busy, requested, children }: {
  kind: ProfileUploadKind; active: ProfileUploadKind | null; busy?: boolean; requested: boolean; children: ReactNode;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const title = kind === "photos" ? "Add photos" : "Add videos";
  useEffect(() => {
    if (active !== kind) { sheet.current?.close(); return; }
    if (!requested) return;
    // The editor opens first, then the source sheet sits above it in the top layer.
    const frame = window.requestAnimationFrame(() => {
      showMediaSourceSheet(sheet.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, kind, requested]);
  return <div className="dancer-media-source-picker">
    {/* The grid's + slots open this mounted picker without a duplicate visible action. */}
    <button hidden type="button" className="dancer-media-source-trigger" data-profile-upload
      aria-haspopup="dialog" disabled={busy} onClick={() => showMediaSourceSheet(sheet.current)}>
      <span aria-hidden="true">+</span> {title}
    </button>
    <dialog ref={sheet} className="dancer-media-source-sheet" aria-labelledby={`dancer-${kind}-source-title`}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => event.stopPropagation()}
      onClose={event => event.stopPropagation()}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
      }}
      onChangeCapture={event => {
        const input = event.target;
        // Close before the uploader opens its crop/review UI; canceling the picker keeps choices open.
        if (input instanceof HTMLInputElement && input.type === "file" && input.files?.length) sheet.current?.close();
      }}>
      <header className="dancer-media-source-heading">
        <h3 id={`dancer-${kind}-source-title`} tabIndex={-1}>{title}</h3>
        <button type="button" className="dancer-media-source-close" data-close-control="" aria-label={`Close ${title.toLowerCase()}`} onClick={() => sheet.current?.close()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {children}
    </dialog>
  </div>;
}

export default function DancerUploadDisclosure({ label, children, kind, openRequested = false }: {
  label: string; children: ReactNode; kind?: ProfileUploadKind; openRequested?: boolean;
}) {
  const picker = useContext(DancerProfileUploadContext);
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (openRequested && disclosure.current && (!picker?.libraryEditor || kind === "videos")) disclosure.current.open = true; }, [openRequested, picker?.libraryEditor, kind]);
  const openPicker = picker?.open;
  useEffect(() => { if (openRequested && kind && (!picker?.libraryEditor || kind === "videos")) openPicker?.(kind); }, [openRequested, kind, openPicker, picker?.libraryEditor]);
  if (picker && kind && !picker.libraryEditor) return <div className="dancer-guided-upload-form" hidden={picker.active !== kind}>
    {children}
  </div>;
  if (picker?.libraryEditor && kind) return <DancerMediaSourceSheet kind={kind} active={picker.active} busy={picker.busy}
    requested={kind === "videos" && openRequested}>{children}</DancerMediaSourceSheet>;
  return <details className="dancer-upload-picker" data-profile-upload ref={disclosure}>
    <summary>{picker?.libraryEditor ? kind === "videos" ? "+ Add videos" : "+ Add photos" : label}</summary>
    {children}
  </details>;
}
