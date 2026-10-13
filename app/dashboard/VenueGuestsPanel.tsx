"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import "./venue-guests.css";
import type { VenueOperations } from "@/src/lib/dancr/venue-operations";

const VenueGuestListPanel = dynamic(() => import("./VenueGuestListPanel"));
const PickupDashboardPanel = dynamic(() => import("./PickupDashboardPanel"));
const VenueVipPanel = dynamic(() => import("./VenueVipPanel"));
const VenueCustomersPanel = dynamic(() => import("./VenueCustomersPanel"));
const tabs = [
  ["venue-guest-list", "Guest list"], ["venue-pickups", "Ride requests"],
  ["venue-vip", "VIP requests"], ["venue-customers", "Contacts"],
] as const;
type GuestTab = typeof tabs[number][0];
const readTab = (): GuestTab => {
  const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return tabs.find(([id]) => id === hash)?.[0] || "venue-guest-list";
};

export default function VenueGuestsPanel({ venueId, role, refreshKey, active, timezone, operations }: {
  venueId: string; role: string; refreshKey?: string | null; active: boolean; timezone: string; operations?: VenueOperations | null;
}) {
  const [selected, setSelected] = useState<GuestTab>(readTab);
  const [opened, setOpened] = useState<GuestTab[]>([]);
  const canManage = role === "owner" || role === "manager";
  const selectedTab = canManage ? selected : "venue-guest-list";
  const visibleTabs = canManage ? tabs : tabs.slice(0, 1);
  const counts: Record<GuestTab, number | null | undefined> = {
    "venue-guest-list": operations?.guestExpected, "venue-pickups": operations?.ridesOpen,
    "venue-vip": operations?.vipPending, "venue-customers": operations?.contactsShared,
  };
  useEffect(() => {
    if (active) setOpened(previous => previous.includes(selectedTab) ? previous : [...previous, selectedTab]);
  }, [active, selectedTab]);
  useEffect(() => {
    let frame = 0;
    const followLink = () => {
      const id = tabs.find(([tab]) => tab === window.location.hash.slice(1))?.[0];
      if (!id || (!canManage && id !== "venue-guest-list")) return;
      setSelected(id);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const panel = document.getElementById(id);
        if (panel && !panel.hidden) { panel.focus({ preventScroll: true }); panel.scrollIntoView({ block: "start" }); }
      });
    };
    followLink();
    window.addEventListener("hashchange", followLink);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", followLink); };
  }, [canManage]);
  function select(id: GuestTab) {
    setSelected(id);
    window.history.replaceState(null, "", `#${id}`);
  }
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, current: GuestTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = visibleTabs.findIndex(([id]) => id === current);
    const next = event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
    const id = visibleTabs[next][0]; select(id);
    document.getElementById(`${id}-tab`)?.focus();
  }
  return <div className="venue-guests-workspace">
    <div className="venue-guests-tabs" role="tablist" aria-label="Guest information">
      {visibleTabs.map(([id, label]) => <button type="button" role="tab" key={id} id={`${id}-tab`} aria-controls={id}
        aria-selected={selectedTab === id} tabIndex={selectedTab === id ? 0 : -1}
        onClick={() => select(id)} onKeyDown={event => moveFocus(event, id)}>{label}{counts[id] != null && <span className="venue-tab-count" aria-label={`${counts[id]} ${id === "venue-pickups" ? "open in the last 48 hours" : id === "venue-vip" ? "pending" : id === "venue-customers" ? "shared contacts" : "awaiting admission"}`}>{counts[id]}</span>}</button>)}
    </div>
    {visibleTabs.map(([id]) => <section key={id} id={id} className="info-panel venue-guest-tab-panel" role="tabpanel"
      aria-labelledby={`${id}-tab`} hidden={selectedTab !== id} tabIndex={-1}>
      {(active && selectedTab === id || opened.includes(id)) && <>
        {id === "venue-guest-list" && <VenueGuestListPanel refreshKey={refreshKey} active={active && selectedTab === id} timezone={timezone} />}
        {id === "venue-pickups" && <PickupDashboardPanel venueId={venueId} refreshKey={refreshKey} active={active && selectedTab === id} timezone={timezone} />}
        {id === "venue-vip" && <VenueVipPanel refreshKey={refreshKey} active={active && selectedTab === id} />}
        {id === "venue-customers" && <VenueCustomersPanel refreshKey={`${venueId}:${refreshKey || ""}`} active={active && selectedTab === id} timezone={timezone} />}
      </>}
    </section>)}
    {!canManage && <p className="venue-value-note">Ride requests, VIP requests and shared contacts are available to the venue owner and managers.</p>}
  </div>;
}
