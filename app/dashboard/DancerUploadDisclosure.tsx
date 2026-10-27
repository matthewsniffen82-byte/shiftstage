"use client";

import { useContext, useEffect, useRef, type ReactNode } from "react";
import { DancerProfileUploadContext, type ProfileUploadKind } from "./DancerProfileUploadContext";

export default function DancerUploadDisclosure({ label, children, kind, defaultOpen = false, openRequested = false }: {
  label: string; children: ReactNode; kind?: ProfileUploadKind; defaultOpen?: boolean; openRequested?: boolean;
}) {
  const picker = useContext(DancerProfileUploadContext);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const initiallyOpen = useRef(defaultOpen);
  useEffect(() => { if (openRequested && disclosure.current && (!picker?.libraryEditor || kind === "videos")) disclosure.current.open = true; }, [openRequested, picker?.libraryEditor, kind]);
  const openPicker = picker?.open;
  useEffect(() => { if (openRequested && kind && (!picker?.libraryEditor || kind === "videos")) openPicker?.(kind); }, [openRequested, kind, openPicker, picker?.libraryEditor]);
  if (picker && kind && !picker.libraryEditor) return <div className="dancer-guided-upload-form" hidden={picker.active !== kind}>
    {children}
  </div>;
  return <details className="dancer-upload-picker" data-profile-upload ref={disclosure} open={picker?.libraryEditor ? undefined : initiallyOpen.current}>
    <summary>{picker?.libraryEditor ? kind === "videos" ? "+ Add videos" : "+ Add photos" : label}</summary>
    {children}
  </details>;
}
