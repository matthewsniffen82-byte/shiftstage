"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function DancerUploadDisclosure({ label, children, defaultOpen = false, openRequested = false }: {
  label: string; children: ReactNode; defaultOpen?: boolean; openRequested?: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const initiallyOpen = useRef(defaultOpen);
  useEffect(() => { if (openRequested && disclosure.current) disclosure.current.open = true; }, [openRequested]);
  return <details className="dancer-upload-picker" data-profile-upload ref={disclosure} open={initiallyOpen.current}>
    <summary>{label}</summary>
    {children}
  </details>;
}
