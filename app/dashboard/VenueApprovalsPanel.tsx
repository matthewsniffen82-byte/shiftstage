"use client";
import { useDashboardHelpArea } from "../components/dashboard-help-scope";
import VenueDancerApprovalPanel from "./VenueDancerApprovalPanel";
import "./venue-approvals.css";

export default function VenueApprovalsPanel(props: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange: (count: number | null) => void;
}) {
  useDashboardHelpArea("venue-new-dancers", props.active);
  return <section id="venue-approvals" className="venue-approvals" aria-label="Approvals" tabIndex={-1}>
    <VenueDancerApprovalPanel {...props} />
  </section>;
}
