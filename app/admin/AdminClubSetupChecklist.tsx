"use client";

import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";
import { ADMIN_DATA_CHANGED } from "./admin-data-events";

export type ClubSetupStep = { id: string; label: string; complete: boolean; detail: string };
export function clubSetupSteps(venue: Record<string, unknown>, pageReady: boolean, hasDeal: boolean): ClubSetupStep[] {
  const connected = Boolean(venue.owner_user_id || venue.ownerUserId);
  const prepared = pageReady && Boolean(venue.logo_image_url) && hasDeal;
  const missing = [!pageReady && "club details", !venue.logo_image_url && "logo", !hasDeal && "Club Deal"].filter(Boolean);
  const completed = venue.is_active === true || Boolean(venue.published_at);
  return [
    { id: "access", label: "Access", complete: connected, detail: connected ? "Manager connected" : "Connect the manager using their approved invitation" },
    { id: "page", label: "Prepare", complete: prepared, detail: prepared ? "Club page and deal ready" : `Complete ${missing.join(", ")}` },
    { id: "publish", label: "Club approval", complete: completed, detail: completed ? "Setup complete" : venue.page_review_status === "venue_review" ? "Waiting for the club’s approval" : venue.page_review_status === "changes_requested" ? "Update the requested details and send again" : "Preview and send for approval" },
  ];
}

export default function AdminClubSetupChecklist({ venue, pageReady, hasDeal, onOpen }: {
  venue: Record<string, unknown>; pageReady: boolean; hasDeal: boolean; onOpen: (step: string) => void;
}) {
  const venueId = String(venue.id);
  const completed = venue.is_active === true || Boolean(venue.published_at);
  const [equipment, setEquipment] = useState<{ tables: number; dressing: boolean } | null>(null);
  const [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => setRevision(value => value + 1), 350); };
    window.addEventListener(ADMIN_DATA_CHANGED, refresh);
    return () => { clearTimeout(timer); window.removeEventListener(ADMIN_DATA_CHANGED, refresh); };
  }, []);
  useEffect(() => {
    if (completed) return;
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
  }, [venueId, revision, completed]);
  const steps = clubSetupSteps(venue, pageReady, hasDeal), next = steps.find(step => !step.complete);
  if (completed) return <section className="admin-club-checklist" aria-label="Club maintenance">
    <header><strong>Club maintenance</strong><span className="is-complete">Setup complete</span></header>
    <p>Manage the club’s details, requests, equipment and access below.</p>
  </section>;
  return <section className="admin-club-checklist" aria-label="Club setup checklist">
    <header><strong>Club setup</strong><span>{steps.filter(step => step.complete).length} of {steps.length} ready</span></header>
    {next ? <button type="button" className="admin-setup-next" onClick={() => onOpen(next.id)}>Next: {next.label} →</button> : <p>Setup recorded. Keep physical tags tested and the club page current.</p>}
    <ol>{steps.map(step => <li key={step.id}><button type="button" onClick={() => onOpen(step.id)}>
      <span className={step.complete ? "is-complete" : ""} aria-label={step.complete ? "Complete" : "Needs attention"}>{step.complete ? "✓" : "○"}</span>
      <span><strong>{step.label}</strong><small>{step.detail}</small></span><span aria-hidden="true">›</span>
    </button></li>)}</ol>
    <details className="admin-setup-equipment"><summary>Equipment preparation</summary>
      <p>MyDancr creates the QR codes and assigns check-in tags. Testing does not hold up club approval.</p>
      <button type="button" onClick={() => onOpen("tables")}>{equipment ? `${equipment.tables} table QR codes` : "View table QR codes"}</button>
      <button type="button" onClick={() => onOpen("stickers")}>{equipment?.dressing ? "Check-in tag assigned" : "Assign check-in tag"}</button>
      {error ? <button type="button" onClick={() => setRevision(value => value + 1)}>Retry equipment status</button> : null}
    </details>
  </section>;
}
