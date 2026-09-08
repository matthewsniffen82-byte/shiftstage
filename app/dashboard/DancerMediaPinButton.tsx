"use client";

import { useEffect, useRef, useState } from "react";

export default function DancerMediaPinButton({ label, pinned = false, busy = false, disabled, available = true, onClick, placement = "right" }: {
  label: string;
  pinned?: boolean;
  busy?: boolean;
  disabled?: boolean;
  available?: boolean;
  onClick: () => void;
  placement?: "right" | "left" | "inline";
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const action = `${pinned ? "Unpin" : "Pin"} ${label}`;
  const blocked = disabled || busy;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !root.current?.open) return;
      // Close this disclosure before the profile editor handles Escape.
      event.preventDefault();
      event.stopPropagation();
      root.current.open = false;
      root.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return <details
    className={`dancer-media-menu is-${placement}`}
    ref={root}
    data-pinned={pinned}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}
    onToggle={event => {
      event.stopPropagation();
      setOpen(event.currentTarget.open);
      if (event.currentTarget.open) document.querySelectorAll<HTMLDetailsElement>("details.dancer-media-menu[open]").forEach(menu => {
        if (menu !== event.currentTarget) menu.open = false;
      });
    }}
  >
    <summary aria-label={`Options for ${label}`} aria-disabled={blocked} aria-busy={busy}
      onClick={event => { if (blocked) event.preventDefault(); }}>
      <span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></span>
    </summary>
    <div className="dancer-media-menu-popover">
      <button type="button" aria-label={action} disabled={blocked || !available}
        title={available ? action : `${action} — available after approval`}
        onClick={() => {
          if (blocked || !available) return;
          if (root.current) {
            root.current.open = false;
            root.current.querySelector("summary")?.focus();
          }
          onClick();
        }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path className="dancer-media-pin-head" d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Z" /><path d="M12 15v6" /></svg>
        <span>{pinned ? "Unpin" : "Pin"}</span>
      </button>
    </div>
  </details>;
}
