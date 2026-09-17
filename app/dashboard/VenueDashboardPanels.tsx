"use client";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
const PickupDashboardPanel = dynamic(() => import("./PickupDashboardPanel"));
import { CLUB_DEAL_OFFER_PRESETS } from "@/src/lib/dancr/club-deal-presets";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import { type VenueDancerAffiliation } from "@/src/lib/dancr/venue-roster";
import { requestDashboardJson, type DashboardSessionAccount } from "./dashboard-session";
import { PUBLIC_DISCOVERY_REFRESH_KEY, formatVenueReviewHours, Metric, DashboardSection, InfoPanel, NotificationPanel, SupportInboxPanel, AccountControlsPanel, formatDashboardDate } from "./DashboardShared";
import type { VenueWorkspace, LoadState } from "./dashboard-types";
const VenueNfcTagPanel = dynamic(() => import("./VenueNfcTagPanel"));

import VenueValueAnalytics from "./VenueValueAnalytics";
import type { VenueValueReport } from "@/src/lib/dancr/venue-analytics";

const VenueTeamPanel = dynamic(() => import("./VenueTeamPanel"));

const VenueTvPanel = dynamic(() => import("./VenueTvPanel"));


function notifyPublicVenuePublication() {
  const revision = String(Date.now());
  // Refresh when this tab returns to discovery, including browser Back.
  try { window.sessionStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, revision); } catch { /* Storage may be unavailable. */ }
  // Other open discovery tabs receive this storage event immediately.
  try { window.localStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, revision); } catch { /* Focus and periodic refresh still work. */ }
}


