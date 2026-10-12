"use client";

import { useContext, useEffect, useRef, type ReactNode } from "react";
import { DancerProfileUploadContext, type ProfileUploadKind } from "./DancerProfileUploadContext";

export default function DancerUploadDisclosure({ label, children, kind, defaultOpen = false, openRequested = false }: {
  label: string; children: ReactNode; kind?: ProfileUploadKind; defaultOpen?: boolean; openRequested?: boolean;
}) {
  const picker = useContext(DancerProfileUploadContext);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const initiallyOpen = useRef(defaultOpen);
  useEffect(() => { if (openRequested && disclosure.current) disclosure.current.open = true; }, [openRequested]);
  const openPicker = picker?.open;
  useEffect(() => { if (openRequested && kind) openPicker?.(kind); }, [openRequested, kind, openPicker]);
  if (picker && kind) return <div className="dancer-guided-upload-form" hidden={picker.active !== kind}>
    {children}
  </div>;
  return <details className="dancer-upload-picker" data-profile-upload ref={disclosure} open={initiallyOpen.current}>
    <summary>{label}</summary>
    {children}
  </details>;
}
