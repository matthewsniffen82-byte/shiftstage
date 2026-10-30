"use client";
import { DashboardHelpArea } from "../components/dashboard-help-scope";

import { useState } from "react";
import dynamic from "next/dynamic";
import "./venue-guests.css";

const VenueCustomersPanel = dynamic(() => import("./VenueCustomersPanel"));

export default function VenueContactsSection({ venueId, refreshKey, active, timezone }: {
  venueId: string; refreshKey?: string | null; active: boolean; timezone: string;
}) {
  const [opened, setOpened] = useState(false);
  const [visited, setVisited] = useState(false);
  return <details id="venue-customers" tabIndex={-1} className="venue-optional-tools venue-guests-workspace venue-contacts-section"
    onToggle={event => {
      if (event.target !== event.currentTarget) return;
      setOpened(event.currentTarget.open);
      if (event.currentTarget.open) setVisited(true);
    }}>
    <summary>Contacts &amp; marketing</summary>
    <DashboardHelpArea context="venue-contacts" active={active && opened}>
    {visited && <div className="venue-guest-tab-panel">
      <VenueCustomersPanel refreshKey={`${venueId}:${refreshKey || ""}`} active={active && opened} timezone={timezone} />
    </div>}
    </DashboardHelpArea>
  </details>;
}
