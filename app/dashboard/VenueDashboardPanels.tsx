"use client";
import RefreshButton from "../components/RefreshButton";
import VenueNotificationSettings from "./VenueNotificationSettings";
import { InternalRoster, VenueProfileProvider } from "../internal/InternalRoster";
import VenueWebsiteGrid from "./VenueWebsiteGrid";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
const VenueGuestsPanel = dynamic(() => import("./VenueGuestsPanel"));
import VenueContactsSection from "./VenueContactsSection";
import { CLUB_DEAL_OFFER_PRESETS } from "@/src/lib/dancr/club-deal-presets";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import { type VenueDancerAffiliation } from "@/src/lib/dancr/venue-roster";
import { requestDashboardJson, type DashboardSessionAccount } from "./dashboard-session";
import { PUBLIC_DISCOVERY_REFRESH_KEY, formatVenueReviewHours, DashboardSection, NotificationPanel, SupportInboxPanel, AccountControlsPanel, formatDashboardDate } from "./DashboardShared";
import type { VenueWorkspace, LoadState } from "./dashboard-types";
const VenueApprovalsPanel = dynamic(() => import("./VenueApprovalsPanel"));
const VenueNfcTagPanel = dynamic(() => import("./VenueNfcTagPanel"));

import VenueValueAnalytics from "./VenueValueAnalytics";
import type { VenueValueReport } from "@/src/lib/dancr/venue-analytics";
import { isVenueDashboardDemo, withDemoWorkingRoster } from "@/src/lib/dancr/venue-dashboard-demo";
import { useVenueOperations } from "./useVenueOperations";
import { useVenueApprovalCompletion } from "./useVenueApprovalCompletion";
import VenueTonightOverview from "./VenueTonightOverview";
import "./venue-workspace.css";

const VenueTeamPanel = dynamic(() => import("./VenueTeamPanel"));
const VenueParticipationPanel = dynamic(() => import("./VenueParticipationPanel"));

const VenueTvPanel = dynamic(() => import("./VenueTvPanel"));


function notifyPublicVenuePublication() {
  const revision = String(Date.now());
  // Refresh when this tab returns to discovery, including browser Back.
  try { window.sessionStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, revision); } catch { /* Storage may be unavailable. */ }
  // Other open discovery tabs receive this storage event immediately.
  try { window.localStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, revision); } catch { /* Focus and periodic refresh still work. */ }
}


type RosterSection = "dancers" | "tables" | "approvals";
const rosterTabs = [["dancers", "Roster", "venue-dancer-roster"], ["tables", "Table requests", "venue-table-panel"], ["approvals", "Approvals", "venue-approval-panel"]] as const;
const venueToolSections = ["venue-tools", "venue-nfc-tags", "venue-website-grid", "venue-tv", "venue-support", "venue-guides"];
function rosterSectionForHash(id: string): RosterSection | null {
  if (id === "table-requests") return "tables";
  if (["venue-approvals", "venue-dancer-approvals", "venue-media-reviews"].includes(id)) return "approvals";
  if (["venue-working-now", "venue-dancer-roster"].includes(id)) return "dancers";
  return null;
}

function venueWorkspaceForSection(sectionId: string): VenueWorkspace | null {
  if (["venue-pickups", "venue-guest-list", "venue-vip"].includes(sectionId)) return "tonight";
  if (sectionId === "venue-customers") return "venue";
  if (sectionId === "venue-overview") return "business";
  if (["venue-working-now", "venue-dancer-roster", "venue-approvals", "venue-dancer-approvals", "table-requests", "venue-media-reviews"].includes(sectionId)) return "roster";
  if (venueToolSections.includes(sectionId)) return "venue";
  if (["venue-publication", "venue-website-grid", "venue-notification-settings", "venue-club-deals", "venue-deal-contract-ledger", "venue-tv", "venue-team", "venue-account", "venue-support"].includes(sectionId)) return "venue";
  return null;
}


function initialVenueWorkspace(isPublished: boolean): VenueWorkspace {
  return isPublished ? "tonight" : "venue";
}


