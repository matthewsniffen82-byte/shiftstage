"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./dancer-photo-controls.css";

export default function DancerPhotoControls({ label, primary, children, disabled = false, compact = false, hidden = false, openRequested = 0 }: {
  label: string;
  primary: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
  hidden?: boolean;
  openRequested?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (openRequested) setExpanded(true); }, [openRequested]);
  useEffect(() => { if (hidden) setExpanded(false); }, [hidden]);
  return <div className="dancer-photo-controls" hidden={hidden} onKeyDown={event => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    trigger.current?.focus();
  }}>
    <div className="dancer-photo-controls-row">
      {compact ? null : primary}
      {children || compact ? <button ref={trigger} className="dancer-photo-options-toggle" type="button"
        aria-label={`More options for ${label}`} aria-expanded={expanded} aria-controls={optionsId}
        disabled={disabled} onClick={() => setExpanded(current => !current)}>
        <span aria-hidden="true">•••</span>
      </button> : null}
    </div>
    {/* Keep crop/upload state mounted when the extra controls are collapsed. */}
    {children || compact ? <div id={optionsId} className="dancer-photo-options" hidden={!expanded} role="group" aria-label={`${label} options`}>
      {compact ? <>{primary}{children}</> : children}
    </div> : null}
  </div>;
}
