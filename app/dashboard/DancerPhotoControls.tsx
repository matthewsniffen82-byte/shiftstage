"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import "./dancer-photo-controls.css";

export default function DancerPhotoControls({ label, primary, children, disabled = false }: {
  label: string;
  primary: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="dancer-photo-controls" onKeyDown={event => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    trigger.current?.focus();
  }}>
    <div className="dancer-photo-controls-row">
      {primary}
      {children ? <button ref={trigger} className="dancer-photo-options-toggle" type="button"
        aria-label={`More options for ${label}`} aria-expanded={expanded} aria-controls={optionsId}
        disabled={disabled} onClick={() => setExpanded(current => !current)}>
        <span aria-hidden="true">•••</span>
      </button> : null}
    </div>
    {/* Keep crop/upload state mounted when the extra controls are collapsed. */}
    {children ? <div id={optionsId} className="dancer-photo-options" hidden={!expanded} role="group" aria-label={`${label} options`}>
      {children}
    </div> : null}
  </div>;
}