export function VenuePanel({
  account,
  analytics,
  deal,
  venueDeals,
  dealRequests,
  profile,
  workingNow,
  initialAffiliations,
  venueAccess,
  refreshedAt,
  supportThreads,
  analyticsPeriod,
  isRefreshing,
  refreshStatus,
  onAnalyticsPeriodChange,
  onRefresh,
  onAccessRemoved,
  onProfileChange,
  onPublicationChange,
  onDealRequestsChange,
}: {
  account: DashboardSessionAccount | null;
  analytics?: LoadState["analytics"];
  deal?: LoadState["deal"];
  venueDeals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  profile?: LoadState["profile"];
  workingNow: Array<Record<string, unknown>>;
  initialAffiliations: Array<Record<string, unknown>>;
  venueAccess?: LoadState["venueAccess"];
  refreshedAt?: string | null;
  supportThreads?: Array<Record<string, unknown>>;
  analyticsPeriod: "tonight" | "7d" | "30d" | "all";
  isRefreshing: boolean;
  refreshStatus: string;
  onAnalyticsPeriodChange: (period: "tonight" | "7d" | "30d" | "all") => void;
  onRefresh: () => void;
  onAccessRemoved: (affiliation: VenueDancerAffiliation) => void;
  onProfileChange: (profile: Record<string, unknown>) => void;
  onPublicationChange: (publication: Record<string, unknown>) => void;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
}) {
  useVenueApprovalCompletion(account?.id || undefined, typeof profile?.id === "string" ? profile.id : undefined);
  const [publicationStatus, setPublicationStatus] = useState("");
  const [isPublishingVenue, setIsPublishingVenue] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [notificationRevision, setNotificationRevision] = useState(0);
  const connectedVenueId = profile?.id;
  const [mediaPending, setMediaPending] = useState(0);
  useEffect(() => { setMediaPending(0); }, [connectedVenueId, account?.id]);
  const { operations, error: operationsError } = useVenueOperations(connectedVenueId, refreshedAt);
  const liveDataReady = Boolean(refreshedAt);
  const [activeWorkspace, setActiveWorkspace] = useState<VenueWorkspace>(() => {
    const sectionId = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
    return venueWorkspaceForSection(sectionId) || (venueAccess?.role === "staff" ? "tonight" : initialVenueWorkspace(profile?.isActive === true || Boolean(profile?.publishedAt)));
  });
  // Defer unopened tools, then keep them mounted to preserve forms and drafts.
  const [openedWorkspaces, setOpenedWorkspaces] = useState<VenueWorkspace[]>([]);
  useEffect(() => {
    setOpenedWorkspaces((opened) => opened.includes(activeWorkspace) ? opened : [...opened, activeWorkspace]);
  }, [activeWorkspace]);
  const [rosterWorkingOnly, setRosterWorkingOnly] = useState(() => typeof window !== "undefined" && window.location.hash === "#venue-working-now");
  const [rosterSection, setRosterSection] = useState<RosterSection>(() => typeof window === "undefined" ? "dancers" : rosterSectionForHash(window.location.hash.slice(1)) || "dancers");
  const [openedRosterSections, setOpenedRosterSections] = useState<RosterSection[]>(["dancers"]);
  const [toolsVisited, setToolsVisited] = useState(false);
  useEffect(() => {
    setOpenedRosterSections(previous => previous.includes(rosterSection) ? previous : [...previous, rosterSection]);
  }, [rosterSection]);

  useEffect(() => {
    let frame = 0;
    const openLinkedWorkspace = () => {
      const sectionId = window.location.hash.slice(1);
      const workspace = venueWorkspaceForSection(sectionId);
      if (!workspace) return;
      setActiveWorkspace(workspace);
      const rosterTarget = rosterSectionForHash(sectionId);
      if (rosterTarget) setRosterSection(rosterTarget);
      if (venueToolSections.includes(sectionId)) setToolsVisited(true);
      if (sectionId === "venue-working-now") setRosterWorkingOnly(true);
      else if (sectionId === "venue-dancer-roster") setRosterWorkingOnly(false);
      // Internal tools open themselves once their authorized data has loaded.
      if (sectionId === "table-requests") return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (window.location.hash.slice(1) !== sectionId) return;
        if (venueToolSections.includes(sectionId)) {
          const tools = document.getElementById("venue-tools");
          if (tools instanceof HTMLDetailsElement) tools.open = true;
        }
        const panel = document.getElementById(sectionId === "venue-working-now" ? "venue-dancer-roster" : sectionId)
          || (venueToolSections.includes(sectionId) ? document.getElementById("venue-tools") : null);
        if (!panel) return;
        if (panel instanceof HTMLDetailsElement) panel.open = true;
        for (let parent = panel.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        if (sectionId === "venue-working-now" || sectionId === "venue-dancer-roster") {
          const roster = panel.querySelector<HTMLDetailsElement>("details.venue-nfc-roster");
          if (roster) roster.open = true;
        }
        panel.scrollIntoView({ block: "start" });
        panel.focus({ preventScroll: true });
      });
    };
    openLinkedWorkspace();
    window.addEventListener("hashchange", openLinkedWorkspace);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", openLinkedWorkspace); };
  }, [liveDataReady]);
  const mountedRef = useRef(false);
  const publicationSequenceRef = useRef(0);
  const publicationAbortRef = useRef<AbortController | null>(null);
  const publicationInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      publicationSequenceRef.current += 1;
      publicationAbortRef.current?.abort();
      publicationAbortRef.current = null;
      publicationInFlightRef.current = false;
    };
  }, []);

  async function submitVenueReview(decision: "approved" | "changes_requested") {
    if (decision === "approved" && !window.confirm("Approve this venue information and commercial package and make the venue live on MyDancr?")) return;
    if (!mountedRef.current || publicationInFlightRef.current) return;
    publicationInFlightRef.current = true;
    const requestId = ++publicationSequenceRef.current;
    publicationAbortRef.current?.abort();
    const controller = new AbortController();
    publicationAbortRef.current = controller;
    setIsPublishingVenue(true);
    setPublicationStatus(decision === "approved" ? "Approving and publishing venue page..." : "Sending change request...");
    try {
      const data = await requestDashboardJson("/api/venue/publication", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, notes: reviewNotes }),
        expectedRole: "venue",
        fallbackMessage: "Unable to record venue page review.",
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== publicationSequenceRef.current) return;
      onProfileChange(data.profile);
      onPublicationChange(data.publication);
      if (decision === "approved") {
        notifyPublicVenuePublication();
        setNotificationRevision((current) => current + 1);
      }
      if (decision === "changes_requested") setReviewNotes("");
      setPublicationStatus(data.message || "Venue page review saved.");
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted && requestId === publicationSequenceRef.current) {
        setPublicationStatus(error instanceof Error ? error.message : "Unable to record venue page review.");
      }
    } finally {
      if (requestId === publicationSequenceRef.current) {
        publicationAbortRef.current = null;
        publicationInFlightRef.current = false;
        if (mountedRef.current) setIsPublishingVenue(false);
      }
    }
  }

  function selectVenueWorkspace(workspace: VenueWorkspace) {
    setActiveWorkspace(workspace);
    if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  function selectRosterSection(section: RosterSection) {
    setRosterSection(section);
    const id = section === "tables" ? "table-requests" : section === "approvals" ? "venue-approvals" : "venue-dancer-roster";
    window.history.replaceState(null, "", `#${id}`);
  }

  function moveRosterFocus(event: React.KeyboardEvent<HTMLButtonElement>, section: RosterSection) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = rosterTabs.filter(([id]) => id !== "approvals" || canManageRoster);
    const index = tabs.findIndex(([id]) => id === section);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectRosterSection(tabs[next][0]);
    document.getElementById(`venue-roster-${tabs[next][0]}-tab`)?.focus();
  }

  function moveVenueWorkspaceFocus(event: React.KeyboardEvent<HTMLButtonElement>, workspace: VenueWorkspace) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const workspaces: VenueWorkspace[] = ["tonight", "roster", "business", "venue"];
    const currentIndex = workspaces.indexOf(workspace);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? workspaces.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + workspaces.length) % workspaces.length;
    const nextWorkspace = workspaces[nextIndex];
    selectVenueWorkspace(nextWorkspace);
    window.requestAnimationFrame(() => document.getElementById(`venue-workspace-${nextWorkspace}-tab`)?.focus());
  }

  function openVenueSection(event: React.MouseEvent<HTMLAnchorElement>, sectionId: string) {
    event.preventDefault();
    const targetSectionId = sectionId === "venue-working-now" ? "venue-dancer-roster" : sectionId;
    if (sectionId === "venue-working-now") setRosterWorkingOnly(true);
    else if (sectionId === "venue-dancer-roster") setRosterWorkingOnly(false);
    setActiveWorkspace(venueWorkspaceForSection(sectionId) || activeWorkspace);
    window.history.replaceState(null, "", `#${sectionId}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.setTimeout(() => {
      const section = document.getElementById(targetSectionId);
      if (!section) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (section instanceof HTMLDetailsElement) section.open = true;
      if (sectionId === "venue-working-now" || sectionId === "venue-dancer-roster") {
        const roster = section.querySelector<HTMLDetailsElement>("details.venue-nfc-roster");
        if (roster) roster.open = true;
      }
      if (sectionId === "venue-nfc-tags") {
        const stickers = section.querySelector<HTMLDetailsElement>("details.venue-roster-stickers");
        if (stickers) stickers.open = true;
      }
      section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      window.setTimeout(() => (section.querySelector<HTMLElement>("summary") || section).focus({ preventScroll: true }), reduceMotion ? 0 : 350);
    }, 50);
  }

  const venueName = String(profile?.name || "Your venue");
  const venueCity = String(profile?.city || "your city");
  const venueSlug = String(profile?.slug || "");
  const dashboardDeals = venueDeals.length ? venueDeals : deal ? [deal] : [];
  const activeDealCount = dashboardDeals.filter((venueDeal) => venueDeal.isActive === true).length;
  const venueReviewHours = formatVenueReviewHours(profile?.opensAt, profile?.closesAt);
  const venueReviewLocation = [profile?.city, profile?.state].map((value) => String(value || "").trim()).filter(Boolean).join(", ") || "Location not provided";
  const venueReviewAddress = String(profile?.address || "").trim() || venueReviewLocation;
  const venueReviewInitials = venueName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase() || "V";
  const activeAffiliations = initialAffiliations.filter((affiliation) => affiliation.status === "active");
  const nfcAuthorizedDancerCount = activeAffiliations.length;
  const permissions = Array.isArray(venueAccess?.permissions) ? venueAccess.permissions : [];
  const venueRole = String(venueAccess?.role || "");
  const canManageRoster = permissions.includes("manage_roster");
  const canReviewPage = permissions.includes("manage_profile");
  const selectedRosterSection = rosterSection === "approvals" && !canManageRoster ? "dancers" : rosterSection;
  const canRequestNfcSupport = permissions.includes("request_nfc_support");
  const canViewTeam = permissions.includes("view_team");
  const isApprovedPage = profile?.isActive === true;
  const isPublished = isApprovedPage && activeDealCount > 0;
  const isPausedForDeals = isApprovedPage && !isPublished;
  const pageReviewStatus = String(profile?.pageReviewStatus || (isPublished ? "published" : "admin_draft"));
  const setupComplete = isApprovedPage || Boolean(profile?.publishedAt);
  const isHidden = setupComplete && !isPublished;
  const isAwaitingVenueReview = !isPublished && pageReviewStatus === "venue_review";
  const venueCustomerPreviewHref = isAwaitingVenueReview && venueSlug
    ? `/?city=${encodeURIComponent(venueCity)}&venue=${encodeURIComponent(venueSlug)}&venue_preview=1`
    : "";
  return (
    <VenueProfileProvider>
      <div className="venue-workspace-toolbar">
        <nav className="venue-workspace-tabs" aria-label="Venue workspace" role="tablist">
          {([
            ["tonight", "Tonight"],
            ["roster", "Dancers & tables"],
            ["business", "Results"],
            ["venue", "Club"],
          ] as const).map(([workspace, label]) => (
            <button
              aria-controls={`venue-workspace-${workspace}`}
              aria-selected={activeWorkspace === workspace}
              className={activeWorkspace === workspace ? "active" : ""}
              id={`venue-workspace-${workspace}-tab`}
              key={workspace}
              onKeyDown={(event) => moveVenueWorkspaceFocus(event, workspace)}
              onClick={() => selectVenueWorkspace(workspace)}
              role="tab"
              tabIndex={activeWorkspace === workspace ? 0 : -1}
              type="button"
            >
              <VenueDashboardIcon section={workspace === "business" ? "analytics" : workspace} />
              <strong>{label}</strong>
              {workspace === "roster" && Number(operations?.tablePending || 0) + mediaPending > 0 && <span className="venue-tab-count" aria-label={`${Number(operations?.tablePending || 0)} table requests and ${mediaPending} media approvals`}>{Number(operations?.tablePending || 0) + mediaPending}</span>}
            </button>
          ))}
        </nav>
        {activeWorkspace === "business" && <div className="venue-analytics-period" role="group" aria-label="Analytics period">
          {(["tonight", "7d", "30d", "all"] as const).map((period) => (
            <button className={analyticsPeriod === period ? "active" : ""} aria-pressed={analyticsPeriod === period} type="button" key={period} onClick={() => onAnalyticsPeriodChange(period)}>
              {period === "tonight" ? "Tonight" : period === "7d" ? "7 days" : period === "30d" ? "30 days" : "All time"}
            </button>
          ))}
        </div>}
      </div>
      <section className="venue-command-panel" aria-label="Venue status">
        <div className="venue-command-status">
          <span className={isPublished ? "venue-live-pill" : "venue-live-pill is-draft"}>{isPublished ? "LIVE" : isHidden ? "HIDDEN" : isAwaitingVenueReview ? "READY TO REVIEW" : "IN SETUP"}</span>
          <div>
            {!isPublished && !isAwaitingVenueReview && activeWorkspace !== "venue" && <p>{isHidden ? isPausedForDeals ? "Hidden until a Club Deal is active. Your approval and setup are saved." : "Your club is hidden. Your approval and setup are saved." : pageReviewStatus === "changes_requested" ? "MyDancr is updating your requested changes." : "MyDancr is preparing your club. We’ll let you know when it’s ready to review."}</p>}
          </div>
          <div className="venue-refresh-control">
            <small>{refreshedAt ? `Updated ${formatRelativeDashboardTime(refreshedAt)}` : "Live data loading"}</small>
            <RefreshButton label="Refresh venue dashboard" busy={isRefreshing} type="button" disabled={isRefreshing} onClick={onRefresh} />
          </div>
        </div>
        {activeWorkspace === "roster" && permissions.includes("view_roster") && <Link className="venue-internal-roster-link" href="/internal" prefetch={false}>View internal <span aria-hidden="true">→</span></Link>}
      </section>
      {isAwaitingVenueReview && canReviewPage && <section className="venue-review-notice" id="venue-review-notice" aria-labelledby="venue-review-notice-heading">
        <div role="status">
          <h2 id="venue-review-notice-heading">Your club page is ready to review</h2>
          <p>Review your club details and agreed offer, then approve the page or request changes.</p>
        </div>
        <a className="dashboard-primary-action" href="#venue-publication" onClick={event => openVenueSection(event, "venue-publication")}>
          Review club page <span aria-hidden="true">→</span>
        </a>
      </section>}
      <hr className="venue-section-divider" />
      {refreshStatus ? <small className="venue-refresh-status" role="status">{refreshStatus}</small> : null}

      <section
        className="venue-workspace-panel"
        hidden={activeWorkspace !== "tonight"}
        id="venue-workspace-tonight"
        role="tabpanel"
        aria-labelledby="venue-workspace-tonight-tab"
      >
        {(activeWorkspace === "tonight" || openedWorkspaces.includes("tonight")) && <>
        <VenueTonightOverview operations={operations} error={operationsError} working={liveDataReady ? workingNow.length : null}
          manager={venueRole === "owner" || venueRole === "manager"} published={isPublished} reviewReady={isAwaitingVenueReview} onOpen={openVenueSection} />
        <VenueGuestsPanel key={`${account?.id}:${connectedVenueId}`} venueId={String(connectedVenueId || "")} role={venueRole}
          transportEnabled={profile?.transportEnabled === true} operations={operations} refreshKey={refreshedAt} active={activeWorkspace === "tonight"} timezone={String(profile?.timezone || "America/Los_Angeles")} />
        </>}
      </section>

      <section className="venue-roster-panel venue-dashboard-section" hidden={activeWorkspace !== "roster"} id="venue-workspace-roster" role="tabpanel" aria-labelledby="venue-workspace-roster-tab">
        <div className="venue-roster-tabs" role="tablist" aria-label="Dancers & tables">
          {rosterTabs.filter(([id]) => id !== "approvals" || canManageRoster).map(([id, label, panel]) => {
            const count = id === "tables" ? operations?.tablePending : id === "approvals" ? mediaPending : nfcAuthorizedDancerCount;
            return <button key={id} id={`venue-roster-${id}-tab`} type="button" role="tab" aria-controls={panel}
              aria-selected={selectedRosterSection === id} tabIndex={selectedRosterSection === id ? 0 : -1}
              onClick={() => selectRosterSection(id)} onKeyDown={event => moveRosterFocus(event, id)}>
              {label}{Number(count) > 0 && <span className="venue-tab-count">{count}</span>}
            </button>;
          })}
        </div>
        <section id="venue-dancer-roster" className="venue-roster-workspace" role="tabpanel" aria-labelledby="venue-roster-dancers-tab" hidden={selectedRosterSection !== "dancers"} tabIndex={-1}>
          {(activeWorkspace === "roster" || openedWorkspaces.includes("roster")) && (liveDataReady ? <VenueNfcTagPanel
            view="roster" initialAffiliations={initialAffiliations} workingNow={workingNow}
            timeZone={String(profile?.timezone || "America/Los_Angeles")} workingOnly={rosterWorkingOnly}
            onWorkingOnlyChange={setRosterWorkingOnly} onAccessRemoved={onAccessRemoved} canManageRoster={canManageRoster}
          /> : <p role="status">{refreshStatus || "Loading dancers and tables…"}</p>)}
        </section>
        <section id="venue-table-panel" className="venue-roster-workspace" role="tabpanel" aria-labelledby="venue-roster-tables-tab" hidden={selectedRosterSection !== "tables"} tabIndex={-1}>
          {(activeWorkspace === "roster" || openedWorkspaces.includes("roster")) && (selectedRosterSection === "tables" || openedRosterSections.includes("tables")) && <InternalRoster operationsOnly sampleTableRequests={isVenueDashboardDemo(profile)} />}
        </section>
        {canManageRoster && Boolean(connectedVenueId) && <section id="venue-approval-panel" role="tabpanel" aria-labelledby="venue-roster-approvals-tab" hidden={selectedRosterSection !== "approvals"} tabIndex={-1}>
          <VenueApprovalsPanel key={`${account?.id}:${connectedVenueId}`} venueId={String(connectedVenueId)} active={activeWorkspace === "roster" && selectedRosterSection === "approvals"} refreshKey={refreshedAt} onCountChange={setMediaPending} />
        </section>}

      </section>

      <section
        aria-labelledby="venue-workspace-business-tab"
        className="venue-dashboard-section venue-results-panel"
        hidden={activeWorkspace !== "business"}
        id="venue-workspace-business"
        role="tabpanel"
      >
        {(activeWorkspace === "business" || openedWorkspaces.includes("business")) && <>
        <section className="info-panel" id="venue-overview" aria-labelledby="venue-results-heading">
          <h2 className="venue-icon-heading" id="venue-results-heading"><VenueDashboardIcon section="analytics" />Results</h2>
          {analytics?.valueReport ? <VenueValueAnalytics
            report={withDemoWorkingRoster(analytics.valueReport as VenueValueReport, profile, workingNow, initialAffiliations as VenueDancerAffiliation[])}
            demoComparisons={isVenueDashboardDemo(profile)}
            period={analytics.period === "tonight" || analytics.period === "7d" || analytics.period === "30d" || analytics.period === "all" ? analytics.period : analyticsPeriod}
            periodStart={String(analytics.periodStart)}
            periodEnd={String(analytics.periodEnd)}
            timezone={String(profile?.timezone || "America/Los_Angeles")}
            totalFollowers={Number(analytics.totalFollowers || 0)}
            conversion={readOptionalNumber(analytics.claimToAdmissionPercent)}
          /> : <p role="status">{!liveDataReady ? refreshStatus || "Loading results…" : "Analytics are unavailable. Refresh to try again."}</p>}
        </section>
        {(venueRole === "owner" || venueRole === "manager") && <a className="venue-text-link" href="#venue-customers">View shared contacts →</a>}
        </>}
      </section>

      <section className="venue-manage-panel venue-dashboard-section" hidden={activeWorkspace !== "venue"} id="venue-workspace-venue" role="tabpanel" aria-labelledby="venue-workspace-venue-tab">
        {(activeWorkspace === "venue" || openedWorkspaces.includes("venue")) && <>
        <section
          id="venue-publication" tabIndex={-1}
          aria-labelledby="venue-publication-heading"
          className={`venue-publication-panel${isPublished ? " is-published" : ""}`}
          hidden={activeWorkspace !== "venue"}
        >
          <div>
            {!setupComplete && <span className="eyebrow">Venue page review</span>}
            <h2 id="venue-publication-heading">
              {isPublished
                ? "Club page & deals"
                : isHidden ? "Your club is hidden"
                : pageReviewStatus === "venue_review"
                  ? "Review your club page & deal"
                  : pageReviewStatus === "changes_requested"
                    ? "MyDancr is working on your changes"
                    : pageReviewStatus === "venue_approved"
                      ? "Approved page ready to finish"
                      : "MyDancr is preparing your venue page"}
            </h2>
            {!isPublished && <p>
              {isHidden ? isPausedForDeals ? "Your setup is complete. MyDancr needs to activate a Club Deal to make your club visible again." : "Your setup is complete and approval is saved. Contact MyDancr to restore visibility."
                : pageReviewStatus === "venue_review"
                  ? "Check your information and agreed offer, preview the page, then approve it to go live."
                  : pageReviewStatus === "changes_requested"
                    ? "Your requested changes were sent. MyDancr will update the page and return it for another review."
                    : pageReviewStatus === "venue_approved"
                      ? "This page was approved under the previous workflow. MyDancr is completing its publication."
                      : "MyDancr is completing your private venue page. You will be notified when it is ready to review."}
            </p>}
          </div>
          {setupComplete ? (
            <div className="venue-publication-actions">
              {isPublished && venueSlug ? <Link href={`/venues/${encodeURIComponent(venueSlug)}`}>View club page</Link> : null}
              <a href="#venue-support" onClick={event => openVenueSection(event, "venue-support")}>{isHidden ? "Contact MyDancr" : "Request a change"}</a>
            </div>
          ) : null}
          {isAwaitingVenueReview || setupComplete ? (
            <details className="venue-review-package" aria-label="Venue information and commercial approval package" open={isAwaitingVenueReview || undefined}>
              <summary>Club information</summary>
              <header className="venue-review-package-heading">
                <span className="venue-review-logo" aria-label={`${venueName} official logo`}>
                  {profile?.logoImageUrl ? (
                    <img
                      alt={`${venueName} official logo`}
                      className="venue-review-logo-image"
                      src={String(profile.logoImageUrl)}
                      srcSet={profile.logoImageSrcSet ? String(profile.logoImageSrcSet) : undefined}
                      sizes="240px"
                    />
                  ) : venueReviewInitials}
                </span>
                <span>
                  <span className="eyebrow">{setupComplete ? "Current club information" : "Club approval"}</span>
                  <strong>{venueName}</strong>
                  {!setupComplete && <small>Review your information and agreed terms.</small>}
                </span>
              </header>
              <div className="venue-review-package-section">
                <strong>Official venue information</strong>
                <dl>
                  <div><dt>Venue name</dt><dd>{venueName}</dd></div>
                  <div><dt>Location</dt><dd>{venueReviewAddress}</dd></div>
                  <div><dt>Phone</dt><dd>{String(profile?.phone || "Not provided")}</dd></div>
                  <div><dt>Website</dt><dd>{String(profile?.website || "Not provided")}</dd></div>
                  <div><dt>Hours</dt><dd>{venueReviewHours || "Not provided"}</dd></div>
                </dl>
              </div>
              <div className="venue-review-package-section">
                <span className="venue-review-commercial-heading">
                  <strong>Subscription</strong>
                </span>
                <dl>
                  <div><dt>Billing model</dt><dd>Venue subscription · no per-customer charge</dd></div>
                </dl>
              </div>
            </details>
          ) : null}
          <details id="venue-club-deals" className="venue-club-deals" tabIndex={-1} open={isAwaitingVenueReview || undefined}>
            <summary>Club Deals <span>{activeDealCount} live</span></summary>
            <p>Managed by MyDancr. Request changes below.</p>
            {liveDataReady ? <VenueDealReadOnlyPanel
              deals={dashboardDeals}
              dealRequests={dealRequests}
              isVenuePublished={isPublished}
              venueCity={venueCity}
              venueSlug={venueSlug}
              reviewMode={isAwaitingVenueReview}
              canRequestDeals={permissions.includes("request_deals") || venueRole === "owner" || venueRole === "manager"}
              onDealRequestsChange={onDealRequestsChange}
            /> : <p role="status">{refreshStatus || "Loading Club Deal requests…"}</p>}
          </details>
          {isAwaitingVenueReview ? (
            <details className="venue-review-request">
              <summary>Request changes</summary>
              <label htmlFor="venue-page-review-notes">What needs correcting?</label>
              <textarea
                id="venue-page-review-notes"
                maxLength={1000}
                placeholder="Tell MyDancr exactly what should be corrected before you approve the page."
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
              />
              <button className="secondary" type="button" disabled={isPublishingVenue || reviewNotes.trim().length < 10} onClick={() => void submitVenueReview("changes_requested")}>Request changes</button>
            </details>
          ) : null}
          {isAwaitingVenueReview ? (
            <section className="venue-review-completion" aria-labelledby="venue-review-completion-heading">
              <h3 id="venue-review-completion-heading">Ready to go live?</h3>
              <div className="venue-publication-actions">
                {venueCustomerPreviewHref ? (
                  <a className="venue-preview-action" href={venueCustomerPreviewHref} rel="noopener noreferrer" target="_blank">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                      <circle cx="12" cy="12" r="2.75" />
                    </svg>
                    Preview customer experience
                  </a>
                ) : null}
                <button className="primary" type="button" disabled={isPublishingVenue} onClick={() => void submitVenueReview("approved")}>
                  {isPublishingVenue ? "Making venue live..." : "Approve & make live"}
                </button>
              </div>
            </section>
          ) : null}
          {publicationStatus ? <p role="status">{publicationStatus}</p> : null}
        </section>

        {(venueRole === "owner" || venueRole === "manager") && <VenueContactsSection
          key={`${account?.id}:${connectedVenueId}`} venueId={String(connectedVenueId || "")} refreshKey={refreshedAt}
          active={activeWorkspace === "venue"} timezone={String(profile?.timezone || "America/Los_Angeles")} />}

        {canViewTeam ? (
          <DashboardSection
            description={setupComplete ? "Invite staff and manage access." : "Invite staff and manage access. Optional during setup."}
            eyebrow="Security"
            hidden={activeWorkspace !== "venue"}
            id="venue-team"
          accordionGroup="venue-management"
            icon={<VenueDashboardIcon section="team" />}
            toggleAffordance="chevron"
            title="Team & activity"
          >
            <VenueTeamPanel initialAccess={venueAccess as { role: "owner" | "manager" | "staff"; permissions: string[] } | null} />
          </DashboardSection>
        ) : null}

        <DashboardSection
          description="Account details and notifications."
          hidden={activeWorkspace !== "venue"}
          id="venue-account"
          accordionGroup="venue-management"
          icon={<VenueDashboardIcon section="account" />}
          toggleAffordance="chevron"
          title="Account"
        >
          <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
            <article className="info-panel venue-account-summary">
              <div className="venue-account-summary-heading">
                <h2>Account details</h2>
                <span className={`venue-account-status${(account?.accountState || "active") === "active" ? " is-active" : ""}`} aria-label={`Account status: ${account?.accountState || "active"}`}>
                  {String(account?.accountState || "active")}
                </span>
              </div>
              <dl>
                <div><dt>Email</dt><dd>{String(account?.email || "Private")}</dd></div>
                <div><dt>Role</dt><dd className="venue-account-role">{String(account?.role || "venue")}</dd></div>
              </dl>
            </article>
            <NotificationPanel refreshKey={`${refreshedAt}:${notificationRevision}`} preferencesHref="#venue-notification-settings" onVenueReview={event => openVenueSection(event, "venue-publication")} />
            <VenueNotificationSettings onSaved={() => setNotificationRevision(value => value + 1)} />
            <AccountControlsPanel
              accountRole="venue"
              accountState={String(account?.accountState || "active")}
              venueAccessRole={venueRole}
              venueName={venueName}
              venueParticipation={venueRole === "owner" && profile?.id ? <VenueParticipationPanel key={String(profile.id)} venueId={String(profile.id)} venueName={venueName}
              onEnded={() => { notifyPublicVenuePublication(); onRefresh(); }} /> : null}
            />
          </div>
        </DashboardSection>
        <details id="venue-tools" tabIndex={-1} className="venue-optional-tools" onToggle={event => { if (event.currentTarget.open) setToolsVisited(true); }}>
          <summary>Tools &amp; help</summary>
          {toolsVisited && <div className="venue-tools-content">
            {permissions.includes("view_nfc") && <VenueNfcTagPanel view="tools" timeZone={String(profile?.timezone || "America/Los_Angeles")}
              workingOnly={false} onWorkingOnlyChange={() => {}} canRequestSupport={canRequestNfcSupport} />}
            {setupComplete && <>
              {isPublished && venueSlug ? <VenueWebsiteGrid slug={venueSlug} /> : null}
              <VenueTvPanel city={venueCity} hidden={activeWorkspace !== "venue"} venueId={String(profile?.id || "")} />
            </>}
            {supportThreads ? <SupportInboxPanel initialThreads={supportThreads} panelId="venue-support" /> : <p role="status">Loading support…</p>}
            {(venueRole === "owner" || venueRole === "manager") && <a href="#venue-pickups" onClick={event => openVenueSection(event, "venue-pickups")}>Ride request history</a>}
            <section id="venue-guides"><Link className="secondary-action" href="/guides">Team guides</Link></section>
          </div>}
        </details>
        </>}
      </section>

    </VenueProfileProvider>
  );
}


function dealTypeLabel(value: string) {
  if (value === "other") return "Other";
  return "Admission";
}


function VenueDealReadOnlyPanel({
  deals,
  dealRequests,
  isVenuePublished,
  venueCity,
  venueSlug,
  reviewMode = false,
  canRequestDeals,
  onDealRequestsChange,
}: {
  deals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  isVenuePublished: boolean;
  venueCity: string;
  venueSlug: string;
  reviewMode?: boolean;
  canRequestDeals: boolean;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
}) {
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState<"add" | "remove">("add");
  const [targetDealId, setTargetDealId] = useState("");
  const [requestedOfferKey, setRequestedOfferKey] = useState<string>(CLUB_DEAL_OFFER_PRESETS[0].key);
  const [requestNotes, setRequestNotes] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [requestStatusTone, setRequestStatusTone] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [confirmedRequestId, setConfirmedRequestId] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const mountedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestInFlightRef = useRef(false);
  const liveDeals = deals.filter((deal) => deal.isActive === true);
  const displayedDeals = [...liveDeals, ...deals.filter((deal) => deal.isActive !== true)];
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      requestInFlightRef.current = false;
    };
  }, []);

  async function submitDealRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mountedRef.current || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setIsRequesting(true);
    setRequestStatusTone("sending");
    setConfirmedRequestId("");
    setRequestStatus("Sending request to MyDancr…");
    try {
      const data = await requestDashboardJson("/api/venue/deal-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offerKey: requestedOfferKey, requestNotes, requestType, targetDealId: requestType === "remove" ? targetDealId : null }),
        expectedRole: "venue",
        fallbackMessage: "Unable to send this Club Deal request.",
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== requestSequenceRef.current) return;
      const confirmedId = String(data.dealRequest?.id || "").trim();
      const confirmedRequests = Array.isArray(data.requests) ? data.requests : [];
      const requestWasPersisted = confirmedId
        && confirmedRequests.some((dealRequest: Record<string, unknown>) => String(dealRequest.id || "") === confirmedId);
      if (!requestWasPersisted) {
        throw new Error("MyDancr did not confirm that this request was saved. Please try again.");
      }
      const confirmedOfferTitle = String(data.dealRequest?.offerTitle || "Club Deal");
      onDealRequestsChange(confirmedRequests);
      setRequestNotes("");
      setIsRequestOpen(false);
      setConfirmedRequestId(confirmedId);
      setRequestStatusTone("success");
      setRequestStatus(`MyDancr received your ${confirmedOfferTitle}${data.dealRequest?.requestType === "remove" ? " removal" : ""} request. It is saved and pending review.`);
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted && requestId === requestSequenceRef.current) {
        setRequestStatusTone("error");
        setRequestStatus(error instanceof Error ? error.message : "Unable to send this Club Deal request.");
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        requestAbortRef.current = null;
        requestInFlightRef.current = false;
        if (mountedRef.current) setIsRequesting(false);
      }
    }
  }

  return (
    <article className="venue-deal-readonly" id="venue-deal-contract-ledger" tabIndex={-1}>
      <div className="venue-contract-deal-list" aria-label="All Club Deals">
        {displayedDeals.map((deal) => (
          <section className={deal.isActive === true ? "is-live" : ""} key={String(deal.id)}>
            <div className="venue-contract-deal-title">
              <h3>{String(deal.dealTitle || "Club Deal")}</h3>
              <span className="venue-contract-deal-state">{deal.isActive === true ? "Live" : "Inactive"}</span>
            </div>
            <p>{String(deal.dealDescription || "No public description recorded.")}</p>
            <details className="venue-contract-deal-terms" open={reviewMode || undefined}>
              <summary>Guest terms</summary>
              <p>{String(deal.dealTerms || "Standard venue capacity, age, dress code, and house rules apply.")}</p>
              <small>Offer type: {dealTypeLabel(String(deal.offerType || "admission"))}</small>
            </details>
          </section>
        ))}
        {!deals.length ? (
          <section className="venue-contract-empty">
            <strong>No Club Deals yet</strong>
            <p>Request a deal below for MyDancr to review.</p>
          </section>
        ) : null}
      </div>

      {liveDeals.length && isVenuePublished && venueSlug ? (
        <Link
          className="venue-contract-preview"
          href={`/?city=${encodeURIComponent(venueCity || "Las Vegas")}&venue=${encodeURIComponent(venueSlug)}`}
        >
          View guest offer
        </Link>
      ) : liveDeals.length ? (
        <p className="venue-contract-preview-note">The Club Deal is recorded. The live preview becomes available after MyDancr publishes the venue page.</p>
      ) : null}

      <section className="venue-deal-request-center" aria-labelledby="venue-deal-request-heading">
        <div>
          <h3 id="venue-deal-request-heading">Manage deals</h3>
        </div>
        <div className="venue-deal-request-actions">
          {canRequestDeals ? (
            <button
              aria-controls="venue-deal-request-form"
              aria-expanded={isRequestOpen && requestType === "add"}
              data-action-state={requestStatusTone === "success" && requestType === "add" ? "success" : "idle"}
              disabled={isRequesting}
              type="button"
              onClick={() => {
                setIsRequestOpen((current) => requestType === "add" ? !current : true);
                setRequestType("add");
                setRequestStatus("");
                setRequestStatusTone("idle");
                setConfirmedRequestId("");
              }}
            >
              {requestStatusTone === "success" && requestType === "add" ? "✓ Request sent" : isRequestOpen && requestType === "add" ? "Close request" : "Request a new deal"}
            </button>
          ) : <small>Only venue owners and managers can request deal changes.</small>}
          {canRequestDeals && deals.length > 0 ? (
            <button type="button" aria-controls="venue-deal-request-form" aria-expanded={isRequestOpen && requestType === "remove"} data-action-state={requestStatusTone === "success" && requestType === "remove" ? "success" : "idle"} disabled={isRequesting} onClick={() => {
              setIsRequestOpen((current) => requestType === "remove" ? !current : true);
              setRequestType("remove");
              setTargetDealId(String(displayedDeals[0].id));
              setRequestStatus("");
              setRequestStatusTone("idle");
              setConfirmedRequestId("");
            }}>{requestStatusTone === "success" && requestType === "remove" ? "✓ Request sent" : isRequestOpen && requestType === "remove" ? "Close removal request" : "Request deal removal"}</button>
          ) : null}
        </div>
        {isRequestOpen && canRequestDeals ? (
          <form id="venue-deal-request-form" onSubmit={submitDealRequest}>
            {requestType === "remove" ? <>
              <label>Deal to remove
                <select value={targetDealId} required disabled={isRequesting} onChange={(event) => setTargetDealId(event.target.value)}>
                  <option value="">Choose a deal</option>
                  {displayedDeals.map((deal) => <option key={String(deal.id)} value={String(deal.id)}>{String(deal.dealTitle)}{deal.isActive === true ? "" : " (inactive)"}</option>)}
                </select>
              </label>
              <p>{liveDeals.length === 1 && String(liveDeals[0].id) === targetDealId ? "Removing your last active deal hides your venue and its dancer schedules from the site. Dancer profiles and TV videos stay live, and affiliations are saved. Your venue returns when a deal is active again." : "MyDancr reviews the removal request. Your current deals stay unchanged until approval."}</p>
            </> : <label>
              Requested offer
              <select value={requestedOfferKey} disabled={isRequesting} onChange={(event) => setRequestedOfferKey(event.target.value)}>
                {CLUB_DEAL_OFFER_PRESETS.map((offer) => <option value={offer.key} key={offer.key}>{offer.title}</option>)}
              </select>
            </label>}
            <label>
              Notes (optional)
              <textarea
                maxLength={1000}
                disabled={isRequesting}
                onChange={(event) => setRequestNotes(event.target.value)}
                placeholder={requestType === "remove" ? "Reason for removal or other details" : "Dates, hours, exclusions, or other details"}
                rows={4}
                value={requestNotes}
              />
            </label>
            <button className="primary" disabled={isRequesting} aria-busy={isRequesting} type="submit">{isRequesting ? "Sending…" : requestType === "remove" ? "Send removal request to MyDancr" : "Send request to MyDancr"}</button>
          </form>
        ) : null}
        {requestStatus ? (
          <div
            aria-live={requestStatusTone === "error" ? "assertive" : "polite"}
            className={`venue-deal-request-feedback is-${requestStatusTone}`}
            role={requestStatusTone === "error" ? "alert" : "status"}
          >
            <span aria-hidden="true">{requestStatusTone === "success" ? "✓" : requestStatusTone === "error" ? "!" : "…"}</span>
            <div>
              <strong>{requestStatusTone === "success" ? "Request sent successfully" : requestStatusTone === "error" ? "Request not sent" : "Sending request"}</strong>
              <p>{requestStatus}</p>
            </div>
          </div>
        ) : null}
        {dealRequests.length ? (
          <div className="venue-deal-request-history" aria-label="Club Deal request history">
            {dealRequests.map((dealRequest) => (
              <article className={String(dealRequest.id) === confirmedRequestId ? "is-confirmed" : ""} key={String(dealRequest.id)}>
                <div>
                  <strong>{dealRequest.requestType === "remove" ? "Remove: " : ""}{String(dealRequest.offerTitle || "Club Deal request")}</strong>
                  <small>{formatDashboardDate(String(dealRequest.createdAt || ""))}</small>
                </div>
                <span data-status={String(dealRequest.status || "pending")}>{dealRequestStatusLabel(String(dealRequest.status || "pending"))}</span>
                {dealRequest.requestNotes ? <p>{String(dealRequest.requestNotes)}</p> : null}
                {dealRequest.decisionNote ? <p><strong>MyDancr:</strong> {String(dealRequest.decisionNote)}</p> : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

    </article>
  );
}


function dealRequestStatusLabel(value: string) {
  if (value === "under_review") return "Under review";
  if (value === "approved") return "Approved & published";
  if (value === "rejected") return "Not approved";
  if (value === "withdrawn") return "Withdrawn";
  return "Sent to MyDancr";
}


function readOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}




function formatRelativeDashboardTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const difference = Date.now() - timestamp;
  if (difference < 45_000) return "just now";
  const minutes = Math.max(1, Math.round(Math.abs(difference) / 60_000));
  if (minutes < 60) return difference >= 0 ? `${minutes} min ago` : `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    const unit = hours === 1 ? "hr" : "hrs";
    return difference >= 0 ? `${hours} ${unit} ago` : `in ${hours} ${unit}`;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(timestamp));
}


function formatDashboardTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "shift end";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}
