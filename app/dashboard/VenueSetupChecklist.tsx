"use client";
import type { MouseEvent } from "react";
import type { VenueOperations } from "@/src/lib/dancr/venue-operations";
export default function VenueSetupChecklist({ approved, offers, published, operations, canTeam, onOpen }: {
  approved: boolean; offers: number; published: boolean; operations: VenueOperations | null; canTeam: boolean;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const steps = [
    { label: "Review your club page", done: approved, id: "venue-publication", note: "Preview and approve your information" },
    { label: "Activate a Club Deal", done: offers > 0, id: "venue-club-deals", note: "Review your offer or request a change" },
    { label: "Check dancer check-in", done: operations?.checkInReady, id: "venue-nfc-tags", note: "Check your assigned sticker and test a tap" },
    ...(canTeam ? [{ label: "Add your team", done: operations?.teamReady, id: "venue-team", note: "Optional · invite staff who need access" }] : []),
  ];
  return <details className="venue-setup-checklist" open={!published || undefined}>
    <summary>Club setup <span>{steps.filter(step => step.done).length}/{steps.length} ready</span></summary>
    <ol role="list">{steps.map((step, index) => <li key={step.id} data-complete={Boolean(step.done)}>
      <a href={`#${step.id}`} onClick={event => onOpen(event, step.id)}>
        <span className="venue-setup-step-number" aria-hidden="true">{index + 1}.</span>
        <span className="venue-setup-step-copy"><strong>{step.done ? "✓ " : ""}{step.label}</strong><small>{step.done ? "Ready" : step.note}</small></span>
        <svg className="venue-setup-step-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7" /></svg>
      </a>
    </li>)}</ol>
  </details>;
}
