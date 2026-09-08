"use client";

import { useEffect, useRef, useState } from "react";

export default function DancerMediaPinButton({ label, pinned = false, busy = false, disabled, onClick, placement = "right" }: {
  label: string;
  pinned?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  placement?: "right" | "left" | "inline";
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <details className={`dancer-media-menu is-${placement}`} ref={root} data-pinned={pinned}
    onClick={event => event.stopPropagation()}
    onToggle={event => {
      setOpen(event.currentTarget.open);
      if (event.currentTarget.open) document.querySelectorAll<HTMLDetailsElement>("details.dancer-media-menu[open]").forEach(menu => {
        if (menu !== event.currentTarget) menu.open = false;
      });
    }}
    onKeyDown={event => {
      if (event.key === "Escape" && root.current?.open) {
        event.preventDefault(); event.stopPropagation(); root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    }}>
    <summary aria-label={`Options for ${label}`} aria-disabled={disabled || busy} aria-busy={busy}
      onClick={event => { if (disabled || busy) event.preventDefault(); }}>
      <span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span>
    </summary>
    <div className="dancer-media-menu-popover">
      <button type="button" aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`} disabled={disabled || busy} onClick={() => {
        if (disabled || busy) return;
        if (root.current) { root.current.open = false; root.current.querySelector("summary")?.focus(); }
        onClick();
      }}>{pinned ? "Unpin" : "Pin"}</button>
    </div>
  </details>;
}