function venueWorkspaceForSection(sectionId: string): VenueWorkspace | null {
  if (sectionId === "venue-pickups") return "tonight";
  if (sectionId === "venue-overview") return "business";
  if (["venue-working-now", "venue-dancer-roster", "venue-club-deals", "venue-deal-contract-ledger", "venue-tv", "venue-team", "venue-account", "venue-support"].includes(sectionId)) return "venue";
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
  supportThreads: Array<Record<string, unknown>>;
  analyticsPeriod: "tonight" | "7d" | "30d";
  isRefreshing: boolean;
  refreshStatus: string;
  onAnalyticsPeriodChange: (period: "tonight" | "7d" | "30d") => void;
  onRefresh: () => void;
  onAccessRemoved: (affiliation: VenueDancerAffiliation) => void;
  onProfileChange: (profile: Record<string, unknown>) => void;
  onPublicationChange: (publication: Record<string, unknown>) => void;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
}) {
  const [publicationStatus, setPublicationStatus] = useState("");
  const [isPublishingVenue, setIsPublishingVenue] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [notificationRevision, setNotificationRevision] = useState(0);
  const connectedVenueId = profile?.id;
  useEffect(() => {
    if (connectedVenueId) offerPushNotifications("venue-dashboard");
  }, [connectedVenueId]);
  const [activeWorkspace, setActiveWorkspace] = useState<VenueWorkspace>(() => {
    const sectionId = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
    return venueWorkspaceForSection(sectionId) || initialVenueWorkspace(profile?.isActive === true);
  });
  const [rosterWorkingOnly, setRosterWorkingOnly] = useState(() => typeof window !== "undefined" && window.location.hash === "#venue-working-now");
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
        offerPushNotifications("venue-live");
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

  function moveVenueWorkspaceFocus(event: React.KeyboardEvent<HTMLButtonElement>, workspace: VenueWorkspace) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const workspaces: VenueWorkspace[] = ["tonight", "business", "venue"];
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
    setActiveWorkspace(venueWorkspaceForSection(sectionId) || activeWorkspace);
    window.history.replaceState(null, "", `#${sectionId}`);
    window.setTimeout(() => {
      const section = document.getElementById(targetSectionId) as HTMLDetailsElement | null;
      if (!section) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      section.open = true;
      section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      window.setTimeout(() => section.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
    }, 50);
  }

  const venueName = String(profile?.name || "Your venue");
  const venueCity = String(profile?.city || "your city");
  const venueSlug = String(profile?.slug || "");
  const dashboardDeals = venueDeals.length ? venueDeals : deal ? [deal] : [];
  const activeDealCount = dashboardDeals.filter((venueDeal) => venueDeal.isActive === true).length;
  const venueReviewDeal = dashboardDeals.find((venueDeal) => venueDeal.isActive === true) || dashboardDeals[0];
  const venueReviewHours = formatVenueReviewHours(profile?.opensAt, profile?.closesAt);
  const venueReviewLocation = [profile?.city, profile?.state].map((value) => String(value || "").trim()).filter(Boolean).join(", ") || "Location not provided";
  const venueReviewAddress = String(profile?.address || "").trim() || venueReviewLocation;
  const venueReviewInitials = venueName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase() || "V";
  const upcomingShiftCount = Number(analytics?.upcomingShiftCount || 0);
  const activeAffiliations = initialAffiliations.filter((affiliation) => affiliation.status === "active");
  const nfcAuthorizedDancerCount = activeAffiliations.length;
  const liveDealSummary = activeDealCount
    ? `${activeDealCount} live Club ${activeDealCount === 1 ? "Deal" : "Deals"}`
    : "No live Club Deals";
  const permissions = Array.isArray(venueAccess?.permissions) ? venueAccess.permissions : [];
  const venueRole = String(venueAccess?.role || "");
  const canManageRoster = permissions.includes("manage_roster");
  const canRequestNfcSupport = permissions.includes("request_nfc_support");
  const canViewTeam = permissions.includes("view_team");
  const isApprovedPage = profile?.isActive === true;
  const isPublished = isApprovedPage && activeDealCount > 0;
  const isPausedForDeals = isApprovedPage && !isPublished;
  const pageReviewStatus = String(profile?.pageReviewStatus || (isPublished ? "published" : "admin_draft"));
  const isAwaitingVenueReview = !isPublished && pageReviewStatus === "venue_review";
  const venueCustomerPreviewHref = isAwaitingVenueReview && venueSlug
    ? `/?city=${encodeURIComponent(venueCity)}&venue=${encodeURIComponent(venueSlug)}&venue_preview=1`
    : "";
  return (
    <>
      <section className="venue-command-panel" aria-labelledby="venue-command-heading">
        <div className="venue-command-status">
          <span className={isPublished ? "venue-live-pill" : "venue-live-pill is-draft"}>{isPublished ? "LIVE" : isPausedForDeals ? "HIDDEN" : "PRIVATE DRAFT"}</span>
          <div>
            <h2 id="venue-command-heading">{venueName}</h2>
            {!isPublished && <p>{isPausedForDeals ? "Your venue is hidden until it has an active Club Deal. Your dancer roster is saved." : isAwaitingVenueReview ? "Ready to review in Manage venue." : pageReviewStatus === "changes_requested" ? "Changes in progress. MyDancr will notify you when your page is ready." : "MyDancr prepares the venue page. Your team reviews it and approves it to make it live."}</p>}
          </div>
          <div className="venue-refresh-control">
            <small>{refreshedAt ? `Updated ${formatRelativeDashboardTime(refreshedAt)}` : "Live data loading"}</small>
            <button type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
        {(venueRole === "owner" || venueRole === "manager") && <div className="venue-command-links">
          <Link className="primary-link" href="/pickups">Pickup Requests →</Link>
        </div>}
      </section>

      <nav className="venue-workspace-tabs" aria-label="Venue workspace" role="tablist">
        {([
          ["tonight", "Pickup requests"],
          ["business", "Results"],
          ["venue", "Manage venue"],
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
            <strong>{label}</strong>
          </button>
        ))}
      </nav>
      {refreshStatus ? <small className="venue-refresh-status" role="status">{refreshStatus}</small> : null}

      <section
        className="venue-dashboard-section"
        hidden={activeWorkspace !== "tonight"}
        id="venue-workspace-tonight"
        role="tabpanel"
        aria-labelledby="venue-workspace-tonight-tab"
      >
        <section className="info-panel venue-dashboard-section" id="venue-pickups" aria-labelledby="venue-pickups-heading">
          <h2 id="venue-pickups-heading">Pickup requests</h2>
          {(venueRole === "owner" || venueRole === "manager")
            ? <PickupDashboardPanel key={`${account?.id}:${connectedVenueId}`} refreshKey={refreshedAt} />
            : <p>Pickup requests are available to your venue owner and managers.</p>}
        </section>
      </section>

      <section
        aria-labelledby="venue-workspace-business-tab"
        className="venue-dashboard-section venue-results-panel"
        hidden={activeWorkspace !== "business"}
        id="venue-workspace-business"
        role="tabpanel"
      >
        <section className="info-panel" id="venue-overview" aria-labelledby="venue-results-heading">
          <h2 id="venue-results-heading">Results</h2>
          <div className="venue-analytics-period" role="group" aria-label="Analytics period">
            {(["tonight", "7d", "30d"] as const).map((period) => (
              <button className={analyticsPeriod === period ? "active" : ""} aria-pressed={analyticsPeriod === period} type="button" key={period} onClick={() => onAnalyticsPeriodChange(period)}>
                {period === "tonight" ? "Tonight" : period === "7d" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
          {analytics?.valueReport ? <VenueValueAnalytics
            report={analytics.valueReport as VenueValueReport}
            periodStart={String(analytics.periodStart)}
            periodEnd={String(analytics.periodEnd)}
            timezone={String(profile?.timezone || "America/Los_Angeles")}
            totalFollowers={Number(analytics.totalFollowers || 0)}
            conversion={readOptionalNumber(analytics.claimToAdmissionPercent)}
          /> : <p role="status">Analytics are unavailable. Refresh to try again.</p>}
        </section>
      </section>

      <section className="venue-manage-panel venue-dashboard-section" hidden={activeWorkspace !== "venue"} id="venue-workspace-venue" role="tabpanel" aria-labelledby="venue-workspace-venue-tab">

        <section
          aria-label="Venue activity"
          className="venue-command-primary venue-workspace-summary"
          hidden={activeWorkspace !== "venue"}
        >
            <span className="eyebrow">Tonight at a glance</span>
            <strong>{liveDealSummary}</strong>
            <p>{workingNow.length} working now · {upcomingShiftCount} upcoming {upcomingShiftCount === 1 ? "shift" : "shifts"}</p>
            <div className="venue-command-links">
              <a className="primary-link venue-current-deals-link" href="#venue-club-deals" onClick={(event) => openVenueSection(event, "venue-club-deals")}>
                {activeDealCount ? `View ${activeDealCount} current Club ${activeDealCount === 1 ? "Deal" : "Deals"}` : "View Club Deal status"}
              </a>
              <a className={`primary-link venue-working-now-link${workingNow.length ? " is-live" : ""}`} href="#venue-working-now" onClick={(event) => openVenueSection(event, "venue-working-now")}>
                {workingNow.length ? `View ${workingNow.length} working now` : "Open working-now roster"}
              </a>
            </div>
        </section>

        <section
          aria-labelledby="venue-publication-heading"
          className={`venue-publication-panel${isPublished ? " is-published" : ""}`}
          hidden={activeWorkspace !== "venue"}
        >
          <div>
            <span className="eyebrow">{isPublished ? "Public venue" : "Venue page review"}</span>
            <h2 id="venue-publication-heading">
              {isPublished
                ? "Your venue is live on MyDancr"
                : isPausedForDeals ? "Your venue is hidden until a deal is active"
                : pageReviewStatus === "venue_review"
                  ? "Review your prepared venue page"
                  : pageReviewStatus === "changes_requested"
                    ? "MyDancr is working on your changes"
                    : pageReviewStatus === "venue_approved"
                      ? "Approved page ready to finish"
                      : "MyDancr is preparing your venue page"}
            </h2>
            <p>
              {isPublished
                ? "Guests can find this venue, its current Club Deals, and affiliated dancers."
                : isPausedForDeals ? "Your page approval and dancer affiliations are saved. Your venue and its dancer schedules return automatically when an active Club Deal is available. Dancer profiles and TV videos stay live."
                : pageReviewStatus === "venue_review"
                  ? "Review the official venue information and commercial terms below. Preview and approval controls are at the bottom."
                  : pageReviewStatus === "changes_requested"
                    ? "Your requested changes were sent. MyDancr will update the page and return it for another review."
                    : pageReviewStatus === "venue_approved"
                      ? "This page was approved under the previous workflow. MyDancr is completing its publication."
                      : "MyDancr is completing your private venue page. You will be notified when it is ready to review."}
            </p>
          </div>
          {isPublished && venueSlug ? (
            <div className="venue-publication-actions">
              <Link href={`/venues/${encodeURIComponent(venueSlug)}`}>Open live venue page</Link>
            </div>
          ) : null}
          {isAwaitingVenueReview ? (
            <section className="venue-review-package" aria-label="Venue information and commercial approval package">
              <header className="venue-review-package-heading">
                <span className="venue-review-logo" aria-label={`${venueName} official logo`}>
                  {profile?.logoImageUrl ? (
                    <img
                      alt={`${venueName} official logo`}
                      className="venue-review-logo-image"
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        const ratio = image.naturalWidth > 0 && image.naturalHeight > 0
                          ? image.naturalWidth / image.naturalHeight
                          : 0;
                        image.classList.toggle("is-compact-logo-source", ratio >= 0.78 && ratio <= 1.28);
                      }}
                      src={String(profile.logoImageUrl)}
                      srcSet={profile.logoImageSrcSet ? String(profile.logoImageSrcSet) : undefined}
                      sizes="72px"
                    />
                  ) : venueReviewInitials}
                </span>
                <span>
                  <span className="eyebrow">Venue approval package</span>
                  <strong>{venueName}</strong>
                  <small>Review the facts and agreed terms. MyDancr controls how the venue card and customer page are presented.</small>
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
                  <strong>Club Deal and subscription</strong>
                  <small>These are read-only. Request a correction before approving if they do not match the agreement.</small>
                </span>
                <dl>
                  <div><dt>Customer offer</dt><dd>{String(venueReviewDeal?.dealTitle || "Club Deal not provided")}</dd></div>
                  <div><dt>Billing model</dt><dd>Venue subscription · no per-customer charge</dd></div>
                  <div><dt>Guest terms</dt><dd>{String(venueReviewDeal?.dealTerms || "Standard venue capacity, age, dress code, and house rules apply.")}</dd></div>
                </dl>
              </div>
            </section>
          ) : null}
          {isAwaitingVenueReview ? (
            <div className="venue-review-request">
              <label htmlFor="venue-page-review-notes">Need changes?</label>
              <textarea
                id="venue-page-review-notes"
                maxLength={1000}
                placeholder="Tell MyDancr exactly what should be corrected before you approve the page."
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
              />
              <button className="secondary" type="button" disabled={isPublishingVenue || reviewNotes.trim().length < 10} onClick={() => void submitVenueReview("changes_requested")}>Request changes</button>
            </div>
          ) : null}
          {isAwaitingVenueReview ? (
            <section className="venue-review-completion" aria-labelledby="venue-review-completion-heading">
              <span className="eyebrow">Final review step</span>
              <h3 id="venue-review-completion-heading">Preview, then approve</h3>
              <p>Preview the customer experience using the information above. If everything is correct, approve the venue page to make it live.</p>
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

        <section className="venue-dashboard-metrics venue-tonight-metrics" aria-label="Tonight at a glance" hidden={activeWorkspace !== "venue"}>
          <Metric label="Working now" value={String(workingNow.length)} />
          <Metric label="Upcoming shifts" value={String(upcomingShiftCount)} />
          <Metric label="Live Club Deals" value={String(activeDealCount)} />
          <Metric label="Verified roster" value={String(nfcAuthorizedDancerCount)} />
        </section>

        <DashboardSection
          badge={`${activeDealCount} live · ${dashboardDeals.length} total`}
          description="Review every live or inactive deal and its guest terms."
          eyebrow="Current offers"
          hidden={activeWorkspace !== "venue"}
          id="venue-club-deals"
          icon={<VenueDashboardIcon section="deals" />}
          toggleAffordance="chevron"
          title="Current Club Deals"
        >
          <VenueDealReadOnlyPanel
            deals={dashboardDeals}
            dealRequests={dealRequests}
            isVenuePublished={isPublished}
            venueCity={venueCity}
            venueSlug={venueSlug}
            canRequestDeals={permissions.includes("request_deals") || venueRole === "owner" || venueRole === "manager"}
            onDealRequestsChange={onDealRequestsChange}
          />
        </DashboardSection>

        <DashboardSection
          description="Search your approved dancer roster, view profiles, see who's working now, and remove venue access."
          eyebrow="Venue roster"
          hidden={activeWorkspace !== "venue"}
          id="venue-dancer-roster"
          icon={<VenueDashboardIcon section="roster" />}
          toggleAffordance="chevron"
          title="Affiliated dancers"
          badge={`${nfcAuthorizedDancerCount} affiliated`}
        >
          <VenueNfcTagPanel
            initialAffiliations={initialAffiliations}
            workingNow={workingNow}
            workingOnly={rosterWorkingOnly}
            onWorkingOnlyChange={setRosterWorkingOnly}
            onAccessRemoved={onAccessRemoved}
            canManageRoster={canManageRoster}
            canRequestSupport={canRequestNfcSupport}
          />
        </DashboardSection>

        <VenueTvPanel
          city={venueCity}
          hidden={activeWorkspace !== "venue"}
          venueId={String(profile?.id || "")}
        />

        {canViewTeam ? (
          <DashboardSection
            description="Manage staff access and review changes."
            eyebrow="Security"
            hidden={activeWorkspace !== "venue"}
            id="venue-team"
            icon={<VenueDashboardIcon section="team" />}
            toggleAffordance="chevron"
            title="Team & activity"
          >
            <VenueTeamPanel initialAccess={venueAccess as { role: "owner" | "manager" | "staff"; permissions: string[] } | null} />
          </DashboardSection>
        ) : null}

        <DashboardSection
          description="Notifications, support messages, and account controls."
          eyebrow="Venue workspace"
          hidden={activeWorkspace !== "venue"}
          id="venue-account"
          icon={<VenueDashboardIcon section="account" />}
          toggleAffordance="chevron"
          title="Account & support"
        >
          <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
            <InfoPanel title="Account">
              <Metric label="Status" value={String(account?.accountState || "active")} />
              <Metric label="Email" value={String(account?.email || "Private")} />
              <Metric label="Role" value={String(account?.role || "venue")} />
            </InfoPanel>
            <NotificationPanel refreshKey={notificationRevision} />
            <SupportInboxPanel initialThreads={supportThreads} panelId="venue-support" />
            <AccountControlsPanel
              accountRole="venue"
              accountState={String(account?.accountState || "active")}
              venueAccessRole={venueRole}
              venueName={venueName}
            />
          </div>
        </DashboardSection>
      </section>

    </>
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
  canRequestDeals,
  onDealRequestsChange,
}: {
  deals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  isVenuePublished: boolean;
  venueCity: string;
  venueSlug: string;
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
    <article className="info-panel venue-deal-readonly" id="venue-deal-contract-ledger" tabIndex={-1}>
      <header className="venue-deal-readonly-heading">
        <div>
          <span className="eyebrow">Current Club Deals · MyDancr managed</span>
          <h2>Your Club Deals</h2>
          <p>These are the official offers currently attached to your venue. Live deals appear first and are marked in green. Request changes anytime.</p>
        </div>
        <strong className={liveDeals.length ? "deal-state active" : "deal-state"}>
          {liveDeals.length ? `${liveDeals.length} live` : "No live deals"}
        </strong>
      </header>

      <section className="venue-contract-summary" aria-label="Admission passes">
        <div>
          <span>Redemption status</span>
          <strong>{liveDeals.length ? "Enabled" : "Not active"}</strong>
          <small>Scan the guest’s admission QR with your phone camera while signed in to this venue. Verify arrival eligibility, then select “Admit guest & redeem pass.” New passes record visits without a per-guest charge.</small>
        </div>
      </section>

      <div className="venue-contract-deal-list" aria-label="All Club Deals">
        {displayedDeals.map((deal) => (
          <section className={deal.isActive === true ? "is-live" : ""} key={String(deal.id)}>
            <div className="venue-contract-deal-title">
              <span>{deal.isActive === true ? "Live Club Deal" : "Not published"}</span>
              <strong>{String(deal.dealTitle || "Club Deal")}</strong>
            </div>
            <p>{String(deal.dealDescription || "No public description recorded.")}</p>
            <dl>
              <div><dt>Offer type</dt><dd>{dealTypeLabel(String(deal.offerType || "admission"))}</dd></div>
              <div><dt>Redemption status</dt><dd>{deal.isActive === true ? "Enabled" : "Not active"}</dd></div>
            </dl>
            <div className="venue-contract-deal-terms">
              <span>Guest terms</span>
              <p>{String(deal.dealTerms || "Standard venue capacity, age, dress code, and house rules apply.")}</p>
            </div>
          </section>
        ))}
        {!deals.length ? (
          <section className="venue-contract-empty">
            <strong>MyDancr has not published a Club Deal yet.</strong>
            <p>After MyDancr publishes your deal, the offer and its terms will appear here automatically.</p>
          </section>
        ) : null}
      </div>

      {liveDeals.length && isVenuePublished && venueSlug ? (
        <Link
          className="venue-contract-preview"
          href={`/?city=${encodeURIComponent(venueCity || "Las Vegas")}&venue=${encodeURIComponent(venueSlug)}`}
        >
          Open live Club Deals
        </Link>
      ) : liveDeals.length ? (
        <p className="venue-contract-preview-note">The Club Deal is recorded. The live preview becomes available after MyDancr publishes the venue page.</p>
      ) : null}

      <section className="venue-deal-request-center" aria-labelledby="venue-deal-request-heading">
        <div>
          <span className="eyebrow">Deal request</span>
          <h3 id="venue-deal-request-heading">Request a deal change</h3>
          <p>Ask MyDancr to add or remove a Club Deal.</p>
        </div>
        {canRequestDeals ? (
          <button
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
            {isRequestOpen && requestType === "add" ? "Close request" : "Request a new deal"}
          </button>
        ) : <small>Only venue owners and managers can request deal changes.</small>}
        {canRequestDeals && deals.length > 0 ? (
          <button type="button" disabled={isRequesting} onClick={() => {
            setIsRequestOpen((current) => requestType === "remove" ? !current : true);
            setRequestType("remove");
            setTargetDealId(String(displayedDeals[0].id));
            setRequestStatus("");
            setRequestStatusTone("idle");
            setConfirmedRequestId("");
          }}>{isRequestOpen && requestType === "remove" ? "Close removal request" : "Request deal removal"}</button>
        ) : null}
        {isRequestOpen && canRequestDeals ? (
          <form onSubmit={submitDealRequest}>
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
              <select value={requestedOfferKey} onChange={(event) => setRequestedOfferKey(event.target.value)}>
                {CLUB_DEAL_OFFER_PRESETS.map((offer) => <option value={offer.key} key={offer.key}>{offer.title}</option>)}
              </select>
            </label>}
            <label>
              Notes (optional)
              <textarea
                maxLength={1000}
                onChange={(event) => setRequestNotes(event.target.value)}
                placeholder={requestType === "remove" ? "Reason for removal or other details" : "Dates, hours, exclusions, or other details"}
                rows={4}
                value={requestNotes}
              />
            </label>
            <button className="primary" disabled={isRequesting} type="submit">{isRequesting ? "Sending…" : requestType === "remove" ? "Send removal request to MyDancr" : "Send request to MyDancr"}</button>
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
