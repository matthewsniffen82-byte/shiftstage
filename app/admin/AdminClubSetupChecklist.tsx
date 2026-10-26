"use client";

import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";
import { ADMIN_DATA_CHANGED } from "./admin-data-events";

export type ClubSetupStep = { id: string; label: string; complete: boolean; detail: string };
export function clubSetupSteps(venue: Record<string, unknown>, pageReady: boolean, hasDeal: boolean, equipment: { tables: number; dressing: boolean } | null): ClubSetupStep[] {
  const connected = Boolean(venue.owner_user_id || venue.ownerUserId);
  return [
    { id: "application", label: "Application", complete: true, detail: (venue.signup_request as { id?: string } | null)?.id ? "Approved club workspace" : "Existing club record" },
    { id: "access", label: "Manager access", complete: connected, detail: connected ? "Manager connected" : "Manager account not connected" },
    { id: "page", label: "Club page", complete: pageReady, detail: pageReady ? "Details, phone and hours saved" : "Complete details, phone and hours" },
    { id: "branding", label: "Club images", complete: Boolean(venue.logo_image_url), detail: venue.logo_image_url ? "Logo uploaded · cover optional" : "Upload the club logo" },
    { id: "deal", label: "Club Deal", complete: hasDeal, detail: hasDeal ? "Active deal saved" : "Complete the club deal" },
    { id: "tables", label: "Table QR codes", complete: Boolean(equipment?.tables), detail: equipment ? `${equipment.tables} active table codes` : "Checking saved table codes" },
    { id: "stickers", label: "Dancer Check-In Tag", complete: Boolean(equipment?.dressing), detail: equipment ? equipment.dressing ? "Assigned and active. Test the physical tag before delivery." : "Assign a dancer check-in tag" : "Checking tag assignment" },
    { id: "publish", label: "Publishing", complete: venue.is_active === true, detail: venue.is_active === true ? "Club is live" : venue.page_review_status === "venue_review" ? "Waiting for the manager’s approval" : "Preview and send the page for approval" },
  ];
}

export default function AdminClubSetupChecklist({ venue, pageReady, hasDeal, onOpen }: {
  venue: Record<string, unknown>; pageReady: boolean; hasDeal: boolean; onOpen: (step: string) => void;
}) {
  const venueId = String(venue.id);
  const [equipment, setEquipment] = useState<{ tables: number; dressing: boolean } | null>(null);
  const [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => setRevision(value => value + 1), 350); };
    window.addEventListener(ADMIN_DATA_CHANGED, refresh);
    return () => { clearTimeout(timer); window.removeEventListener(ADMIN_DATA_CHANGED, refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    const options = { cache: "no-store" as const, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) };
    void Promise.all([requestAdminJson(`/api/admin/venues/table-qr?venueId=${encodeURIComponent(venueId)}`, options), requestAdminJson("/api/admin/nfc-tags", options)])
      .then(([tables, stickers]) => {
        if (controller.signal.aborted) return;
        if (tables.venueId !== venueId || !Array.isArray(tables.links) || !Array.isArray(stickers.tags)) throw new Error("Setup could not be confirmed.");
        const tags = stickers.tags.filter((tag: { venueId: string; status: string }) => tag.venueId === venueId && tag.status === "active");
        setEquipment({ tables: tables.links.filter((link: { active: boolean }) => link.active).length,
          dressing: tags.some((tag: { type: string }) => tag.type === "dressing_room") });
      }).catch(() => { if (!controller.signal.aborted) { setEquipment(null); setError(true); } });
    return () => controller.abort();
  }, [venueId, revision]);
  const steps = clubSetupSteps(venue, pageReady, hasDeal, equipment), next = steps.find(step => !step.complete);
  return <section className="admin-club-checklist" aria-label="Club setup checklist">
    <header><strong>Club setup</strong><span>{steps.filter(step => step.complete).length} of {steps.length} ready</span></header>
    {next ? <button type="button" className="admin-setup-next" onClick={() => onOpen(next.id)}>Next: {next.label} →</button> : <p>Setup recorded. Keep physical tags tested and the club page current.</p>}
    <ol>{steps.map(step => <li key={step.id}><button type="button" onClick={() => onOpen(step.id)}>
      <span className={step.complete ? "is-complete" : ""} aria-label={step.complete ? "Complete" : "Needs attention"}>{step.complete ? "✓" : "○"}</span>
      <span><strong>{step.label}</strong><small>{error && ["tables", "stickers"].includes(step.id) ? "Status unavailable · open to check" : step.detail}</small></span><span aria-hidden="true">›</span>
    </button></li>)}</ol>
    {error ? <button type="button" onClick={() => setRevision(value => value + 1)}>Retry setup status</button> : null}
  </section>;
}
