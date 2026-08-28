"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";
import Link from "next/link";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import { VenueQrUnavailable } from "@/app/components/VenueQrCode";
import { DancerProfileActionsPreview } from "@/app/dancers/[slug]/DancerProfileActions";
import { DancerPhotoCarousel } from "@/app/dancers/[slug]/DancerPhotoCarousel";
import { SocialLinks, SocialPlatformIcon } from "@/app/dancers/[slug]/SocialLinks";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { MAX_DANCER_PROFILE_PHOTOS } from "@/src/lib/dancr/media-limits";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import { isCurrentLocationVerification } from "@/src/lib/dancr/geofence";
import { isFictionalVenueTravelPreviewOnly } from "@/src/lib/dancr/venue-branding";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import {
  CLUB_DEAL_OFFER_PRESETS,
  clubDealOfferPresetForTitle,
  defaultClubDealOfferPreset,
} from "@/src/lib/dancr/club-deal-presets";
import DancerNfcPanel from "./DancerNfcPanel";
import DancerTvStudio from "./DancerTvStudio";
import DancerShiftManager from "./DancerShiftManager";
import {
  DANCER_PROFILE_VIDEOS_CHANGED_EVENT,
  primeVideoPreviewFrame,
} from "./dancer-profile-media-sync";
import VenueNfcTagPanel from "./VenueNfcTagPanel";
import VenueTeamPanel from "./VenueTeamPanel";
import VenueTvPanel from "./VenueTvPanel";
import {
  DASHBOARD_SESSION_KEY as SESSION_KEY,
  clearDashboardSession,
  dashboardLoadErrorMessage,
  persistDashboardSession,
  readSession,
  requestAccountJson,
  requestCustomerProfileJson,
  requestDancerAvatarJson,
  requestDancerFinanceJson,
  requestDancerFinanceStatement,
  requestDancerPhotosJson,
  requestDancerProfileJson,
  requestDancerProfileVisibilityJson,
  requestDancerShiftCheckInJson,
  requestDancerShiftsJson,
  requestDancerTvVideosJson,
  requestDashboardJson,
  requestOptionalDashboardJson,
  requestVenueDashboardJson,
  requestVenueFinanceStatement,
  storedSessionAccount,
  storedSessionIsFresh,
  type DashboardSessionAccount,
} from "./dashboard-session";

type DashboardRole = "customer" | "dancer" | "venue";
type CustomerDashboardSection = "offers" | "saved";

const PUBLIC_DISCOVERY_REFRESH_KEY = "mydancrPublicDiscoveryRefreshV1";

type SavedImageSummary = {
  imageUrl?: string | null;
  imageSrcSet?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
};

type SavedVenueSummary = SavedImageSummary & {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type SavedShiftSummary = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone?: string | null;
  status: string;
  locationStatus?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  venue: SavedVenueSummary;
};

type SavedDancerSummary = SavedImageSummary & {
  id?: string | null;
  slug?: string | null;
  stageName?: string | null;
  city?: string | null;
  nextShift?: SavedShiftSummary | null;
};

type CustomerGoingSignal = {
  shiftId: string;
  createdAt?: string | null;
  shift?: (SavedShiftSummary & { dancer: SavedDancerSummary }) | null;
};

type CustomerSavedState = {
  follows?: Array<{
    dancerId?: string | null;
    notificationsEnabled?: boolean;
    dancer?: SavedDancerSummary | null;
  }>;
  favorites?: Array<{
    dancerId?: string | null;
    dancer?: SavedDancerSummary | null;
  }>;
  venueFollows?: Array<{
    venueId?: string | null;
    notificationsEnabled?: boolean;
    venue?: SavedVenueSummary | null;
  }>;
  goingSignals?: CustomerGoingSignal[];
  dealRedemptions?: Array<{
    id: string;
    redemptionToken: string;
    sourceType: string;
    status: string;
    generatedAt: string;
    expiresAt: string;
    redeemedAt?: string | null;
    venue?: { name?: string; slug?: string } | null;
    deal?: { title?: string; terms?: string | null } | null;
  }>;
};

type LoadState = {
  account?: DashboardSessionAccount | null;
  profile?: Record<string, unknown> | null;
  saved?: CustomerSavedState | null;
  analytics?: Record<string, unknown> | null;
  deals?: Record<string, unknown> | null;
  reviews?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  weeklyReport?: Record<string, unknown> | null;
  rankingEvents?: Array<Record<string, unknown>>;
  workingNow?: Array<Record<string, unknown>>;
  deal?: Record<string, unknown> | null;
  venueDeals?: Array<Record<string, unknown>>;
  dealRequests?: Array<Record<string, unknown>>;
  dealRevenue?: Record<string, unknown> | null;
  finance?: Record<string, unknown> | null;
  affiliations?: Array<Record<string, unknown>>;
  nfc?: Record<string, unknown> | null;
  venueAccess?: { role?: string; permissions?: string[] } | null;
  referralFee?: Record<string, unknown> | null;
  agentAccess?: { active?: boolean } | null;
  publication?: Record<string, unknown> | null;
  refreshedAt?: string | null;
  error?: string;
};

export default function DashboardClient({
  role,
  initialSection,
}: {
  role: DashboardRole;
  initialSection?: CustomerDashboardSection;
}) {
  const [state, setState] = useState<LoadState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"tonight" | "7d" | "30d">("30d");
  const [isVenueRefreshing, setIsVenueRefreshing] = useState(false);
  const [venueRefreshStatus, setVenueRefreshStatus] = useState("");

  const retryDashboard = useCallback(() => {
    setState((current) => ({ account: current.account }));
    setIsLoading(true);
    setLoadAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = readSession();
      if (!session?.accessToken) {
        setState({ error: "Sign in to open this dashboard." });
        setIsLoading(false);
        return;
      }

      const cachedAccount = storedSessionAccount(session);
      if (cachedAccount) {
        setState((current) => ({ ...current, account: cachedAccount }));
      }

      const loadDashboardPanels = async () => {
        if (role === "dancer") {
          // This request finalizes a saved eligible NFC enrollment. Load the
          // profile afterward so onboarding never renders from a pre-activation
          // profile snapshot while the NFC state is already complete.
          const secondary = await requestOptionalDashboardJson("/api/dancer/dashboard", {});
          const [profile, support, reviews, weeklyReport, rankingEvents] = await Promise.all([
            requestOptionalDashboardJson("/api/dancer/profile", { profile: null }),
            requestOptionalDashboardJson("/api/support", { threads: [] }),
            requestOptionalDashboardJson("/api/dancer/reviews", { reviews: [] }),
            requestOptionalDashboardJson("/api/dancer/weekly-report", { report: null }),
            requestOptionalDashboardJson("/api/dancer/ranking-events", { events: [] }),
          ]);
          return [profile, secondary, support, reviews, weeklyReport, rankingEvents];
        }

        return Promise.all([
          requestOptionalDashboardJson(role === "venue" ? "/api/venue/profile" : "/api/customer/profile", { profile: null }),
          requestOptionalDashboardJson(role === "venue" ? "/api/venue/dashboard?period=30d" : "/api/customer/saved", {}),
          requestOptionalDashboardJson("/api/support", { threads: [] }),
          null,
          null,
          null,
        ]);
      };

      try {
        let account;
        let panels;
        let agentAccess;
        if (storedSessionIsFresh(session)) {
          [account, panels, agentAccess] = await Promise.all([
            requestAccountJson({
              cache: "no-store",
              fallbackMessage: "Unable to load account.",
            }),
            loadDashboardPanels(),
            requestOptionalDashboardJson(
              "/api/agent/commissions?access=1",
              { access: { active: false } },
            ),
          ]);
        } else {
          account = await requestAccountJson({
            cache: "no-store",
            fallbackMessage: "Unable to load account.",
          });
          [panels, agentAccess] = await Promise.all([
            loadDashboardPanels(),
            requestOptionalDashboardJson(
              "/api/agent/commissions?access=1",
              { access: { active: false } },
            ),
          ]);
        }
        const [profile, secondary, support, reviews, weeklyReport, rankingEvents] = panels;

        if (!cancelled) {
          setState({
            account: account.account,
            profile: profile.profile,
            saved: secondary.saved || null,
            analytics: secondary.analytics || null,
            deals: secondary.deals || null,
            reviews: reviews?.reviews || [],
            supportThreads: support.threads || [],
            weeklyReport: weeklyReport?.report || null,
            rankingEvents: rankingEvents?.events || [],
            workingNow: secondary.workingNow || [],
            deal: secondary.deal || null,
            venueDeals: Array.isArray(secondary.deals) ? secondary.deals : [],
            dealRequests: Array.isArray(secondary.dealRequests) ? secondary.dealRequests : [],
            dealRevenue: secondary.dealRevenue || null,
            finance: secondary.finance || null,
            affiliations: secondary.affiliations || [],
            nfc: secondary.nfc || null,
            venueAccess: secondary.venueAccess || profile.venueAccess || null,
            referralFee: secondary.referralFee || null,
            agentAccess: agentAccess?.access || null,
            publication: secondary.publication || null,
            refreshedAt: secondary.refreshedAt || null,
          });
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setState({ error: dashboardLoadErrorMessage(error) });
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, role]);

  useEffect(() => {
    const leaveDeletedSessionDashboard = () => {
      if (!readSession()?.accessToken) window.location.replace("/");
    };
    const handleSessionStorage = (event: StorageEvent) => {
      if (event.key === SESSION_KEY && !event.newValue) leaveDeletedSessionDashboard();
    };
    leaveDeletedSessionDashboard();
    window.addEventListener("pageshow", leaveDeletedSessionDashboard);
    window.addEventListener("storage", handleSessionStorage);
    return () => {
      window.removeEventListener("pageshow", leaveDeletedSessionDashboard);
      window.removeEventListener("storage", handleSessionStorage);
    };
  }, []);

  const refreshVenueDashboard = useCallback(async (showStatus = false) => {
    if (role !== "venue") return;
    if (!readSession()?.accessToken) return;
    if (showStatus) {
      setIsVenueRefreshing(true);
      setVenueRefreshStatus("Refreshing live venue data…");
    }
    try {
      const secondary = await requestVenueDashboardJson(analyticsPeriod, {
        cache: "no-store",
        fallbackMessage: "Unable to refresh live venue data.",
      });
      setState((current) => ({
        ...current,
        profile: secondary.profile || current.profile,
        analytics: secondary.analytics || current.analytics,
        workingNow: secondary.workingNow || [],
        deal: secondary.deal || null,
        venueDeals: Array.isArray(secondary.deals) ? secondary.deals : current.venueDeals || [],
        dealRequests: Array.isArray(secondary.dealRequests) ? secondary.dealRequests : current.dealRequests || [],
        dealRevenue: secondary.dealRevenue || current.dealRevenue,
        finance: secondary.finance === null ? null : secondary.finance || current.finance,
        affiliations: secondary.affiliations || [],
        venueAccess: secondary.venueAccess || current.venueAccess,
        referralFee: secondary.referralFee || current.referralFee,
        publication: secondary.publication || current.publication,
        refreshedAt: secondary.refreshedAt || new Date().toISOString(),
      }));
      if (showStatus) setVenueRefreshStatus("Live venue data is up to date.");
    } catch (error) {
      if (showStatus) setVenueRefreshStatus(error instanceof Error ? error.message : "Unable to refresh live venue data.");
    } finally {
      if (showStatus) setIsVenueRefreshing(false);
    }
  }, [analyticsPeriod, role]);

  useEffect(() => {
    if (role !== "venue" || isLoading || state.error) return;
    void refreshVenueDashboard(false);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refreshVenueDashboard(false); };
    const timer = window.setInterval(refreshWhenVisible, 45_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [analyticsPeriod, isLoading, refreshVenueDashboard, role, state.error]);

  useEffect(() => {
    if (isLoading || state.error) return;
    const initialSectionId = role === "customer" && initialSection
      ? initialSection === "offers" ? "customer-offers" : "customer-saved"
      : "";
    const hashSectionId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    const sectionId = initialSectionId || hashSectionId;
    if (!sectionId) return;
    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById(sectionId);
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      section?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection, isLoading, role, state.error]);

  function updateProfile(profile: Record<string, unknown> | null | undefined) {
    if (!profile) return;
    setState((current) => ({ ...current, profile }));
  }

  function updateSaved(update: (saved: CustomerSavedState) => CustomerSavedState) {
    setState((current) => ({ ...current, saved: update(current.saved || {}) }));
  }

  const title = useMemo(() => {
    if (role === "dancer") return "Complete your profile";
    if (role === "venue") return "Venue dashboard";
    return "Guest dashboard";
  }, [role]);

  const accountDisplayName = String(state.account?.displayName || "").trim();
  const profileDisplayName = String(dashboardName(state.profile, role) || "").trim();
  const resolvedDisplayName = role === "dancer"
    ? profileDisplayName
    : accountDisplayName || profileDisplayName;
  const displayName = resolvedDisplayName || (role === "dancer" ? "Complete your profile" : "Dancr");
  const dashboardCloseHref = homeDiscoveryHref(
    role === "venue" ? "venues" : role === "dancer" ? "dancers" : "tonight",
  );
  const dashboardEyebrow =
    role === "customer" ? "Guest dashboard" : role === "venue" ? "Venue dashboard" : "Dancer dashboard";
  const dashboardHeading = isLoading
    ? (role === "dancer" ? profileDisplayName || title : resolvedDisplayName || title)
    : displayName;
  const dashboardDescription = state.error || "";
  const dancerProfileStatus = role === "dancer"
    ? effectiveDancerProfileStatus(state.profile, state.account?.accountState)
    : "";
  const dancerProfileIsLive = dancerProfileStatus === "approved"
    && state.profile?.is_public !== false
    && state.profile?.isPublic !== false;

  return (
    <main className={`dashboard-shell dashboard-shell-${role}`}>
      <DashboardStyles />
      <section className={`dashboard-head dashboard-head-${role}`} aria-busy={isLoading || undefined}>
        <div className="dashboard-head-row">
          <div className="dashboard-head-copy">
            <span className="eyebrow">{dashboardEyebrow}</span>
            <div className="dashboard-head-title-row">
              <h1>{dashboardHeading}</h1>
              {dancerProfileIsLive ? <span className="dashboard-live-status"><i aria-hidden="true" /> Public</span> : null}
            </div>
            {dashboardDescription ? <p>{dashboardDescription}</p> : null}
          </div>
          <DashboardCloseButton
            fallbackHref={dashboardCloseHref}
            label={`Close ${role} dashboard and return to MyDancr`}
          />
        </div>
        {state.error && (role === "venue" || role === "dancer") ? (
          <DashboardSignInRecovery role={role} onSignedIn={retryDashboard} />
        ) : state.error ? (
          <Link
            className="primary-link"
            href={`/account?role=${role}`}
          >
            Sign in
          </Link>
        ) : null}
      </section>

      {isLoading && !state.error ? (
        <DashboardLoadingState role={role} />
      ) : !isLoading && !state.error ? (
        <section className={`dashboard-grid ${role}-dashboard-grid`}>
          {state.agentAccess?.active ? <AgentDashboardShortcut /> : null}
          {role === "customer" ? (
            <>
              <CustomerDashboardTabs />
              <CustomerPanel saved={state.saved} onSavedChange={updateSaved} isLoading={isLoading} />
              <DashboardSection
                description="Schedule changes, saved-profile updates, Club Deal activity, and support replies."
                eyebrow="Guest workspace"
                id="customer-alerts"
                title="Alerts"
              >
                <NotificationPanel saved={state.saved} customerMode panelId="customer-alerts-panel" />
              </DashboardSection>
              <DashboardSection
                description="Preferences, support messages, password controls, and account status."
                eyebrow="Guest workspace"
                id="customer-settings"
                title="Account & settings"
              >
                <div className="venue-dashboard-inner-grid customer-settings-grid">
                  <InfoPanel title="Account">
                    <Metric label="Email" value={String(state.account?.email || "Private")} />
                    <Metric label="Status" value={String(state.account?.accountState || "active")} />
                  </InfoPanel>
                  <CustomerPreferencesPanel profile={state.profile} onProfileChange={updateProfile} />
                  <SupportInboxPanel initialThreads={state.supportThreads || []} panelId="customer-support" />
                  <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
                </div>
              </DashboardSection>
            </>
          ) : null}
          {role === "dancer" ? (
            <>
              <DancerPanel
                accountState={state.account?.accountState}
                analytics={state.analytics}
                deals={state.deals}
                finance={state.finance}
                affiliations={state.affiliations || []}
                nfc={state.nfc}
                profile={state.profile}
                onProfileChange={updateProfile}
                rankingEvents={state.rankingEvents}
                reviews={state.reviews}
                weeklyReport={state.weeklyReport}
              />
              <DashboardSection
                description="Notifications, support, security, and account controls."
                emphasis="utility"
                id="dancer-account"
                title={effectiveDancerProfileStatus(state.profile, state.account?.accountState) === "approved" ? "Account & support" : "Help & Account"}
                toggleAffordance="chevron"
              >
                <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
                  <AccountSummaryPanel
                    accountState={String(state.account?.accountState || "active")}
                    email={String(state.account?.email || "Private")}
                    role={String(state.account?.role || role)}
                  />
                  <NotificationPanel />
                  <SupportInboxPanel initialThreads={state.supportThreads || []} />
                  <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
                </div>
              </DashboardSection>
            </>
          ) : null}
          {role === "venue" ? (
            <>
              <VenuePanel
                  account={state.account || null}
                  analytics={state.analytics}
                  deal={state.deal}
                   venueDeals={state.venueDeals || []}
                   dealRequests={state.dealRequests || []}
                  dealRevenue={state.dealRevenue}
                  finance={state.finance}
                  profile={state.profile}
                  workingNow={state.workingNow || []}
                  initialAffiliations={state.affiliations || []}
                  venueAccess={state.venueAccess || null}
                  referralFee={state.referralFee || null}
                  refreshedAt={state.refreshedAt || null}
                  supportThreads={state.supportThreads || []}
                  analyticsPeriod={analyticsPeriod}
                  isRefreshing={isVenueRefreshing}
                  refreshStatus={venueRefreshStatus}
                  onAnalyticsPeriodChange={setAnalyticsPeriod}
                  onRefresh={() => void refreshVenueDashboard(true)}
                  onProfileChange={updateProfile}
                   onPublicationChange={(publication) => setState((current) => ({ ...current, publication }))}
                   onDealRequestsChange={(dealRequests) => setState((current) => ({ ...current, dealRequests }))}
                />
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function AgentDashboardShortcut() {
  return <Link className="agent-dashboard-shortcut" href="/dashboard/agent">
    <span><small>Venue partnerships</small><strong>Club referrals & commissions</strong></span>
    <b>Open agent dashboard →</b>
  </Link>;
}
function CustomerDashboardTabs() {
  return (
    <nav className="customer-dashboard-tabs" aria-label="Guest dashboard sections">
      <a href="#customer-tonight" onClick={(event) => openDashboardSection(event, "customer-tonight")}>Tonight</a>
      <a href="#customer-saved" onClick={(event) => openDashboardSection(event, "customer-saved")}>Saved</a>
      <a href="#customer-offers" onClick={(event) => openDashboardSection(event, "customer-offers")}>Club Deals</a>
      <a href="#customer-alerts" onClick={(event) => openDashboardSection(event, "customer-alerts")}>Alerts</a>
      <a href="#customer-settings" onClick={(event) => openDashboardSection(event, "customer-settings")}>Settings</a>
    </nav>
  );
}

function openDashboardSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  const section = document.getElementById(id);
  if (section instanceof HTMLDetailsElement) section.open = true;
  window.history.replaceState(null, "", `#${id}`);
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  section?.focus({ preventScroll: true });
}

function AccountSummaryPanel({
  accountState,
  email,
  role,
}: {
  accountState: string;
  email: string;
  role: string;
}) {
  const statusLabel = accountState.replaceAll("_", " ");
  const roleLabel = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : "Dancer";

  return (
    <article className="info-panel account-summary-panel">
      <div className="account-summary-heading">
        <h2>Account</h2>
        <span className={accountState === "active" ? "account-status-pill is-active" : "account-status-pill"}>
          {statusLabel}
        </span>
      </div>
      <dl className="account-summary-list">
        <div>
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{roleLabel}</dd>
        </div>
      </dl>
    </article>
  );
}

function NotificationPanel({
  saved,
  customerMode = false,
  panelId,
  refreshKey = 0,
}: {
  saved?: LoadState["saved"];
  customerMode?: boolean;
  panelId?: string;
  refreshKey?: number;
} = {}) {
  const [notifications, setNotifications] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("");
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (!mountedRef.current) return;
    if (actionInFlightRef.current) {
      loadQueuedRef.current = true;
      return;
    }
    loadQueuedRef.current = false;
    const requestId = ++loadSequenceRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        fallbackMessage: "Unable to load notifications.",
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setNotifications(data.notifications || []);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to load notifications.");
    } finally {
      if (requestId === loadSequenceRef.current && loadAbortRef.current === controller) loadAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
      actionSequenceRef.current += 1;
      actionInFlightRef.current = false;
      loadQueuedRef.current = false;
    };
  }, []);

  useEffect(() => { void loadNotifications(); }, [loadNotifications, refreshKey]);

  function beginNotificationAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    loadQueuedRef.current = true;
    return requestId;
  }

  function isCurrentNotificationAction(requestId: number) {
    return mountedRef.current && requestId === actionSequenceRef.current;
  }

  function finishNotificationAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionInFlightRef.current = false;
    if (mountedRef.current && loadQueuedRef.current) void loadNotifications();
  }

  async function markAllRead() {
    const requestId = beginNotificationAction();
    if (requestId === null) return;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
        fallbackMessage: "Unable to update notifications.",
      });
      if (!isCurrentNotificationAction(requestId)) return;
      setNotifications((current) => current.map((item) => ({ ...item, readAt: data.readAt })));
      setStatus(`${data.count || 0} marked read.`);
    } catch (error) {
      if (isCurrentNotificationAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to update notifications.");
    } finally {
      finishNotificationAction(requestId);
    }
  }

  async function markRead(notificationId: string) {
    const requestId = beginNotificationAction();
    if (requestId === null) return;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId }),
        fallbackMessage: "Unable to update notification.",
      });
      if (!isCurrentNotificationAction(requestId)) return;
      setNotifications((current) =>
        current.map((item) => (String(item.id) === notificationId ? { ...item, readAt: data.notification.readAt } : item)),
      );
    } catch (error) {
      if (isCurrentNotificationAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to update notification.");
    } finally {
      finishNotificationAction(requestId);
    }
  }

  async function clearNotifications() {
    const requestId = beginNotificationAction();
    if (requestId === null) return;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        method: "DELETE",
        fallbackMessage: "Unable to clear notifications.",
      });
      if (!isCurrentNotificationAction(requestId)) return;
      setNotifications([]);
      setStatus(`${data.count || 0} notifications cleared.`);
    } catch (error) {
      if (isCurrentNotificationAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to clear notifications.");
    } finally {
      finishNotificationAction(requestId);
    }
  }

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <article className="info-panel notification-panel" id={panelId ?? (customerMode ? "customer-alerts" : undefined)} tabIndex={customerMode ? -1 : undefined}>
      <div className="notification-title-row">
        <div>
          {customerMode ? <span>Updates that matter</span> : null}
          <h2>{customerMode ? "Alerts" : "Notifications"}</h2>
        </div>
        <div className="notification-toolbar">
          <span className="notification-unread-pill">{unreadCount} unread</span>
          <button className="notification-mark-read-button" type="button" onClick={markAllRead} disabled={!unreadCount}>
            Mark all read
          </button>
        </div>
      </div>
      <div className="notification-list">
        {notifications.slice(0, customerMode ? 10 : 6).map((notification) => {
          const notificationId = String(notification.id);
          const destination = customerMode ? customerNotificationHref(notification, saved) : "";
          const content = (
            <>
              <span className="notification-row-meta">
                <b>{notificationCategory(notification)}</b>
                <time dateTime={String(notification.createdAt || "")}>{formatNotificationTimestamp(notification.createdAt)}</time>
              </span>
              <strong>{String(notification.title || "Notification")}</strong>
              <span>{String(notification.body || "")}</span>
              {destination ? <em>Open details →</em> : null}
            </>
          );
          return destination ? (
            <Link
              className={notification.readAt ? "notification-row read" : "notification-row"}
              href={destination}
              key={notificationId}
              onClick={() => void markRead(notificationId)}
            >
              {content}
            </Link>
          ) : (
            <button
              className={notification.readAt ? "notification-row read" : "notification-row"}
              key={notificationId}
              type="button"
              onClick={() => void markRead(notificationId)}
            >
              {content}
            </button>
          );
        })}
        {!notifications.length ? (
          <div className="customer-empty-state compact">
            <strong>{customerMode ? "No alerts yet" : "No notifications yet"}</strong>
            <p>{customerMode ? "Follow dancers and clubs to receive schedule and venue updates here." : "Account and profile updates will appear here."}</p>
            {customerMode ? <Link href={homeDiscoveryHref("dancers")}>Browse dancers</Link> : null}
          </div>
        ) : null}
      </div>
      {notifications.length ? (
        <button className="notification-clear-button" type="button" onClick={clearNotifications}>
          Clear all
        </button>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

function SupportInboxPanel({
  initialThreads,
  panelId,
}: {
  initialThreads: Array<Record<string, unknown>>;
  panelId?: string;
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [busyThreadId, setBusyThreadId] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  function beginSupportAction(threadId = "") {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    if (threadId) setBusyThreadId(threadId);
    else setIsSending(true);
    return requestId;
  }

  function isCurrentSupportAction(requestId: number) {
    return mountedRef.current && requestId === actionSequenceRef.current;
  }

  function finishSupportAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionInFlightRef.current = false;
    if (!mountedRef.current) return;
    setIsSending(false);
    setBusyThreadId("");
  }

  async function sendMessage(payload: { message: string; subject?: string; threadId?: string }) {
    const data = await requestDashboardJson("/api/support", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      fallbackMessage: "Unable to send message.",
    });
    return data.thread;
  }

  async function startThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = beginSupportAction();
    if (requestId === null) return;
    setSendConfirmation(false);
    setStatus("");
    try {
      const thread = await sendMessage({ subject, message });
      if (!isCurrentSupportAction(requestId)) return;
      if (thread) setThreads((current) => [thread, ...current.filter((item) => String(item.id) !== String(thread.id))]);
      setSubject("");
      setMessage("");
      setStatus("Message sent to admin.");
      setSendConfirmation(true);
    } catch (error) {
      if (isCurrentSupportAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      finishSupportAction(requestId);
    }
  }

  async function replyToThread(threadId: string) {
    const body = (replyByThread[threadId] || "").trim();
    if (!body) {
      setStatus("Enter a reply first.");
      return;
    }

    const requestId = beginSupportAction(threadId);
    if (requestId === null) return;
    setStatus("");
    try {
      const thread = await sendMessage({ threadId, message: body });
      if (!isCurrentSupportAction(requestId)) return;
      if (thread) setThreads((current) => [thread, ...current.filter((item) => String(item.id) !== String(thread.id))]);
      setReplyByThread((current) => ({ ...current, [threadId]: "" }));
      setStatus("Reply sent to admin.");
    } catch (error) {
      if (isCurrentSupportAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to send reply.");
    } finally {
      finishSupportAction(requestId);
    }
  }

  return (
    <article className="info-panel support-panel" id={panelId}>
      <div className="support-panel-heading">
        <h2>Help &amp; support</h2>
        <p>Send a private message to the MyDancr team.</p>
      </div>
      <form onSubmit={startThread}>
        <label>
          Subject
          <input value={subject} onChange={(event) => { setSubject(event.target.value); setSendConfirmation(false); }} placeholder="How can we help?" required />
        </label>
        <label>
          Message
          <textarea value={message} onChange={(event) => { setMessage(event.target.value); setSendConfirmation(false); }} rows={4} placeholder="Add the details" required />
        </label>
        <button className={sendConfirmation ? "support-send-button is-sent" : "support-send-button"} type="submit" disabled={isSending || Boolean(busyThreadId)}>
          {isSending ? "Sending..." : sendConfirmation ? "✓ Message sent" : "Send message"}
        </button>
      </form>
      <div className="support-thread-list">
        {threads.slice(0, 6).map((thread) => {
          const threadId = String(thread.id || "");
          const messages = Array.isArray(thread.messages) ? thread.messages as Array<Record<string, unknown>> : [];
          return (
            <details className="support-thread" key={threadId} open={threads.length === 1}>
              <summary>
                <span>
                  <strong>{String(thread.subject || "Admin conversation")}</strong>
                  <small>{String(thread.status || "open")} / {formatDate(thread.lastMessageAt)}</small>
                </span>
              </summary>
              <div className="support-message-list">
                {messages.map((item) => (
                  <div className={String(item.senderRole) === "admin" ? "support-message from-admin" : "support-message"} key={String(item.id)}>
                    <strong>{String(item.senderRole) === "admin" ? "Admin" : "You"}</strong>
                    <p>{String(item.body || "")}</p>
                    <small>{formatDate(item.createdAt)}</small>
                  </div>
                ))}
              </div>
              <label>
                Reply
                <textarea
                  value={replyByThread[threadId] || ""}
                  onChange={(event) => setReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
                  rows={3}
                  placeholder="Reply to admin"
                />
              </label>
              <button type="button" disabled={isSending || Boolean(busyThreadId)} onClick={() => replyToThread(threadId)}>
                Send reply
              </button>
            </details>
          );
        })}
        {!threads.length ? <p>No support conversations yet.</p> : null}
      </div>
      {status ? <p>{status}</p> : null}
    </article>
  );
}

function AccountControlsPanel({
  accountRole,
  accountState,
  venueAccessRole,
  venueName,
}: {
  accountRole?: DashboardRole;
  accountState: string;
  venueAccessRole?: string;
  venueName?: string;
}) {
  const [state, setState] = useState(accountState);
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const isVenueAccount = accountRole === "venue";
  const isVenueOwner = isVenueAccount && venueAccessRole === "owner";
  const ownsVenueWorkspace = isVenueOwner || (isVenueAccount && state === "disabled" && !venueAccessRole);
  const accountHeading = ownsVenueWorkspace ? "Venue account & security" : "Account & security";
  const accountDescription = ownsVenueWorkspace
    ? "Pause or permanently close this venue account."
    : isVenueAccount
      ? "Manage your personal venue-team login."
      : "Manage this session and your account access.";

  useEffect(() => {
    setState(accountState);
  }, [accountState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  function beginAccountAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setIsWorking(true);
    setStatus("");
    return { requestId, controller };
  }

  function isCurrentAccountAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishAccountAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    if (mountedRef.current) setIsWorking(false);
  }

  async function updateAccount(nextState: "active" | "disabled") {
    const action = beginAccountAction();
    if (!action) return;
    const { requestId, controller } = action;
    try {
      const data = await requestAccountJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountState: nextState }),
        fallbackMessage: "Unable to update account.",
        signal: controller.signal,
      });
      if (!isCurrentAccountAction(requestId, controller)) return;
      setState(data.account?.accountState || nextState);
      setStatus(nextState === "disabled"
        ? ownsVenueWorkspace ? "Venue account disabled. The venue is now private and team access is paused." : "Account disabled."
        : ownsVenueWorkspace ? "Venue account reactivated." : "Account reactivated.");
      if (isVenueAccount) {
        window.location.replace(nextState === "disabled" ? "/dashboard/venue#venue-account" : "/dashboard/venue");
      }
    } catch (error) {
      if (isCurrentAccountAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to update account.");
    } finally {
      finishAccountAction(requestId);
    }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "DELETE") {
      setStatus("Type DELETE exactly to confirm permanent deletion.");
      return;
    }
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const action = beginAccountAction();
    if (!action) return;
    const { requestId, controller } = action;
    let accountDeleted = false;
    try {
      await requestAccountJson({
        method: "DELETE",
        fallbackMessage: "Unable to delete account.",
        signal: controller.signal,
      });
      accountDeleted = true;
    } catch (error) {
      if (isCurrentAccountAction(requestId, controller)) {
        const message = error instanceof Error ? error.message : "Unable to delete account.";
        window.alert(`${message} You have been signed out; sign in again to retry.`);
      }
    } finally {
      finishAccountAction(requestId);
      if (accountDeleted) {
        try {
          window.sessionStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, String(Date.now()));
        } catch {
          // A cache-busting foreground refresh still removes stale public results.
        }
      }
      clearDashboardSession();
      window.location.replace("/");
    }
  }

  function signOut() {
    actionSequenceRef.current += 1;
    actionAbortRef.current?.abort();
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    clearDashboardSession();
    window.location.href = "/";
  }

  return (
    <article className="info-panel account-controls-panel">
      <div className="account-controls-heading">
        <h2>{accountHeading}</h2>
        <p>{accountDescription}</p>
      </div>
      <div className="account-actions">
        <div className="account-action-row">
          <span><strong>Sign out</strong><small>End this session on this device.</small></span>
          <button className="account-action-button" type="button" onClick={signOut} disabled={isWorking}>Sign out</button>
        </div>
        <div className="account-action-row">
          <span>
            <strong>{state === "disabled" ? ownsVenueWorkspace ? "Reactivate venue account" : "Reactivate account" : ownsVenueWorkspace ? "Disable venue account" : "Disable account"}</strong>
            <small>{state === "disabled"
              ? ownsVenueWorkspace ? "Restore the venue and team access to the state they had before the pause." : "Restore access to your account."
              : ownsVenueWorkspace ? "Immediately make the venue private and pause access for the entire venue team without deleting saved data." : "Pause your access without deleting the shared venue or your saved account data."}</small>
          </span>
          <button className="account-action-button" type="button" onClick={() => updateAccount(state === "disabled" ? "active" : "disabled")} disabled={isWorking}>
            {state === "disabled" ? "Reactivate" : "Disable"}
          </button>
        </div>
        <div className="account-action-row account-danger-row">
          <span>
            <strong>{ownsVenueWorkspace ? "Delete venue account" : isVenueAccount ? "Delete my team account" : "Delete account"}</strong>
            <small>{ownsVenueWorkspace
              ? `Permanently remove this login and archive ${venueName || "the venue"}. MyDancr retains records required for accounting, security, and legal compliance.`
              : isVenueAccount ? "Permanently remove your login and team membership without deleting the shared venue." : "Permanently delete this account."}</small>
          </span>
          <button
            className="account-action-button danger-button"
            type="button"
            onClick={() => {
              setDeleteConfirmationOpen(true);
              setDeleteConfirmation("");
              setStatus("");
            }}
            disabled={isWorking}
          >Delete</button>
        </div>
        {deleteConfirmationOpen ? (
          <div className="account-delete-confirmation">
            <label htmlFor="account-delete-confirmation">
              Type <strong>DELETE</strong> to confirm. This cannot be undone and you will be signed out immediately.
            </label>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              id="account-delete-confirmation"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              spellCheck={false}
              value={deleteConfirmation}
            />
            <div>
              <button
                className="account-action-button"
                type="button"
                onClick={() => {
                  setDeleteConfirmationOpen(false);
                  setDeleteConfirmation("");
                  setStatus("");
                }}
                disabled={isWorking}
              >Cancel</button>
              <button
                className="account-action-button danger-button"
                type="button"
                onClick={deleteAccount}
                disabled={isWorking || deleteConfirmation !== "DELETE"}
              >{isWorking ? "Deleting…" : "Permanently delete"}</button>
            </div>
          </div>
        ) : null}
        {status ? <p role="status" aria-live="polite">{status}</p> : null}
      </div>
    </article>
  );
}

function CustomerPanel({
  isLoading,
  onSavedChange,
  saved,
}: {
  isLoading: boolean;
  onSavedChange: (update: (saved: CustomerSavedState) => CustomerSavedState) => void;
  saved?: LoadState["saved"];
}) {
  const [pendingAction, setPendingAction] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const locationSequenceRef = useRef(0);
  const locationInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
      locationSequenceRef.current += 1;
      locationInFlightRef.current = false;
    };
  }, []);

  function beginCustomerAction(actionKey: string) {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setPendingAction(actionKey);
    setActionStatus("");
    return { requestId, controller };
  }

  function isCurrentCustomerAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishCustomerAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    if (mountedRef.current) setPendingAction("");
  }

  async function runCustomerAction(
    actionKey: string,
    path: string,
    body: Record<string, unknown>,
    apply: (current: CustomerSavedState) => CustomerSavedState,
    successMessage: string,
  ) {
    const action = beginCustomerAction(actionKey);
    if (!action) return;
    const { requestId, controller } = action;
    try {
      await requestDashboardJson(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        expectedRole: "customer",
        fallbackMessage: "Unable to update your dashboard.",
        signal: controller.signal,
      });
      if (!isCurrentCustomerAction(requestId, controller)) return;
      onSavedChange(apply);
      setActionStatus(successMessage);
    } catch (error) {
      if (isCurrentCustomerAction(requestId, controller)) setActionStatus(error instanceof Error ? error.message : "Unable to update your dashboard.");
    } finally {
      finishCustomerAction(requestId);
    }
  }

  function updateDancerFollow(dancerId: string, following: boolean, notificationsEnabled: boolean) {
    return runCustomerAction(
      `dancer-${dancerId}`,
      "/api/customer/follows",
      { dancerId, following, notificationsEnabled },
      (current) => ({
        ...current,
        follows: following
          ? (current.follows || []).map((item) => item.dancerId === dancerId ? { ...item, notificationsEnabled } : item)
          : (current.follows || []).filter((item) => item.dancerId !== dancerId),
      }),
      following ? (notificationsEnabled ? "Dancer alerts turned on." : "Dancer alerts turned off.") : "Dancer unfollowed.",
    );
  }

  function removeFavorite(dancerId: string) {
    return runCustomerAction(
      `favorite-${dancerId}`,
      "/api/customer/favorites",
      { dancerId, favorite: false },
      (current) => ({
        ...current,
        favorites: (current.favorites || []).filter((item) => item.dancerId !== dancerId),
      }),
      "Favorite removed.",
    );
  }

  function updateVenueFollow(venueId: string, following: boolean, notificationsEnabled: boolean) {
    return runCustomerAction(
      `venue-${venueId}`,
      "/api/customer/venue-follows",
      { venueId, following, notificationsEnabled },
      (current) => ({
        ...current,
        venueFollows: following
          ? (current.venueFollows || []).map((item) => item.venueId === venueId ? { ...item, notificationsEnabled } : item)
          : (current.venueFollows || []).filter((item) => item.venueId !== venueId),
      }),
      following ? (notificationsEnabled ? "Club alerts turned on." : "Club alerts turned off.") : "Club unfollowed.",
    );
  }

  function cancelGoing(shiftId: string) {
    return runCustomerAction(
      `going-${shiftId}`,
      "/api/customer/going",
      { shiftId, going: false },
      (current) => ({
        ...current,
        goingSignals: (current.goingSignals || []).filter((item) => item.shiftId !== shiftId),
      }),
      "Removed from Your Night.",
    );
  }

  async function openDirections(venue: SavedVenueSummary, dancerId?: string | null) {
    if (isFictionalVenueTravelPreviewOnly(venue)) return;

    const venueId = String(venue.id || "");
    if (!venueId) {
      setActionStatus("Venue directions are unavailable.");
      return;
    }
    const action = beginCustomerAction(`directions-${venueId}`);
    if (!action) return;
    const { requestId, controller } = action;
    try {
      await requestDashboardJson("/api/customer/directions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, dancerIds: dancerId ? [dancerId] : [] }),
        expectedRole: "customer",
        fallbackMessage: "Unable to open directions.",
        signal: controller.signal,
      });
      if (!isCurrentCustomerAction(requestId, controller)) return;
      window.location.assign(customerDirectionsHref(venue));
    } catch (error) {
      if (isCurrentCustomerAction(requestId, controller)) setActionStatus(error instanceof Error ? error.message : "Unable to open directions.");
    } finally {
      finishCustomerAction(requestId);
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Location is not available in this browser.");
      return;
    }
    if (!mountedRef.current || locationInFlightRef.current) return;
    locationInFlightRef.current = true;
    const requestId = ++locationSequenceRef.current;
    setIsLocating(true);
    setLocationStatus("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mountedRef.current || requestId !== locationSequenceRef.current) return;
        locationInFlightRef.current = false;
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationStatus("Distances updated from your current location.");
        setIsLocating(false);
      },
      () => {
        if (!mountedRef.current || requestId !== locationSequenceRef.current) return;
        locationInFlightRef.current = false;
        setLocationStatus("Allow location access to show venue distances.");
        setIsLocating(false);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }

  return (
    <>
      {actionStatus ? <p className="customer-action-status" role="status">{actionStatus}</p> : null}
      <DashboardSection
        defaultOpen
        description="The shifts you marked Going, with the dancer, venue, and directions together."
        eyebrow="Guest workspace"
        id="customer-tonight"
        title="Your Night"
      >
        <CustomerNightPanel
          isLoading={isLoading}
          onCancelGoing={cancelGoing}
          onDirections={openDirections}
          pendingAction={pendingAction}
          signals={saved?.goingSignals || []}
        />
      </DashboardSection>
      <DashboardSection
        description="Followed dancers, favorites, and clubs with live distance and alert controls."
        eyebrow="Guest workspace"
        id="customer-saved"
        title="Saved"
      >
        <CustomerSavedPanel
          isLoading={isLoading}
          isLocating={isLocating}
          location={location}
          locationStatus={locationStatus}
          onDancerFollowChange={updateDancerFollow}
          onDirections={openDirections}
          onFavoriteRemove={removeFavorite}
          onRequestLocation={requestLocation}
          onVenueFollowChange={updateVenueFollow}
          pendingAction={pendingAction}
          saved={saved}
        />
      </DashboardSection>
      <DashboardSection
        description="Active cashier passes and the complete history of your Club Deal activity."
        eyebrow="Guest workspace"
        id="customer-offers"
        title="Club Deals"
      >
        <CustomerDealPassPanel deals={saved?.dealRedemptions || []} />
      </DashboardSection>
    </>
  );
}

function CustomerNightPanel({
  isLoading,
  onCancelGoing,
  onDirections,
  pendingAction,
  signals,
}: {
  isLoading: boolean;
  onCancelGoing: (shiftId: string) => void;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  pendingAction: string;
  signals: CustomerGoingSignal[];
}) {
  const now = useCustomerMinuteClock();
  const plans = signals
    .filter((item) => item.shift?.status === "posted" && new Date(item.shift.endsAt).getTime() > now)
    .sort((left, right) => new Date(left.shift?.startsAt || 0).getTime() - new Date(right.shift?.startsAt || 0).getTime());

  return (
    <article className="info-panel customer-night-panel" tabIndex={-1}>
      <div className="customer-section-heading split">
        <div>
          <span>Plans you confirmed</span>
          <h2>Your Night</h2>
        </div>
        <strong>{plans.length}</strong>
      </div>
      <div className="customer-night-list">
        {plans.map((item) => {
          const shift = item.shift!;
          const dancer = shift.dancer;
          const venue = shift.venue;
          return (
            <article className="customer-night-card" key={item.shiftId}>
              <SavedCardImage image={dancer} name={String(dancer.stageName || "Dancer")} />
              <div className="customer-night-copy">
                <span>{customerShiftLabel(shift)}</span>
                <h3>{dancer.stageName || "Dancer"}</h3>
                <p>{venue.name || "Venue"} · {[venue.city, venue.state].filter(Boolean).join(", ")}</p>
                <div className="customer-card-actions">
                  {dancer.slug ? <Link href={customerDancerHref(dancer)}>Profile</Link> : null}
                  {venue.slug ? <Link href={customerVenueHref(venue)}>Venue</Link> : null}
                  <CustomerDirectionsButton
                    dancerId={dancer.id}
                    onDirections={onDirections}
                    pending={Boolean(pendingAction)}
                    venue={venue}
                  />
                  <button className="customer-text-action" type="button" disabled={Boolean(pendingAction)} onClick={() => void onCancelGoing(item.shiftId)}>
                    Cancel Going
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!plans.length && !isLoading ? (
          <div className="customer-empty-state">
            <strong>No plans yet</strong>
            <p>Choose I’m Going on a dancer’s next shift and it will appear here with the venue and directions.</p>
            <Link href={homeDiscoveryHref("dancers")}>Find dancers</Link>
          </div>
        ) : null}
        {isLoading ? <div className="customer-loading-state">Loading your plans…</div> : null}
      </div>
    </article>
  );
}

function CustomerSavedPanel({
  isLoading,
  isLocating,
  location,
  locationStatus,
  onDancerFollowChange,
  onDirections,
  onFavoriteRemove,
  onRequestLocation,
  onVenueFollowChange,
  pendingAction,
  saved,
}: {
  isLoading: boolean;
  isLocating: boolean;
  location: { latitude: number; longitude: number } | null;
  locationStatus: string;
  onDancerFollowChange: (dancerId: string, following: boolean, notificationsEnabled: boolean) => void;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  onFavoriteRemove: (dancerId: string) => void;
  onRequestLocation: () => void;
  onVenueFollowChange: (venueId: string, following: boolean, notificationsEnabled: boolean) => void;
  pendingAction: string;
  saved?: LoadState["saved"];
}) {
  const followedDancers = saved?.follows || [];
  const favoriteDancers = saved?.favorites || [];
  const followedVenues = saved?.venueFollows || [];

  return (
    <article
      className="info-panel customer-saved-panel"
      tabIndex={-1}
    >
      <div className="customer-saved-head">
        <div>
          <span>People and clubs you chose</span>
          <h2>Saved</h2>
        </div>
        <button type="button" onClick={onRequestLocation} disabled={isLocating}>
          {isLocating ? "Finding you…" : location ? "Refresh distance" : "Show distance"}
        </button>
      </div>
      {locationStatus ? <p className="customer-location-status" role="status">{locationStatus}</p> : null}
      <div className="customer-saved-grid">
        <SavedLinkGroup title="Following">
          {followedDancers.map((item, index) => {
            const dancer = item.dancer;
            const dancerId = String(item.dancerId || dancer?.id || "");
            if (!dancer?.slug || !dancer.stageName || !dancerId) return null;
            return (
              <SavedDancerCard
                dancer={dancer}
                distance={customerVenueDistance(location, dancer.nextShift?.venue)}
                key={`${dancer.slug}-${index}`}
                onDirections={onDirections}
                onFollowChange={(following, notificationsEnabled) => void onDancerFollowChange(dancerId, following, notificationsEnabled)}
                pending={Boolean(pendingAction)}
                notificationsEnabled={Boolean(item.notificationsEnabled)}
                variant="following"
              />
            );
          })}
          {!followedDancers.length && !isLoading ? <CustomerSavedEmpty label="No followed dancers yet" href={homeDiscoveryHref("dancers")} cta="Browse dancers" /> : null}
        </SavedLinkGroup>
        <SavedLinkGroup title="Favorites">
          {favoriteDancers.map((item, index) => {
            const dancer = item.dancer;
            const dancerId = String(item.dancerId || dancer?.id || "");
            if (!dancer?.slug || !dancer.stageName || !dancerId) return null;
            return (
              <SavedDancerCard
                dancer={dancer}
                distance={customerVenueDistance(location, dancer.nextShift?.venue)}
                key={`${dancer.slug}-${index}`}
                onDirections={onDirections}
                onFavoriteRemove={() => void onFavoriteRemove(dancerId)}
                pending={Boolean(pendingAction)}
                variant="favorite"
              />
            );
          })}
          {!favoriteDancers.length && !isLoading ? <CustomerSavedEmpty label="No favorite dancers yet" href={homeDiscoveryHref("dancers")} cta="Find favorites" /> : null}
        </SavedLinkGroup>
        <SavedLinkGroup title="Clubs">
          {followedVenues.map((item, index) => {
            const venue = item.venue;
            const venueId = String(item.venueId || venue?.id || "");
            if (!venue?.slug || !venue.name || !venueId) return null;
            return (
              <SavedVenueCard
                distance={customerVenueDistance(location, venue)}
                key={`${venue.slug}-${index}`}
                notificationsEnabled={Boolean(item.notificationsEnabled)}
                onDirections={onDirections}
                onFollowChange={(following, notificationsEnabled) => void onVenueFollowChange(venueId, following, notificationsEnabled)}
                pending={Boolean(pendingAction)}
                venue={venue}
              />
            );
          })}
          {!followedVenues.length && !isLoading ? <CustomerSavedEmpty label="No followed clubs yet" href={homeDiscoveryHref("venues")} cta="Browse clubs" /> : null}
        </SavedLinkGroup>
      </div>
      {isLoading ? <div className="customer-loading-state">Loading your saved profiles…</div> : null}
    </article>
  );
}

function SavedLinkGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="customer-saved-group">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function SavedDancerCard({
  dancer,
  distance,
  notificationsEnabled = false,
  onDirections,
  onFavoriteRemove,
  onFollowChange,
  pending,
  variant,
}: {
  dancer: SavedDancerSummary;
  distance: string;
  notificationsEnabled?: boolean;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  onFavoriteRemove?: () => void;
  onFollowChange?: (following: boolean, notificationsEnabled: boolean) => void;
  pending: boolean;
  variant: "following" | "favorite";
}) {
  const shift = dancer.nextShift;
  return (
    <article className="customer-saved-card">
      <SavedCardImage image={dancer} name={String(dancer.stageName || "Dancer")} />
      <div className="customer-saved-card-copy">
        <span>{shift ? customerShiftLabel(shift) : "No upcoming shift"}</span>
        <Link href={customerDancerHref(dancer)}><strong>{dancer.stageName}</strong></Link>
        <small>
          {shift?.venue.name || dancer.city || "City unavailable"}
          {distance ? ` · ${distance}` : ""}
        </small>
        <div className="customer-card-actions">
          <Link href={customerDancerHref(dancer)}>Profile</Link>
          {shift?.venue.id ? (
            <CustomerDirectionsButton
              dancerId={dancer.id}
              onDirections={onDirections}
              pending={pending}
              venue={shift.venue}
            />
          ) : null}
          {variant === "following" && onFollowChange ? (
            <>
              <button type="button" disabled={pending} onClick={() => onFollowChange(true, !notificationsEnabled)}>
                {notificationsEnabled ? "Alerts on" : "Alerts off"}
              </button>
              <button className="customer-text-action" type="button" disabled={pending} onClick={() => onFollowChange(false, false)}>Unfollow</button>
            </>
          ) : null}
          {variant === "favorite" && onFavoriteRemove ? (
            <button className="customer-text-action" type="button" disabled={pending} onClick={onFavoriteRemove}>Remove favorite</button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SavedVenueCard({
  distance,
  notificationsEnabled,
  onDirections,
  onFollowChange,
  pending,
  venue,
}: {
  distance: string;
  notificationsEnabled: boolean;
  onDirections: (venue: SavedVenueSummary) => void;
  onFollowChange: (following: boolean, notificationsEnabled: boolean) => void;
  pending: boolean;
  venue: SavedVenueSummary;
}) {
  return (
    <article className="customer-saved-card">
      <SavedCardImage image={venue} name={String(venue.name || "Club")} />
      <div className="customer-saved-card-copy">
        <span>Followed club</span>
        <Link href={customerVenueHref(venue)}><strong>{venue.name}</strong></Link>
        <small>{[venue.city, venue.state].filter(Boolean).join(", ") || "Location unavailable"}{distance ? ` · ${distance}` : ""}</small>
        <div className="customer-card-actions">
          <Link href={customerVenueHref(venue)}>Profile</Link>
          <CustomerDirectionsButton onDirections={onDirections} pending={pending} venue={venue} />
          <button type="button" disabled={pending} onClick={() => onFollowChange(true, !notificationsEnabled)}>
            {notificationsEnabled ? "Alerts on" : "Alerts off"}
          </button>
          <button className="customer-text-action" type="button" disabled={pending} onClick={() => onFollowChange(false, false)}>Unfollow</button>
        </div>
      </div>
    </article>
  );
}

function CustomerDirectionsButton({
  dancerId,
  onDirections,
  pending,
  venue,
}: {
  dancerId?: string | null;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  pending: boolean;
  venue: SavedVenueSummary;
}) {
  const previewOnly = isFictionalVenueTravelPreviewOnly(venue);

  return (
    <button
      aria-disabled={previewOnly ? "true" : undefined}
      aria-label={previewOnly ? "Directions. Preview only." : "Directions"}
      disabled={!previewOnly && pending}
      onClick={(event) => {
        if (previewOnly) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        void onDirections(venue, dancerId);
      }}
      tabIndex={previewOnly ? -1 : undefined}
      type="button"
    >
      Directions
    </button>
  );
}

function SavedCardImage({ image, name }: { image: SavedImageSummary; name: string }) {
  if (image.imageUrl) {
    return (
      <img
        className="customer-saved-card-image"
        src={image.imageUrl}
        srcSet={image.imageSrcSet || undefined}
        sizes="(max-width: 860px) calc(100vw - 72px), (max-width: 1200px) 30vw, 340px"
        width={image.imageWidth || undefined}
        height={image.imageHeight || undefined}
        alt=""
      />
    );
  }
  return <span className="customer-saved-card-image fallback" aria-hidden="true">{customerInitials(name)}</span>;
}

function CustomerSavedEmpty({ cta, href, label }: { cta: string; href: string; label: string }) {
  return (
    <div className="customer-empty-state compact">
      <strong>{label}</strong>
      <Link href={href}>{cta}</Link>
    </div>
  );
}

function CustomerDealPassPanel({
  deals,
}: {
  deals: NonNullable<NonNullable<LoadState["saved"]>["dealRedemptions"]>;
}) {
  const now = useCustomerMinuteClock();
  const activeDeals = deals
    .filter((item) => item.status === "generated" && new Date(item.expiresAt).getTime() > now)
    .sort((left, right) => new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime());
  const pastDeals = deals
    .filter((item) => !activeDeals.some((active) => active.id === item.id))
    .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());

  return (
    <article className="info-panel saved-deal-panel" tabIndex={-1}>
      <div className="saved-deal-head">
        <div>
          <span>Club Deal history</span>
          <h2>Club Deals</h2>
        </div>
        <strong>{activeDeals.length}</strong>
      </div>
      <section className="customer-nfc-guide" aria-label="How cashier tap redemption works">
        <div><b>1</b><span><strong>Choose the exact deal</strong><small>Open an offer from a venue or a Working Now dancer before reaching the cashier.</small></span></div>
        <div><b>2</b><span><strong>Tap at the cashier</strong><small>Keep the deal open and tap the official MyDancr cashier sticker with this signed-in phone.</small></span></div>
        <div><b>3</b><span><strong>Wait for confirmation</strong><small>The on-screen confirmation records the redemption and the correct dancer attribution.</small></span></div>
      </section>
      <div className="saved-deal-list">
        {activeDeals.map((item) => (
          <Link
            className="saved-deal-item"
            href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`}
            key={item.id}
          >
            <span>
              <strong>{item.deal?.title || "Club Deal"}</strong>
              <small>{item.venue?.name || "Venue"} · {dealExpiryLabel(item.expiresAt, now)}</small>
            </span>
            <em>Open details</em>
          </Link>
        ))}
        {!activeDeals.length ? (
          <div className="customer-empty-state">
            <strong>No active Club Deals</strong>
            <p>Choose a Club Deal first, then tap the club&apos;s official cashier sticker. There is no QR code to scan.</p>
            <Link href={homeDiscoveryHref("venues")}>Browse clubs</Link>
          </div>
        ) : null}
        {pastDeals.length ? (
          <details className="past-deal-history">
            <summary>Past deals <span>{pastDeals.length}</span></summary>
            <div>
              {pastDeals.map((item) => {
                const expired = new Date(item.expiresAt).getTime() <= now;
                return (
                  <Link className="saved-deal-item unavailable" href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`} key={item.id}>
                    <span>
                      <strong>{item.deal?.title || "Club Deal"}</strong>
                      <small>{item.venue?.name || "Venue"} · {dealPassStatus(item.status, expired)}</small>
                    </span>
                    <em>View</em>
                  </Link>
                );
              })}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function dealPassStatus(status: string, expired: boolean) {
  if (status === "redeemed") return "Redeemed";
  if (status === "voided") return "Ended";
  if (status === "expired" || expired) return "Expired";
  return "Ready";
}

function useCustomerMinuteClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function dealExpiryLabel(expiresAt: string, now: number) {
  const remainingMinutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
  if (remainingMinutes < 60) return `Expires in ${remainingMinutes} min`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours < 24) return `Expires in ${hours}h${minutes ? ` ${minutes}m` : ""}`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function customerShiftLabel(shift: Pick<SavedShiftSummary, "startsAt" | "endsAt" | "timezone" | "checkedInAt" | "checkedOutAt">) {
  const now = Date.now();
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  if (shift.checkedInAt && !shift.checkedOutAt && startsAt <= now && endsAt > now) return "Working now";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: shift.timezone || undefined,
    }).format(new Date(shift.startsAt));
  } catch {
    return new Date(shift.startsAt).toLocaleString();
  }
}

function customerDancerHref(dancer: SavedDancerSummary) {
  const city = String(dancer.city || "Las Vegas");
  const slug = String(dancer.slug || "");
  return `/?city=${encodeURIComponent(city)}&profile=${encodeURIComponent(slug)}`;
}

function customerVenueHref(venue: SavedVenueSummary) {
  const city = String(venue.city || "Las Vegas");
  const slug = String(venue.slug || "");
  return `/?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(slug)}`;
}

function customerDirectionsHref(venue: SavedVenueSummary) {
  const latitude = Number(venue.latitude);
  const longitude = Number(venue.longitude);
  const query = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude},${longitude}`
    : [venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function customerVenueDistance(
  location: { latitude: number; longitude: number } | null,
  venue?: SavedVenueSummary | null,
) {
  if (!location || !venue) return "";
  const venueLatitude = Number(venue.latitude);
  const venueLongitude = Number(venue.longitude);
  if (!Number.isFinite(venueLatitude) || !Number.isFinite(venueLongitude)) return "";
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(venueLatitude - location.latitude);
  const longitudeDelta = toRadians(venueLongitude - location.longitude);
  const startLatitude = toRadians(location.latitude);
  const endLatitude = toRadians(venueLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const miles = 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

function customerInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "M";
}

function customerNotificationHref(notification: Record<string, unknown>, saved?: LoadState["saved"]) {
  const payload = notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
    ? notification.payload as Record<string, unknown>
    : {};
  if (payload.threadId || notification.type === "support_message") return "/dashboard/customer#customer-support";

  const dancerId = String(payload.dancerId || "");
  if (dancerId) {
    const dancer = [
      ...(saved?.follows || []).map((item) => item.dancer),
      ...(saved?.favorites || []).map((item) => item.dancer),
      ...(saved?.goingSignals || []).map((item) => item.shift?.dancer),
    ].find((item) => String(item?.id || "") === dancerId);
    if (dancer?.slug) return customerDancerHref(dancer);
  }

  const venueId = String(payload.venueId || "");
  if (venueId) {
    const venue = [
      ...(saved?.venueFollows || []).map((item) => item.venue),
      ...(saved?.goingSignals || []).map((item) => item.shift?.venue),
    ].find((item) => String(item?.id || "") === venueId);
    if (venue?.slug) return customerVenueHref(venue);
  }
  return "";
}

function notificationCategory(notification: Record<string, unknown>) {
  const type = String(notification.type || "");
  if (type.includes("shift")) return "Schedule";
  if (type.includes("support")) return "Support";
  if (type.includes("venue") || type.includes("club")) return "Club";
  if (type.includes("deal")) return "Club Deal";
  return "MyDancr";
}

function formatNotificationTimestamp(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function DashboardSection({
  badge,
  children,
  defaultOpen = false,
  description,
  emphasis = "standard",
  eyebrow,
  hidden = false,
  id,
  title,
  toggleAffordance = "add",
}: {
  badge?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  description: string;
  emphasis?: "standard" | "summary" | "primary" | "secondary" | "utility";
  eyebrow?: string;
  hidden?: boolean;
  id: string;
  title: string;
  toggleAffordance?: "add" | "chevron";
}) {
  return (
    <details className={`dashboard-section venue-dashboard-section dashboard-section-${emphasis}`} hidden={hidden} id={id} onToggle={alignOpenedDashboardSection} open={defaultOpen} tabIndex={-1}>
      <summary>
        <span className="venue-dashboard-section-copy">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
        {badge ? <span className="venue-dashboard-section-badge">{badge}</span> : null}
        <span className={`venue-dashboard-section-toggle is-${toggleAffordance}`} aria-hidden="true">
          {toggleAffordance === "chevron" ? (
            <svg viewBox="0 0 24 24">
              <path d="m7 9 5 5 5-5" />
            </svg>
          ) : "+"}
        </span>
      </summary>
      <div className="venue-dashboard-section-body">{children}</div>
    </details>
  );
}

function alignOpenedDashboardSection(event: SyntheticEvent<HTMLDetailsElement>) {
  if (event.target !== event.currentTarget || !event.currentTarget.open) return;
  const section = event.currentTarget;
  window.requestAnimationFrame(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}

function DashboardLoadingState({ role }: { role: DashboardRole }) {
  return (
    <section className="venue-dashboard-loading" aria-busy="true" aria-label={`Loading ${role} dashboard`}>
      <span className="dashboard-sr-only">Loading {role} dashboard</span>
      <div className="venue-dashboard-loading-command">
        <span className="venue-dashboard-loading-pill" />
        <div className="venue-dashboard-loading-copy">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="venue-dashboard-loading-actions">
        <span />
        <span />
      </div>
      <div className="venue-dashboard-loading-metrics">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

type VenueWorkspace = "tonight" | "venue" | "business";

function venueWorkspaceForSection(sectionId: string): VenueWorkspace | null {
  if (["venue-working-now", "venue-dancer-roster", "venue-club-deals", "venue-deal-contract-ledger"].includes(sectionId)) return "tonight";
  if (sectionId === "venue-tv") return "venue";
  if (["venue-overview", "venue-team", "venue-account"].includes(sectionId)) return "business";
  return null;
}

function initialVenueWorkspace(isPublished: boolean): VenueWorkspace {
  return isPublished ? "tonight" : "venue";
}

function VenuePanel({
  account,
  analytics,
  deal,
  venueDeals,
  dealRequests,
  dealRevenue,
  finance,
  profile,
  workingNow,
  initialAffiliations,
  venueAccess,
  referralFee,
  refreshedAt,
  supportThreads,
  analyticsPeriod,
  isRefreshing,
  refreshStatus,
  onAnalyticsPeriodChange,
  onRefresh,
  onProfileChange,
  onPublicationChange,
  onDealRequestsChange,
}: {
  account: DashboardSessionAccount | null;
  analytics?: LoadState["analytics"];
  deal?: LoadState["deal"];
  venueDeals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  dealRevenue?: LoadState["dealRevenue"];
  finance?: LoadState["finance"];
  profile?: LoadState["profile"];
  workingNow: Array<Record<string, unknown>>;
  initialAffiliations: Array<Record<string, unknown>>;
  venueAccess?: LoadState["venueAccess"];
  referralFee?: LoadState["referralFee"];
  refreshedAt?: string | null;
  supportThreads: Array<Record<string, unknown>>;
  analyticsPeriod: "tonight" | "7d" | "30d";
  isRefreshing: boolean;
  refreshStatus: string;
  onAnalyticsPeriodChange: (period: "tonight" | "7d" | "30d") => void;
  onRefresh: () => void;
  onProfileChange: (profile: Record<string, unknown>) => void;
  onPublicationChange: (publication: Record<string, unknown>) => void;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
}) {
  const [publicationStatus, setPublicationStatus] = useState("");
  const [isPublishingVenue, setIsPublishingVenue] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [notificationRevision, setNotificationRevision] = useState(0);
  const [activeWorkspace, setActiveWorkspace] = useState<VenueWorkspace>(() => initialVenueWorkspace(profile?.isActive === true));
  const mountedRef = useRef(false);
  const publicationSequenceRef = useRef(0);
  const publicationAbortRef = useRef<AbortController | null>(null);
  const publicationInFlightRef = useRef(false);

  useEffect(() => {
    const hashWorkspace = venueWorkspaceForSection(window.location.hash.replace(/^#/, ""));
    if (hashWorkspace) setActiveWorkspace(hashWorkspace);
  }, []);

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
      if (decision === "approved") setNotificationRevision((current) => current + 1);
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
    const workspaces: VenueWorkspace[] = ["tonight", "venue", "business"];
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
    setActiveWorkspace(venueWorkspaceForSection(sectionId) || activeWorkspace);
    window.history.replaceState(null, "", `#${sectionId}`);
    window.setTimeout(() => {
      const section = document.getElementById(sectionId) as HTMLDetailsElement | null;
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
  const venueReviewReferralFee = referralFee?.current as Record<string, unknown> | null | undefined;
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
  const isPublished = profile?.isActive === true;
  const pageReviewStatus = String(profile?.pageReviewStatus || (isPublished ? "published" : "admin_draft"));
  const isAwaitingVenueReview = !isPublished && pageReviewStatus === "venue_review";
  const venueCustomerPreviewHref = isAwaitingVenueReview && venueSlug
    ? `/?city=${encodeURIComponent(venueCity)}&venue=${encodeURIComponent(venueSlug)}&venue_preview=1`
    : "";
  const venuePageTabStatus = isPublished
    ? "Live page"
    : pageReviewStatus === "venue_review"
      ? "Ready to review"
      : pageReviewStatus === "changes_requested"
        ? "Changes in progress"
        : pageReviewStatus === "venue_approved"
          ? "Approved"
          : "In preparation";

  return (
    <>
      <section className="venue-command-panel" aria-labelledby="venue-command-heading">
        <div className="venue-command-status">
          <span className={isPublished ? "venue-live-pill" : "venue-live-pill is-draft"}>{isPublished ? "LIVE" : "PRIVATE DRAFT"}</span>
          <div>
          <h2 id="venue-command-heading">{isPublished ? `Tonight at ${venueName}` : `Private page for ${venueName}`}</h2>
            <p>{isPublished ? `Run the floor, deals, and dancer roster for ${venueCity} from one live workspace.` : "MyDancr prepares the venue page. Your team reviews it and approves it to make it live."}</p>
          </div>
          <div className="venue-refresh-control">
            <small>{refreshedAt ? `Updated ${formatRelativeDashboardTime(refreshedAt)}` : "Live data loading"}</small>
            <button type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
      </section>

      <nav className="venue-workspace-tabs" aria-label="Venue workspace" role="tablist">
        {([
          ["tonight", "Tonight", "Roster · deals · check-in", `${workingNow.length} working · ${activeDealCount} live ${activeDealCount === 1 ? "deal" : "deals"}`],
          ["venue", "Venue page", "Preview · review · MyDancr TV", venuePageTabStatus],
          ["business", "Business", "Analytics · team · account", "Management tools"],
        ] as const).map(([workspace, label, contents, status]) => (
          <button
            aria-controls={`venue-workspace-${workspace}`}
            aria-label={`${label}. ${contents}. ${status}.`}
            aria-selected={activeWorkspace === workspace}
            className={activeWorkspace === workspace ? "active" : ""}
            id={`venue-workspace-${workspace}-tab`}
            key={workspace}
            onKeyDown={(event) => moveVenueWorkspaceFocus(event, workspace)}
            onClick={() => selectVenueWorkspace(workspace)}
            role="tab"
            type="button"
          >
            <strong>{label}</strong>
            <small>{contents}</small>
            <span className="venue-workspace-tab-status">{status}</span>
          </button>
        ))}
      </nav>

      <section
        aria-labelledby="venue-workspace-tonight-tab"
        className="venue-command-primary venue-workspace-summary"
        hidden={activeWorkspace !== "tonight"}
        id="venue-workspace-tonight"
        role="tabpanel"
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
          {refreshStatus ? <small className="venue-refresh-status" role="status">{refreshStatus}</small> : null}
      </section>

      <section
        aria-labelledby="venue-workspace-venue-tab"
        className={`venue-publication-panel${isPublished ? " is-published" : ""}`}
        hidden={activeWorkspace !== "venue"}
        id="venue-workspace-venue"
        role="tabpanel"
      >
        <div>
          <span className="eyebrow">{isPublished ? "Public venue" : "Venue page review"}</span>
          <h2 id="venue-publication-heading">
            {isPublished
              ? "Your venue is live on MyDancr"
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
                <strong>Club Deal and MyDancr fee</strong>
                <small>These are read-only. Request a correction before approving if they do not match the agreement.</small>
              </span>
              <dl>
                <div><dt>Customer offer</dt><dd>{String(venueReviewDeal?.dealTitle || "Club Deal not provided")}</dd></div>
                <div><dt>MyDancr fee</dt><dd>{venueReviewReferralFee ? `${formatCents(Number(venueReviewReferralFee.feeCents || 0))} per confirmed customer` : "Agreement pending"}</dd></div>
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

      <section className="venue-dashboard-metrics venue-tonight-metrics" aria-label="Tonight at a glance" hidden={activeWorkspace !== "tonight"}>
        <Metric label="Working now" value={String(workingNow.length)} />
        <Metric label="Upcoming shifts" value={String(upcomingShiftCount)} />
        <Metric label="Live Club Deals" value={String(activeDealCount)} />
        <Metric label="Verified roster" value={String(nfcAuthorizedDancerCount)} />
      </section>

      <DashboardSection
        badge={`${activeDealCount} live · ${dashboardDeals.length} total`}
        description="Review every live or inactive deal, guest terms, agreed fees, and monthly activity."
        eyebrow="Current offers"
        hidden={activeWorkspace !== "tonight"}
        id="venue-club-deals"
        title="Current Club Deals"
      >
        <VenueDealReadOnlyPanel
          deals={dashboardDeals}
          dealRequests={dealRequests}
          finance={finance}
          isVenuePublished={isPublished}
          referralFee={referralFee}
          revenue={dealRevenue}
          venueCity={venueCity}
          venueSlug={venueSlug}
          canRequestDeals={permissions.includes("request_deals") || venueRole === "owner" || venueRole === "manager"}
          onDealRequestsChange={onDealRequestsChange}
        />
      </DashboardSection>

      <DashboardSection
        badge={`${workingNow.length} active`}
        description="Review dancers verified by this venue's official check-in sticker and open their live profiles."
        eyebrow="Floor status"
        hidden={activeWorkspace !== "tonight"}
        id="venue-working-now"
        title="Working now"
      >
        <article className="info-panel venue-working-panel">
          <h2>Verified dancer check-ins</h2>
          <div className="venue-working-list">
            {workingNow.map((dancer) => (
              <Link href={`/dancers/${String(dancer.dancerSlug || "")}`} key={String(dancer.shiftId)}>
                <span className="venue-working-identity">
                  {dancer.avatarUrl ? <img src={String(dancer.avatarUrl)} srcSet={dancer.avatarSrcSet ? String(dancer.avatarSrcSet) : undefined} sizes="48px" alt="" /> : <i aria-hidden="true">{String(dancer.stageName || "D").slice(0, 1)}</i>}
                  <span><strong>{String(dancer.stageName || "Dancer")}</strong><small>Checked in {dancer.checkedInAt ? formatRelativeDashboardTime(String(dancer.checkedInAt)) : "during this shift"}</small></span>
                </span>
                <span className="venue-working-verification"><strong>Check-in verified</strong><small>Active until {formatDashboardTime(String(dancer.endsAt || ""))}</small></span>
              </Link>
            ))}
            {!workingNow.length ? <p>No verified dancer check-ins right now.</p> : null}
          </div>
        </article>
      </DashboardSection>

      <DashboardSection
        description="View the official dancer check-in and guest redemption stickers assigned to this venue. A dancer uses the check-in sticker to verify venue access and start a current posted shift."
        eyebrow="Floor access"
        hidden={activeWorkspace !== "tonight"}
        id="venue-dancer-roster"
        title="Check-in & redemption stickers"
        badge={`${nfcAuthorizedDancerCount} authorized`}
      >
        <VenueNfcTagPanel
          initialAffiliations={activeAffiliations}
          canManageRoster={canManageRoster}
          canRequestSupport={canRequestNfcSupport}
        />
      </DashboardSection>

      <section
        aria-labelledby="venue-workspace-business-tab"
        className="venue-workspace-business-summary"
        hidden={activeWorkspace !== "business"}
        id="venue-workspace-business"
        role="tabpanel"
      >
        <span className="eyebrow">Business controls</span>
        <h2>Performance, team, and account</h2>
        <p>Review results and manage the people and account settings behind the venue.</p>
      </section>

      <DashboardSection
        description="Guest reach, intent, live activity, and Club Deal visibility."
        eyebrow="Live performance"
        hidden={activeWorkspace !== "business"}
        id="venue-overview"
        title="Analytics & performance"
      >
        <div className="venue-analytics-period" role="group" aria-label="Analytics period">
          {(["tonight", "7d", "30d"] as const).map((period) => (
            <button className={analyticsPeriod === period ? "active" : ""} type="button" key={period} onClick={() => onAnalyticsPeriodChange(period)}>
              {period === "tonight" ? "Tonight" : period === "7d" ? "7 days" : "30 days"}
            </button>
          ))}
        </div>
        <div className="venue-dashboard-inner-grid venue-dashboard-overview-grid">
          <InfoPanel title="Audience">
            <VenueAnalyticsMetric label="Page views" value={Number(analytics?.pageViews || 0)} change={readOptionalNumber(analytics?.pageViewsChangePercent)} />
            <Metric label="Venue followers" value={String(analytics?.totalFollowers || 0)} />
            <Metric label="New followers" value={String(analytics?.followersGained || 0)} />
          </InfoPanel>
          <InfoPanel title="Guest intent">
            <VenueAnalyticsMetric label="Direction requests" value={Number(analytics?.directions || 0)} change={readOptionalNumber(analytics?.directionsChangePercent)} />
            <Metric label="View → directions" value={formatPercent(analytics?.directionConversionPercent)} />
            <Metric label="Going signals" value={String(analytics?.goingSignals || 0)} />
          </InfoPanel>
          <InfoPanel title="Live operations">
            <Metric label="Working now" value={String(analytics?.activeDancersNow || 0)} />
            <Metric label="Upcoming shifts" value={String(analytics?.upcomingShiftCount || 0)} />
            <Metric label="Dancer check-ins" value={String(analytics?.dressingRoomNfcTaps || 0)} />
            <Metric label="Guest redemption attempts" value={String(analytics?.cashierNfcAttempts || 0)} />
            <VenueAnalyticsMetric label="Deal redemptions" value={Number(analytics?.cashierNfcRedemptions || 0)} change={readOptionalNumber(analytics?.redemptionsChangePercent)} />
            <Metric label="Attempt → redemption" value={formatPercent(analytics?.redemptionConversionPercent)} />
          </InfoPanel>
        </div>
      </DashboardSection>

      <DashboardSection
        description="Review engagement for approved videos automatically connected by verified current shifts and posted upcoming shifts."
        eyebrow="Video"
        hidden={activeWorkspace !== "venue"}
        id="venue-tv"
        title="MyDancr TV"
      >
        <VenueTvPanel />
      </DashboardSection>

      {canViewTeam ? (
        <DashboardSection
          description="Invite managers and staff with the minimum access they need, then review an auditable history of venue changes."
          eyebrow="Security"
          hidden={activeWorkspace !== "business"}
          id="venue-team"
          title="Team & activity"
        >
          <VenueTeamPanel initialAccess={venueAccess as { role: "owner" | "manager" | "staff"; permissions: string[] } | null} />
        </DashboardSection>
      ) : null}

      <DashboardSection
        description="Notifications, support messages, and account controls."
        eyebrow="Venue workspace"
        hidden={activeWorkspace !== "business"}
        id="venue-account"
        title="Account & support"
      >
        <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
          <InfoPanel title="Account">
            <Metric label="Status" value={String(account?.accountState || "active")} />
            <Metric label="Email" value={String(account?.email || "Private")} />
            <Metric label="Role" value={String(account?.role || "venue")} />
          </InfoPanel>
          <NotificationPanel refreshKey={notificationRevision} />
          <SupportInboxPanel initialThreads={supportThreads} />
          <AccountControlsPanel
            accountRole="venue"
            accountState={String(account?.accountState || "active")}
            venueAccessRole={venueRole}
            venueName={venueName}
          />
        </div>
      </DashboardSection>

    </>
  );
}

function VenueClubDealPanel({
  finance,
  initialDeal,
  initialDeals,
  onDealsChange,
  referralFee,
  onReferralFeeChange,
  revenue,
  venueSlug,
}: {
  finance?: LoadState["finance"];
  initialDeal?: LoadState["deal"];
  initialDeals: Array<Record<string, unknown>>;
  onDealsChange: (deals: Array<Record<string, unknown>>) => void;
  referralFee?: LoadState["referralFee"];
  onReferralFeeChange: (referralFee: Record<string, unknown>) => void;
  revenue?: LoadState["dealRevenue"];
  venueSlug: string;
}) {
  const seedDeals = initialDeals.length ? initialDeals : initialDeal ? [initialDeal] : [];
  const editingIdRef = useRef(String(seedDeals[0]?.id || ""));
  const editorRef = useRef<HTMLDetailsElement>(null);
  const [deals, setDeals] = useState<Array<Record<string, unknown>>>(seedDeals);
  const [editingId, setEditingId] = useState(editingIdRef.current);
  const [form, setForm] = useState(() => venueDealForm(seedDeals[0]));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [showFeeRequest, setShowFeeRequest] = useState(false);
  const [requestedFee, setRequestedFee] = useState("");
  const [feeRequestReason, setFeeRequestReason] = useState("");
  const [feeRequestStatus, setFeeRequestStatus] = useState("");
  const [isRequestingFee, setIsRequestingFee] = useState(false);

  useEffect(() => {
    const nextDeals = initialDeals.length ? initialDeals : initialDeal ? [initialDeal] : [];
    const selectedDeal = nextDeals.find((deal) => String(deal.id) === editingIdRef.current) || nextDeals[0];
    const nextEditingId = String(selectedDeal?.id || "");
    setDeals(nextDeals);
    editingIdRef.current = nextEditingId;
    setEditingId(nextEditingId);
    setForm(venueDealForm(selectedDeal));
  }, [initialDeal, initialDeals]);

  function updateDealForm<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setSaveConfirmed(false);
    setStatus("");
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectDealOffer(title: string) {
    const preset = clubDealOfferPresetForTitle(title) || defaultClubDealOfferPreset();
    setSaveConfirmed(false);
    setStatus("");
    setForm((current) => ({
      ...current,
      dealTitle: preset.title,
      dealDescription: preset.description,
      dealTerms: preset.terms,
      offerType: "admission",
    }));
  }

  function editDeal(deal: Record<string, unknown>) {
    const nextEditingId = String(deal.id || "");
    editingIdRef.current = nextEditingId;
    setEditingId(nextEditingId);
    setForm(venueDealForm(deal));
    setSaveConfirmed(false);
    setStatus("");
  }

  function addDeal() {
    editingIdRef.current = "";
    setEditingId("");
    setForm(venueDealForm(null, deals.length));
    setSaveConfirmed(false);
    setStatus("New deal started. Save it as a draft or publish it when every detail is ready.");
  }

  async function saveDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveConfirmed(false);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value || "save";
    const nextIsActive = action === "publish" ? true : action === "draft" || action === "unpublish" ? false : form.isActive;

    const dealTitle = form.dealTitle.trim();
    if (dealTitle.length < 3) {
      setStatus("Deal title must be at least 3 characters.");
      return;
    }

    const dealDescription = form.dealDescription.trim();
    if (dealDescription.length < 8) {
      setStatus("Offer details must be at least 8 characters.");
      return;
    }

    if (nextIsActive && !currentReferralFee) {
      setStatus("A MyDancr referral fee agreement is required before publishing this Club Deal.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const data = await requestDashboardJson("/api/venue/deal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dealId: editingId || null,
          dealTitle,
          dealDescription,
          dealTerms: form.dealTerms,
          isActive: nextIsActive,
          offerType: "admission",
          sortOrder: Number(form.sortOrder),
        }),
        expectedRole: "venue",
        fallbackMessage: "Unable to update the tracked Club Deal.",
      });
      const nextDeals = Array.isArray(data.deals)
        ? data.deals
        : upsertVenueDeal(deals, data.deal);
      const savedDeal = nextDeals.find(
        (deal: Record<string, unknown>) => String(deal.id) === String(data.deal.id),
      ) || data.deal;
      setDeals(nextDeals);
      onDealsChange(nextDeals);
      editingIdRef.current = String(savedDeal.id);
      setEditingId(editingIdRef.current);
      setForm(venueDealForm(savedDeal));
      setStatus(savedDeal.isActive
        ? "Changes saved. This deal is live across MyDancr."
        : "Saved changes. This deal is a draft and is not visible on MyDancr.");
      setSaveConfirmed(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update the tracked Club Deal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteDeal() {
    if (!editingId || isSaving) return;
    setIsSaving(true);
    setStatus("");
    try {
      const data = await requestDashboardJson(`/api/venue/deal?dealId=${encodeURIComponent(editingId)}`, {
        method: "DELETE",
        expectedRole: "venue",
        fallbackMessage: "Unable to delete this Club Deal.",
      });
      const nextDeals = deals.filter((deal) => String(deal.id) !== editingId);
      const nextEditingId = String(nextDeals[0]?.id || "");
      setDeals(nextDeals);
      onDealsChange(nextDeals);
      editingIdRef.current = nextEditingId;
      setEditingId(nextEditingId);
      setForm(venueDealForm(nextDeals[0], nextDeals.length));
      setStatus(data.message || "Club Deal deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete this Club Deal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function requestFeeChange() {
    const requestedFeeCents = dollarsToCents(requestedFee);
    if (requestedFeeCents === null) {
      setFeeRequestStatus("Enter a requested fee between $1.00 and $1,000.00.");
      return;
    }
    if (feeRequestReason.trim().length < 10) {
      setFeeRequestStatus("Add a short reason for the requested change.");
      return;
    }
    setIsRequestingFee(true);
    setFeeRequestStatus("");
    try {
      const data = await requestDashboardJson("/api/venue/referral-fee", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestedFeeCents, reason: feeRequestReason }),
        expectedRole: "venue",
        fallbackMessage: "Unable to request a fee change.",
      });
      onReferralFeeChange(data.referralFee);
      setRequestedFee("");
      setFeeRequestReason("");
      setShowFeeRequest(false);
      setFeeRequestStatus(data.message || "Referral fee change request sent to MyDancr.");
    } catch (error) {
      setFeeRequestStatus(error instanceof Error ? error.message : "Unable to request a fee change.");
    } finally {
      setIsRequestingFee(false);
    }
  }

  const liveDeals = deals.filter((deal) => deal.isActive === true);
  const liveCount = liveDeals.length;
  const draftCount = deals.length - liveCount;
  const liveDeal = liveDeals[0];
  const selectedDeal = deals.find((deal) => String(deal.id) === editingId) || liveDeal || deals[0];
  const primaryDeal = liveDeal || selectedDeal;
  const currentReferralFee = referralFee?.current as Record<string, unknown> | null | undefined;
  const referralRequests = Array.isArray(referralFee?.requests)
    ? referralFee.requests as Array<Record<string, unknown>>
    : [];
  const pendingFeeRequest = referralRequests.find((request) => request.status === "pending");

  function revealDealEditor() {
    if (editorRef.current) editorRef.current.open = true;
    window.setTimeout(() => {
      editorRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
    }, 0);
  }

  function openDealEditor(mode: "primary" | "new") {
    if (mode === "new" || !primaryDeal) addDeal();
    else editDeal(primaryDeal);
    revealDealEditor();
  }

  function openSpecificDealEditor(deal: Record<string, unknown>) {
    editDeal(deal);
    revealDealEditor();
  }

  return (
    <article className="info-panel venue-deal-panel">
      <div className="venue-deal-heading">
        <div>
          <span className="eyebrow">Revenue control</span>
          <h2>Manage Club Deals</h2>
        </div>
        <strong className={liveCount ? "deal-state active" : "deal-state"}>
          {liveCount ? `${liveCount} live` : "Inactive"}
        </strong>
      </div>
      <section className={liveCount ? "venue-deal-control-card is-live" : "venue-deal-control-card"} aria-label="Current Club Deal status">
        <div className="venue-deal-control-status">
          <span>{liveCount > 1 ? "Live Club Deals" : liveCount ? "Live Club Deal" : deals.length ? "No live Club Deal" : "Club Deals are inactive"}</span>
          <strong>{liveCount > 1 ? `${liveCount} Club Deals are live` : liveDeal ? String(liveDeal.dealTitle || "Live Club Deal") : deals.length ? `${draftCount} ${draftCount === 1 ? "draft" : "drafts"} ready to finish` : "Create your first Club Deal"}</strong>
          <small>{liveCount ? "Available on your venue page and assigned cashier stickers." : "Publish a deal when you are ready to accept cashier-tap redemptions."}</small>
          {liveDeals.length > 1 ? (
            <div className="venue-deal-live-list" aria-label="Live Club Deals">
              {liveDeals.map((deal) => (
                <button key={String(deal.id)} type="button" onClick={() => openSpecificDealEditor(deal)}>
                  <span>
                    <strong>{String(deal.dealTitle || "Live Club Deal")}</strong>
                    <small>{dealTypeLabel(String(deal.offerType || "admission"))}</small>
                  </span>
                  <em>Edit</em>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="venue-deal-control-metrics" aria-label="Club Deal performance summary">
          <span><small>Confirmed taps</small><strong>{String(revenue?.confirmedCashierTapsThisMonth || 0)}</strong></span>
          <span><small>Redemption intents</small><strong>{String(revenue?.passesIssuedThisMonth || 0)}</strong></span>
          <span><small>Outstanding</small><strong>{formatCents(Number(revenue?.pendingVenuePaymentCents || 0))}</strong></span>
        </div>
        <div className="venue-deal-control-actions">
          <button className="venue-deal-control-primary" id="venue-deal-primary-action" type="button" onClick={() => openDealEditor(primaryDeal ? "primary" : "new")}>
            {liveCount > 1 ? "Manage live deals" : liveDeal ? "Edit live deal" : primaryDeal ? "Continue draft" : "Create Club Deal"}
          </button>
          {venueSlug && liveCount ? <Link href={`/venues/${encodeURIComponent(venueSlug)}`}>Preview live {liveCount === 1 ? "deal" : "deals"}</Link> : null}
        </div>
      </section>
      <details className="venue-deal-editor" ref={editorRef}>
        <summary>
          <span><strong>Manage club deals</strong><small>Create, edit, publish, or pause offers</small></span>
          <em>{deals.length} {deals.length === 1 ? "deal" : "deals"}</em>
        </summary>
        <div className="venue-deal-editor-body">
          <p className="venue-deal-placement-note">
            Your existing MyDancr cashier sticker automatically opens current live deals—no setup changes required.
          </p>
          <div className="venue-deal-counts" aria-label="Club Deal totals">
            <span><strong>{liveCount}</strong> live</span>
            <span><strong>{draftCount}</strong> {draftCount === 1 ? "draft" : "drafts"}</span>
          </div>
          <div className="venue-deal-list" aria-label="Venue Club Deals">
            {deals.map((deal) => (
              <button
                aria-pressed={String(deal.id) === editingId}
                className={String(deal.id) === editingId ? "selected" : ""}
                key={String(deal.id)}
                type="button"
                onClick={() => editDeal(deal)}
              >
                <span>{dealTypeLabel(String(deal.offerType || "admission"))}</span>
                <strong>{String(deal.dealTitle || "Untitled offer")}</strong>
                <small className={deal.isActive ? "is-live" : undefined}>{deal.isActive ? "Live" : "Draft"}</small>
              </button>
            ))}
            <button aria-pressed={!editingId} className={`add${!editingId ? " selected" : ""}`} type="button" onClick={addDeal}>
              <span>New Club Deal</span>
              <strong>+ Create Club Deal</strong>
              <small>Keeps current live deals active</small>
            </button>
          </div>
          <form onSubmit={saveDeal}>
        <fieldset className="venue-deal-builder-step">
          <legend><span>1</span><span><strong>Offer</strong><small>What guests receive</small></span></legend>
          <div className="venue-deal-step-grid">
            <label className="deal-wide-field">
              Deal offered
              <select value={form.dealTitle} onChange={(event) => selectDealOffer(event.target.value)}>
                {CLUB_DEAL_OFFER_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.title}>{preset.title}</option>
                ))}
              </select>
              <small>MyDancr Club Deals are limited to these two clear admission offers.</small>
            </label>
            <label className="deal-wide-field">
              Offer details
              <textarea
                maxLength={500}
                minLength={8}
                readOnly
                required
                rows={3}
                value={form.dealDescription}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="venue-deal-builder-step">
          <legend><span>2</span><span><strong>Rules</strong><small>What guests need to know</small></span></legend>
          <div className="venue-deal-step-grid one-column">
            <label>
              Conditions (optional)
              <textarea
                maxLength={1200}
                rows={3}
                value={form.dealTerms}
                onChange={(event) => updateDealForm("dealTerms", event.target.value)}
              />
            </label>
            <p className="venue-deal-rule-note">Add only the conditions guests need to see before redeeming.</p>
          </div>
        </fieldset>

        <fieldset className="venue-deal-builder-step">
          <legend><span>3</span><span><strong>Agreement & order</strong><small>Contract fee and public position</small></span></legend>
          <div className="venue-deal-step-grid">
            <section className="venue-referral-agreement" aria-label="MyDancr referral fee agreement">
              <span>MyDancr referral fee</span>
              <strong>{currentReferralFee ? `${formatCents(Number(currentReferralFee.feeCents || 0))} per verified guest` : "Agreement required"}</strong>
              <small>
                {currentReferralFee
                  ? `MyDancr-controlled agreement · effective ${formatDashboardDate(String(currentReferralFee.effectiveFrom || ""))}`
                  : "MyDancr must record a signed venue agreement before a deal can go live."}
              </small>
              {pendingFeeRequest ? (
                <em>Change requested: {formatCents(Number(pendingFeeRequest.requestedFeeCents || 0))} · awaiting MyDancr review</em>
              ) : (
                <button className="secondary" type="button" onClick={() => setShowFeeRequest((current) => !current)}>
                  {showFeeRequest ? "Cancel request" : "Request fee change"}
                </button>
              )}
            </section>
            <label>
              Display order
              <input
                min="0"
                max="1000"
                type="number"
                value={form.sortOrder}
                onChange={(event) => updateDealForm("sortOrder", event.target.value)}
              />
              <small>Lower numbers appear first when several deals are live.</small>
            </label>
          </div>
          {showFeeRequest && !pendingFeeRequest ? (
            <div className="venue-referral-request-panel">
              <label>
                Requested fee per verified guest
                <span className="currency-input"><span>$</span><input inputMode="decimal" placeholder="20.00" value={requestedFee} onChange={(event) => setRequestedFee(event.target.value)} /></span>
              </label>
              <label>
                Reason for change
                <textarea maxLength={500} minLength={10} rows={3} value={feeRequestReason} onChange={(event) => setFeeRequestReason(event.target.value)} />
              </label>
              <button disabled={isRequestingFee} type="button" onClick={() => void requestFeeChange()}>
                {isRequestingFee ? "Sending…" : "Send request to MyDancr"}
              </button>
            </div>
          ) : null}
          {feeRequestStatus ? <p className="venue-deal-feedback" role="status">{feeRequestStatus}</p> : null}
        </fieldset>

        <fieldset className="venue-deal-builder-step review">
          <legend><span>4</span><span><strong>Review & publish</strong><small>This action only changes this deal</small></span></legend>
          <dl className="venue-deal-review">
            <div><dt>Offer</dt><dd>{form.dealTitle.trim() || "Enter a deal title above"}</dd></div>
            <div><dt>Type</dt><dd>{dealTypeLabel(form.offerType)}</dd></div>
            <div><dt>Referral fee</dt><dd>{currentReferralFee ? `${formatCents(Number(currentReferralFee.feeCents || 0))} per verified guest` : "Agreement required"}</dd></div>
            <div><dt>Status</dt><dd>{form.isActive ? "Live" : "Draft"}</dd></div>
          </dl>
          {form.isActive ? (
            <p className="venue-deal-live-edit-note">
              Save edits without unpublishing this deal.
            </p>
          ) : null}
          <div className="venue-deal-form-actions">
            <button
              className="primary"
              aria-live="polite"
              disabled={isSaving}
              name="dealAction"
              type="submit"
              value={form.isActive ? "save" : "publish"}
            >
              {isSaving ? "Saving..." : saveConfirmed ? "Saved Changes" : form.isActive ? "Save changes" : "Publish Club Deal"}
            </button>
            <button
              className="secondary"
              disabled={isSaving}
              name="dealAction"
              title={form.isActive ? "Takes this deal offline until you publish it again" : undefined}
              type="submit"
              value={form.isActive ? "unpublish" : "draft"}
            >
              {form.isActive ? "Pause Deal" : "Save Draft"}
            </button>
            {editingId ? <button className="danger" disabled={isSaving} type="button" onClick={deleteDeal}>Delete Deal</button> : null}
          </div>
          {form.isActive ? (
            <small className="venue-deal-unpublish-note">
              Pausing removes this deal from MyDancr until you publish it again.
            </small>
          ) : null}
        </fieldset>
        {status ? (
          <p className="venue-deal-feedback" role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
          </form>
          {editingId ? (
            <section className={form.isActive ? "venue-deal-publish-status live" : "venue-deal-publish-status"} aria-live="polite">
              <div className="venue-deal-publish-status-heading">
                <span aria-hidden="true">{form.isActive ? "✓" : "•"}</span>
                <div>
                  <strong>{form.isActive ? "Live on MyDancr" : "Draft — not live"}</strong>
                  <small>{form.isActive ? "Available wherever your Club Deals appear." : "Publish this deal when it is ready for guests."}</small>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </details>
      <section className={liveCount ? "venue-deal-nfc-status is-live" : "venue-deal-nfc-status"} aria-labelledby="venue-deal-nfc-heading">
        <div aria-hidden="true">)))</div>
        <section>
          <span className="eyebrow">Cashier sticker</span>
          <h3 id="venue-deal-nfc-heading">{liveCount ? "Ready for redemption" : "Waiting for a live deal"}</h3>
          <p>{liveCount ? "Guests can redeem a live deal with any active cashier sticker assigned to your venue." : "Publish a deal to make it available at the cashier."}</p>
          <small>Sticker status is managed in Assigned tap access.</small>
        </section>
      </section>
      <details className="venue-deal-how">
        <summary>How Club Deals work</summary>
        <div>
          <p>
            Publish a deal and MyDancr shows it on your venue page and eligible Working Now dancer profiles.
          </p>
          <p>
            Guests select a deal and tap your MyDancr cashier sticker. MyDancr records the confirmed redemption, attribution, and referral fee.
          </p>
        </div>
      </details>
      <details className="venue-deal-performance">
        <summary><span><strong>Performance & invoices</strong><small>Detailed redemptions, fees, and settlement</small></span></summary>
        <div className="venue-deal-performance-body">
          <div className="deal-metrics venue-deal-metrics">
            <Metric label="Confirmed cashier taps this month" value={String(revenue?.confirmedCashierTapsThisMonth || 0)} />
            <Metric label="Dancer attributed" value={String(revenue?.dancerAttributedRedemptionsThisMonth || 0)} />
            <Metric label="Direct venue" value={String(revenue?.directVenueRedemptionsThisMonth || 0)} />
            <Metric label="MyDancr referral fees" value={formatCents(Number(revenue?.myDancrFeesCentsThisMonth || 0))} />
            <Metric label="Outstanding to MyDancr" value={formatCents(Number(revenue?.pendingVenuePaymentCents || 0))} />
            <Metric label="Redemption intents" value={String(revenue?.passesIssuedThisMonth || 0)} />
            <Metric label="Saved / opened" value={`${String(revenue?.savesThisMonth || 0)} / ${String(revenue?.scannerOpensThisMonth || 0)}`} />
          </div>
          <VenueFinanceSummary finance={finance} />
        </div>
      </details>
    </article>
  );
}

function upsertVenueDeal(
  currentDeals: Array<Record<string, unknown>>,
  savedDeal: Record<string, unknown>,
) {
  const exists = currentDeals.some((deal) => String(deal.id) === String(savedDeal.id));
  const nextDeals = exists
    ? currentDeals.map((deal) => String(deal.id) === String(savedDeal.id) ? savedDeal : deal)
    : [...currentDeals, savedDeal];
  return nextDeals.sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

function venueDealForm(deal?: Record<string, unknown> | null, fallbackOrder = 0) {
  const preset = clubDealOfferPresetForTitle(deal?.dealTitle) || defaultClubDealOfferPreset();
  return {
    dealTitle: preset.title,
    dealDescription: preset.description,
    dealTerms: String(deal?.dealTerms || preset.terms),
    isActive: deal?.isActive === true,
    offerType: "admission",
    sortOrder: String(deal?.sortOrder ?? fallbackOrder * 10),
  };
}

function dealTypeLabel(value: string) {
  if (value === "other") return "Other";
  return "Admission";
}

function dollarsToCents(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents >= 100 && cents <= 100_000 ? cents : null;
}

function VenueFinanceSummary({ finance }: { finance?: LoadState["finance"] }) {
  const [status, setStatus] = useState("");
  const invoices = Array.isArray(finance?.invoices) ? finance.invoices as Array<Record<string, unknown>> : [];
  const openInvoices = invoices.filter((invoice) => ["open", "overdue"].includes(String(invoice.status)));
  const outstandingCents = openInvoices.reduce(
    (total, invoice) => total + Math.max(0, Number(invoice.amount_due_cents || 0) - Number(invoice.amount_paid_cents || 0)),
    0,
  );
  const currentMonth = new Date().toISOString().slice(0, 7);

  async function downloadStatement() {
    setStatus("Preparing statement...");
    try {
      await downloadDashboardBlob(
        await requestVenueFinanceStatement(currentMonth),
        `mydancr-${currentMonth}-club-statement.csv`,
      );
      setStatus("Statement downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download statement.");
    }
  }

  return (
    <section className="finance-summary" aria-labelledby="venue-finance-heading">
      <div className="venue-deal-heading">
        <div>
          <span className="eyebrow">Settlement</span>
          <h3 id="venue-finance-heading">Club invoices</h3>
        </div>
        <strong className={openInvoices.some((invoice) => String(invoice.status) === "overdue") ? "deal-state" : "deal-state active"}>
          {openInvoices.some((invoice) => String(invoice.status) === "overdue") ? "Payment overdue" : `${openInvoices.length} open`}
        </strong>
      </div>
      <div className="deal-metrics">
        <Metric label="Outstanding" value={formatCents(outstandingCents)} />
        <Metric label="Payment terms" value={`${String((finance?.account as Record<string, unknown> | undefined)?.payment_terms_days || 15)} days`} />
      </div>
      {openInvoices.length ? (
        <div className="commission-tier-table" aria-label="Open Club Deal commission invoices">
          {openInvoices.slice(0, 6).map((invoice) => (
            <div key={String(invoice.id)}>
              <span>{String(invoice.period_start).slice(0, 7)} · {String(invoice.status)}</span>
              <b>{formatCents(Number(invoice.amount_due_cents || 0) - Number(invoice.amount_paid_cents || 0))}</b>
              <span>Due {formatFinanceDate(invoice.due_at)}</span>
              {invoice.hosted_invoice_url ? <a href={String(invoice.hosted_invoice_url)} rel="noreferrer" target="_blank">Pay securely</a> : null}
              {invoice.invoice_pdf_url ? <a href={String(invoice.invoice_pdf_url)} rel="noreferrer" target="_blank">PDF</a> : null}
            </div>
          ))}
        </div>
      ) : <p>No open club invoices.</p>}
      <button type="button" onClick={downloadStatement}>Download monthly statement</button>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}

function CustomerPreferencesPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown> | null | undefined) => void;
  profile?: LoadState["profile"];
}) {
  const [city, setCity] = useState("Las Vegas");
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCity(String(profile?.city || "Las Vegas"));
    setSettings({
      followedDancersOnly: readSetting(profile, "followedDancersOnly", true),
      followedVenuesOnly: readSetting(profile, "followedVenuesOnly", true),
      anyDancerInCity: readSetting(profile, "anyDancerInCity", false),
      workingTonight: readSetting(profile, "workingTonight", true),
      newShifts: readSetting(profile, "newShifts", true),
      venueSchedules: readSetting(profile, "venueSchedules", true),
      clubChanges: readSetting(profile, "clubChanges", true),
      cancelledShifts: readSetting(profile, "cancelledShifts", true),
    });
  }, [profile]);

  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const data = await requestCustomerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city, notificationSettings: settings }),
        fallbackMessage: "Unable to save preferences.",
      });
      onProfileChange?.(data.profile);
      setStatus("Preferences saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save preferences.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="info-panel customer-settings-panel">
      <h2>Notification Settings</h2>
      <form onSubmit={savePreferences}>
        <label className="city-field">
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        {CUSTOMER_NOTIFICATION_OPTIONS.map((option) => (
          <label className="check-row" key={option.key}>
            <input
              checked={Boolean(settings[option.key])}
              type="checkbox"
              onChange={(event) => setSettings((current) => ({ ...current, [option.key]: event.target.checked }))}
            />
            {option.label}
          </label>
        ))}
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save preferences"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
    </article>
  );
}

const CUSTOMER_NOTIFICATION_OPTIONS = [
  { key: "followedDancersOnly", label: "Followed dancers only" },
  { key: "followedVenuesOnly", label: "Followed clubs only" },
  { key: "anyDancerInCity", label: "Any dancer in city" },
  { key: "workingTonight", label: "Working now" },
  { key: "newShifts", label: "New shifts" },
  { key: "venueSchedules", label: "Venue schedules" },
  { key: "clubChanges", label: "Club changes" },
  { key: "cancelledShifts", label: "Cancelled shifts" },
];

function readSetting(profile: LoadState["profile"], key: string, fallback: boolean) {
  const settings = profile?.notificationSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const value = (settings as Record<string, unknown>)[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

type DancerIdentityDraft = { stageName: string; city: string };

type DancerPreviewVideo = {
  id: string;
  videoUrl: string;
  durationSeconds: number;
};

const DANCER_PREVIEW_SOCIAL_PLATFORMS = new Set<SocialPlatform>(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);
const DANCER_PROFILE_EDITOR_SAVE_EVENT = "mydancr:dancer-profile-editor-save";

type DancerProfileEditorSaveRequest = {
  tasks: Array<() => Promise<boolean>>;
};

type DancerProfileEditorSectionId = "identity" | "avatar" | "photos" | "videos" | "socials" | "share";

type DancerProfileSocialEditor = (
  platform: SocialPlatform,
  controls: { onClose: () => void },
) => ReactNode;

type DancerProfileEditorSections = Partial<Record<Exclude<DancerProfileEditorSectionId, "socials">, ReactNode>> & {
  socials?: DancerProfileSocialEditor;
};

type DancerProfileBuilderRequirement = {
  complete: boolean;
  label: string;
  section: DancerProfileEditorSectionId;
  status: string;
};

const DANCER_PROFILE_EDITOR_SECTION_LABELS: Record<DancerProfileEditorSectionId, string> = {
  identity: "Stage name & city",
  avatar: "Add profile photo",
  photos: "Photos",
  videos: "Videos",
  socials: "Socials",
  share: "Share profile",
};

async function saveDancerProfileEditor() {
  const detail: DancerProfileEditorSaveRequest = { tasks: [] };
  window.dispatchEvent(new CustomEvent<DancerProfileEditorSaveRequest>(DANCER_PROFILE_EDITOR_SAVE_EVENT, { detail }));
  // Compact editors persist when their own Save/Done action completes and then
  // unmount. No registered task therefore means there is nothing left to save,
  // not that the profile save failed.
  if (!detail.tasks.length) return true;
  for (const task of detail.tasks) {
    if (!await task()) return false;
  }
  return true;
}

function DancerProfilePreview({
  builderRequirements,
  buttonClassName,
  buttonLabel,
  editorSections,
  isApproved = false,
  isPublic = false,
  name,
  city,
  onClose,
  onEditorSave,
  profile,
  saveLabel = "Save profile",
}: {
  builderRequirements?: DancerProfileBuilderRequirement[];
  buttonClassName: string;
  buttonLabel: string;
  editorSections?: DancerProfileEditorSections;
  isApproved?: boolean;
  isPublic?: boolean;
  name?: string;
  city?: string;
  onClose?: () => void;
  onEditorSave?: () => Promise<boolean>;
  profile?: LoadState["profile"];
  saveLabel?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState<DancerProfileEditorSectionId | null>(null);
  const [activeSocialPlatform, setActiveSocialPlatform] = useState<SocialPlatform | null>(null);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [isSectionSaving, setIsSectionSaving] = useState(false);
  const [sectionStatus, setSectionStatus] = useState("");
  const [editorStatus, setEditorStatus] = useState("");
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [videos, setVideos] = useState<DancerPreviewVideo[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const activeEditorSectionRef = useRef<DancerProfileEditorSectionId | null>(null);
  const persistedName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const profilePhotoItems = dancerPhotoItemsFromProfile(profile);
  const approvedPhotos = profilePhotoItems.filter((photo) => photo.status === "approved");
  const previewImage = avatarUrl || approvedPhotos[0]?.imageUrl || "";
  const previewName = name?.trim() || persistedName || "Your stage name";
  const previewCity = city?.trim() || persistedCity || "Choose your city";
  const photos = approvedPhotos.map((photo) => ({ id: photo.id, imageUrl: photo.imageUrl }));
  const socialLinks = dancerPreviewSocialLinks(profile);
  const isEditor = Boolean(editorSections);
  const isOnboardingEditor = isEditor && Boolean(builderRequirements?.length) && !isApproved;
  const headerImage = isEditor ? avatarUrl : previewImage;
  const completedRequirements = builderRequirements?.filter((requirement) => requirement.complete).length || 0;
  const requirementsComplete = !builderRequirements?.length || completedRequirements === builderRequirements.length;
  const closeActiveEditor = useCallback(() => {
    const platform = activeSocialPlatform;
    const section = activeEditorSectionRef.current;
    setActiveEditorSection(null);
    setActiveSocialPlatform(null);
    setSectionStatus("");
    if (platform) {
      window.requestAnimationFrame(() => {
        document.getElementById(`dancer-social-trigger-${platform}`)?.focus({ preventScroll: true });
      });
    } else if (section) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-profile-editor-trigger="${section}"]`)?.focus({ preventScroll: true });
      });
    }
  }, [activeSocialPlatform]);
  const activeEditorContent = activeEditorSection && activeEditorSection !== "socials"
    ? editorSections?.[activeEditorSection]
    : null;
  const socialEditorContent = activeSocialPlatform
    ? editorSections?.socials?.(activeSocialPlatform, { onClose: closeActiveEditor })
    : null;
  const activeEditorLabel = activeEditorSection && activeEditorSection !== "socials"
    ? DANCER_PROFILE_EDITOR_SECTION_LABELS[activeEditorSection]
    : "";
  onCloseRef.current = onClose;
  activeEditorSectionRef.current = activeEditorSection;

  const closePreview = useCallback(() => {
    setActiveEditorSection(null);
    setActiveSocialPlatform(null);
    setIsOpen(false);
    onCloseRef.current?.();
  }, []);

  function openEditorSection(section: Exclude<DancerProfileEditorSectionId, "socials">) {
    if (!editorSections?.[section]) return;
    setSectionStatus("");
    setActiveSocialPlatform(null);
    setActiveEditorSection(section);
  }

  function openSocialEditor(platform: SocialPlatform) {
    if (!editorSections?.socials) return;
    setActiveSocialPlatform(platform);
    setActiveEditorSection("socials");
  }

  useEffect(() => {
    if (!isOpen || !activeEditorSection) return;
    const frame = window.requestAnimationFrame(() => {
      if (activeEditorSection === "socials" && activeSocialPlatform) {
        document.getElementById(`dancer-social-${activeSocialPlatform}`)?.focus({ preventScroll: true });
        return;
      }
      document.getElementById("dancer-profile-builder-panel")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeEditorSection, activeSocialPlatform, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const scrollY = scrollRef.current;
    const body = document.body;
    const trigger = triggerRef.current;
    const previous = {
      left: body.style.left,
      overflow: body.style.overflow,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (activeEditorSectionRef.current === "socials") {
          document.querySelector<HTMLButtonElement>("[data-social-modal-close]")?.click();
          return;
        }
        if (activeEditorSectionRef.current) {
          closeActiveEditor();
          return;
        }
        closePreview();
        return;
      }
      if (event.key !== "Tab") return;
      const focusRoot = activeEditorSectionRef.current
        ? document.getElementById("dancer-profile-builder-panel")
        : overlayRef.current;
      const focusable = Array.from(
        focusRoot?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => !element.closest("[hidden]") && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo({ top: scrollY, behavior: "auto" });
      window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    };
  }, [closeActiveEditor, closePreview, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!readSession()?.accessToken) {
      setIsMediaLoading(false);
      setVideos([]);
      setMediaError("Sign in again to load your saved profile videos.");
      return;
    }

    let cancelled = false;
    let refreshTimer = 0;
    let requestSequence = 0;
    const loadVideos = async (showLoading = false) => {
      const requestId = ++requestSequence;
      if (showLoading) setIsMediaLoading(true);
      setMediaError("");
      try {
        const data = await requestDancerTvVideosJson({
          cache: "no-store",
          fallbackMessage: "Unable to load your saved profile videos.",
        });
        if (cancelled || requestId !== requestSequence) return;
        const savedVideos = Array.isArray(data?.videos) ? data.videos : [];
        setVideos(savedVideos.flatMap((video: Record<string, unknown>) => {
          const id = String(video?.id || "").trim();
          const videoUrl = String(video?.videoUrl || "").trim();
          if (String(video?.status || "").toLowerCase() !== "approved" || !id || !videoUrl) return [];
          return [{
            id,
            videoUrl,
            durationSeconds: Math.max(0, Number(video?.durationSeconds || 0)),
          }];
        }));
        const hasProcessingVideo = savedVideos.some((video: Record<string, unknown>) => {
          const status = String(video?.status || "").toLowerCase();
          return status === "uploading" || status === "moderating";
        });
        window.clearTimeout(refreshTimer);
        if (hasProcessingVideo) {
          refreshTimer = window.setTimeout(() => void loadVideos(), 1_800);
        }
      } catch (error) {
        if (cancelled || requestId !== requestSequence) return;
        setMediaError(error instanceof Error ? error.message : "Unable to load your saved profile videos.");
      } finally {
        if (!cancelled && requestId === requestSequence && showLoading) setIsMediaLoading(false);
      }
    };
    const refreshAfterVideoChange = () => {
      window.clearTimeout(refreshTimer);
      void loadVideos();
    };

    setVideos([]);
    void loadVideos(true);
    window.addEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);

    return () => {
      cancelled = true;
      requestSequence += 1;
      window.clearTimeout(refreshTimer);
      window.removeEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !editorSections?.photos) return;
    const keepPhotosOpen = () => setActiveEditorSection("photos");
    window.addEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
    return () => window.removeEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
  }, [editorSections?.photos, isOpen]);

  function openPreview() {
    scrollRef.current = window.scrollY;
    setActiveEditorSection(null);
    setActiveSocialPlatform(null);
    setEditorStatus("");
    setIsOpen(true);
  }

  async function saveEditor() {
    if (!onEditorSave || isEditorSaving) return;
    setIsEditorSaving(true);
    setEditorStatus("Saving your profile...");
    try {
      const saved = await onEditorSave();
      if (!saved) {
        setEditorStatus("A profile section could not be saved. Reopen the section you changed and review its message.");
        return;
      }
      setEditorStatus("Profile saved.");
      closePreview();
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : "Unable to save your profile.");
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function finishActiveEditor() {
    if (!activeEditorSection || isSectionSaving) return;
    if (activeEditorSection !== "identity") {
      closeActiveEditor();
      return;
    }

    setIsSectionSaving(true);
    setSectionStatus("Saving...");
    try {
      const saved = await saveDancerProfileEditor();
      if (!saved) {
        setSectionStatus("Check the fields above and try again.");
        return;
      }
      closeActiveEditor();
    } catch (error) {
      setSectionStatus(error instanceof Error ? error.message : "Unable to save your profile details.");
    } finally {
      setIsSectionSaving(false);
    }
  }

  return (
    <>
      <button className={buttonClassName} onClick={openPreview} ref={triggerRef} type="button">
        {buttonLabel}
      </button>
      {isOpen ? (
        <div
          aria-labelledby="dancer-profile-preview-heading"
          aria-modal="true"
          className={`dancer-profile-preview-overlay${isEditor ? " is-editor" : ""}`}
          ref={overlayRef}
          role="dialog"
        >
          <div className="public-profile-shell dancer-profile-preview-shell">
            <header className="profile-titlebar">
              {isEditor ? (
                <span className="dancer-profile-builder-avatar-control">
                  <button
                    aria-label={headerImage ? "Edit avatar" : "Add avatar"}
                    className={`profile-titlebar-avatar dancer-profile-builder-avatar${headerImage ? " has-photo" : " is-empty"}`}
                    data-profile-editor-trigger="avatar"
                    onClick={() => openEditorSection("avatar")}
                    type="button"
                  >
                    {headerImage ? <img alt="" src={headerImage} /> : (
                      <svg aria-hidden="true" className="dancer-profile-builder-avatar-add" viewBox="0 0 24 24">
                        <path d="M12 6v12M6 12h12" />
                      </svg>
                    )}
                    <i aria-hidden="true">
                      {headerImage ? "✎" : (
                        <svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8" /></svg>
                      )}
                    </i>
                  </button>
                  <small>Avatar</small>
                </span>
              ) : (
                <span className={`profile-titlebar-avatar${headerImage ? " has-photo" : ""}`}>
                  {headerImage ? <img alt="" src={headerImage} /> : previewName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="profile-titlebar-identity">
                <div>
                  {isEditor ? (
                    <button className="dancer-profile-builder-identity" data-profile-editor-trigger="identity" onClick={() => openEditorSection("identity")} type="button">
                      <span className="dancer-profile-builder-name" id="dancer-profile-preview-heading">{name?.trim() || persistedName || "Stage name"}</span>
                      <span aria-hidden="true">{name?.trim() || persistedName ? "✎" : "+"}</span>
                    </button>
                  ) : <h1 id="dancer-profile-preview-heading">{previewName}</h1>}
                  {isApproved ? <span className="profile-verified" aria-label="Verified dancer">✓</span> : null}
                </div>
                <div className="profile-titlebar-context">
                  {isEditor ? (
                    <button className="profile-titlebar-city dancer-profile-builder-city" data-profile-editor-trigger="identity" onClick={() => openEditorSection("identity")} type="button">
                      {city?.trim() || persistedCity || "Add city"}<span aria-hidden="true">{city?.trim() || persistedCity ? "✎" : "+"}</span>
                    </button>
                  ) : <span className="profile-titlebar-city">{previewCity}</span>}
                </div>
              </div>
              <button
                aria-label="Close profile preview"
                className="public-profile-close"
                onClick={closePreview}
                ref={closeRef}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
              </button>
            </header>
            {isOnboardingEditor ? (
              <section className="dancer-profile-builder-media-slots" aria-label="Add profile pictures and videos">
                <div className="dancer-profile-builder-slot-group">
                  <header>
                    <span><strong>Pictures</strong><small>Add 1 picture now. You can add more later.</small></span>
                    <b>{profilePhotoItems.length} added</b>
                  </header>
                  <div className="dancer-profile-builder-slot-grid" aria-label="Five picture slots and add more">
                    {Array.from({ length: DANCER_ONBOARDING_MEDIA_PREVIEW_SLOTS }, (_, index) => {
                      const photo = profilePhotoItems[index];
                      return (
                        <button
                          aria-label={photo ? `Edit picture ${index + 1}` : `Add picture ${index + 1}`}
                          className={`dancer-profile-builder-slot${photo ? " has-media" : " is-empty"}`}
                          key={`picture-slot-${index}`}
                          onClick={() => openEditorSection("photos")}
                          type="button"
                        >
                          {photo?.imageUrl ? <img alt="" src={photo.imageUrl} /> : <span aria-hidden="true">+</span>}
                          <small>{photo ? photo.status === "pending" ? "Checking" : photo.status === "rejected" ? "Replace" : `Picture ${index + 1}` : `Picture ${index + 1}`}</small>
                        </button>
                      );
                    })}
                    <button className="dancer-profile-builder-slot is-more" data-profile-editor-trigger="photos" onClick={() => openEditorSection("photos")} type="button">
                      <span aria-hidden="true">+</span><strong>Add more</strong><small>Manage pictures</small>
                    </button>
                  </div>
                </div>
                <div className="dancer-profile-builder-slot-group">
                  <header>
                    <span><strong>Videos</strong><small>Optional. You can add videos now or later.</small></span>
                    <b>{videos.length} added</b>
                  </header>
                  <div className="dancer-profile-builder-slot-grid" aria-label="Five video slots and add more">
                    {Array.from({ length: DANCER_ONBOARDING_MEDIA_PREVIEW_SLOTS }, (_, index) => {
                      const video = videos[index];
                      return (
                        <button
                          aria-label={video ? `Edit video ${index + 1}` : `Add video ${index + 1}`}
                          className={`dancer-profile-builder-slot is-video${video ? " has-media" : " is-empty"}`}
                          key={`video-slot-${index}`}
                          onClick={() => openEditorSection("videos")}
                          type="button"
                        >
                          {video ? (
                            <video
                              aria-hidden="true"
                              muted
                              playsInline
                              preload="metadata"
                              src={video.videoUrl}
                              onLoadedMetadata={(event) => primeVideoPreviewFrame(event.currentTarget)}
                            />
                          ) : <span aria-hidden="true">+</span>}
                          {video ? <i aria-hidden="true">▶</i> : null}
                          <small>{video ? `Video ${index + 1}` : `Video ${index + 1}`}</small>
                        </button>
                      );
                    })}
                    <button className="dancer-profile-builder-slot is-more" data-profile-editor-trigger="videos" onClick={() => openEditorSection("videos")} type="button">
                      <span aria-hidden="true">+</span><strong>Add more</strong><small>Manage videos</small>
                    </button>
                  </div>
                </div>
              </section>
            ) : isEditor && !photos.length && !videos.length ? (
              <section className="profile-media-section dancer-profile-builder-empty-media" aria-label="Add profile media">
                <div className="profile-media-tabs" role="group" aria-label="Add photos or videos">
                  <button aria-label="Add profile photos" className="active" onClick={() => openEditorSection("photos")} type="button">
                    <svg aria-hidden="true" className="profile-media-tab-icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8.5" cy="9" r="1.5" /><path d="m5 17 4.5-4.5 3.2 3.2 2.2-2.2L19 17" /></svg>
                    <span className="profile-media-tab-label">Photos</span>
                    <span className="profile-media-tab-count" aria-hidden="true">+</span>
                  </button>
                  <button aria-label="Add profile videos" onClick={() => openEditorSection("videos")} type="button">
                    <svg aria-hidden="true" className="profile-media-tab-icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /><path className="profile-media-tab-play" d="m10 9 5 3-5 3Z" /></svg>
                    <span className="profile-media-tab-label">Videos</span>
                    <span className="profile-media-tab-count" aria-hidden="true">+</span>
                  </button>
                </div>
                <div className="profile-media-grid dancer-profile-builder-empty-slots" aria-label="Empty photo grid preview">
                  {Array.from({ length: 6 }, (_, index) => (
                    <button aria-label={`Add photo ${index + 1}`} key={index} onClick={() => openEditorSection("photos")} type="button">+</button>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <DancerPhotoCarousel photos={photos} stageName={previewName} videos={videos} />
                {isEditor ? (
                  <div className="dancer-profile-builder-media-actions" aria-label="Edit profile media">
                    <button onClick={() => openEditorSection("photos")} type="button"><span aria-hidden="true">+</span>{photos.length ? "Edit photos" : "Add photos"}</button>
                    <button onClick={() => openEditorSection("videos")} type="button"><span aria-hidden="true">+</span>{videos.length ? "Edit videos" : "Add videos"}</button>
                  </div>
                ) : null}
              </>
            )}
            {isEditor && !isOnboardingEditor ? (
              <>
                <section className="profile-tonight-card dancer-profile-builder-tonight" aria-label="Tonight">
                  <div className="profile-shift-card profile-schedule-section is-empty" aria-labelledby="dancer-profile-builder-schedule-heading">
                    <div className="profile-section-heading">
                      <div><span className="eyebrow">Tonight</span><h2 id="dancer-profile-builder-schedule-heading">No shift posted</h2></div>
                    </div>
                    <p>This dancer has not posted an upcoming shift yet. Follow or turn on notifications to see the next update.</p>
                  </div>
                  <div className="profile-tonight-deal" aria-label="Club Deal status">
                    <VenueQrUnavailable availability="not-available-now" venueName={previewCity} />
                  </div>
                </section>
                <DancerProfileActionsPreview onShare={editorSections?.share ? () => openEditorSection("share") : undefined} />
              </>
            ) : null}
            {isEditor ? (
              <section className="profile-social-section dancer-profile-builder-socials" aria-labelledby="dancer-profile-builder-social-heading">
                <div className="social-links-control">
                  <div className="social-list-heading">
                    <h2 id="dancer-profile-builder-social-heading">Social Links</h2>
                    <p>Optional. Add whichever profiles you want, or skip this for now.</p>
                  </div>
                  <div className="social-list dancer-profile-builder-social-platforms" aria-label="Add social links">
                    {SOCIAL_PLATFORMS.map((platform) => {
                      const hasLink = socialLinks.some((link) => link.platform === platform.key);
                      return (
                        <button
                          aria-label={`${hasLink ? "Edit" : "Add"} ${platform.label}`}
                          className={`social-link social-link-${platform.key} dancer-profile-builder-social-platform${hasLink ? " is-added" : ""}`}
                          id={`dancer-social-trigger-${platform.key}`}
                          key={platform.key}
                          onClick={() => openSocialEditor(platform.key)}
                          title={`${hasLink ? "Edit" : "Add"} ${platform.label}`}
                          type="button"
                        >
                          <SocialPlatformIcon platform={platform.key} />
                          <span aria-hidden="true">{hasLink ? "✓" : "+"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : socialLinks.length ? (
              <section className="profile-social-section" aria-labelledby="profile-social-heading">
                <SocialLinks dancerId={String(profile?.id || "private-preview")} heading="Socials" links={socialLinks} showConnectLabel={false} trackClicks={false} />
              </section>
            ) : null}
            {isEditor && !isOnboardingEditor ? (
              <section className="profile-overview" aria-label={`${previewName} profile summary`}>
                <dl className="profile-metrics" aria-label="Profile activity">
                  <div><dd>0</dd><dt>Followers</dt></div><div><dd>0</dd><dt>Going</dt></div><div><dd>0</dd><dt>Views today</dt></div>
                </dl>
              </section>
            ) : !isEditor ? (
              <section className="profile-schedule-section dancer-profile-preview-status" aria-labelledby="dancer-profile-preview-status-heading">
                <div className="profile-section-heading"><div><span className="eyebrow">{isApproved ? "Guest view" : "Private preview"}</span><h2 id="dancer-profile-preview-status-heading">{isApproved ? "Public profile preview" : "Guest profile preview"}</h2></div><span>{approvedPhotos.length} photos · {videos.length} videos</span></div>
                <p>{isMediaLoading ? "Loading your approved profile videos. " : mediaError ? `${mediaError} ` : "Approved photos and videos appear in the media switcher above. "}{socialLinks.length ? `${socialLinks.length} saved social ${socialLinks.length === 1 ? "link is" : "links are"} included in this preview. ` : "Saved social links will appear here. "}{isApproved ? isPublic ? "This is how your approved profile appears to guests." : "Your approved profile is currently hidden from guests while you are incognito." : "Your profile stays private until every setup step is complete."}</p>
              </section>
            ) : null}
            {isEditor && activeEditorSection === "socials" && socialEditorContent ? socialEditorContent : null}
            {isEditor && activeEditorSection && activeEditorSection !== "socials" && activeEditorContent ? (
              <div
                className="dancer-profile-editor-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && !isSectionSaving) closeActiveEditor();
                }}
              >
                <section
                  aria-labelledby="dancer-profile-builder-panel-heading"
                  aria-modal="true"
                  className="dancer-profile-builder-panel dancer-profile-editor-modal"
                  data-section={activeEditorSection}
                  id="dancer-profile-builder-panel"
                  role="dialog"
                  tabIndex={-1}
                >
                  <header>
                    <h2 id="dancer-profile-builder-panel-heading">{activeEditorLabel}</h2>
                    <button aria-label={`Close ${activeEditorLabel} editor`} disabled={isSectionSaving} onClick={closeActiveEditor} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                  </header>
                  <div className="dancer-profile-editor-modal-body">{activeEditorContent}</div>
                  {(["identity", "avatar", "photos", "videos"] as DancerProfileEditorSectionId[]).includes(activeEditorSection) ? (
                    <footer className="dancer-profile-editor-modal-actions">
                      {sectionStatus ? <p role="status" aria-live="polite">{sectionStatus}</p> : <span />}
                      <button disabled={isSectionSaving} onClick={() => void finishActiveEditor()} type="button">
                        {isSectionSaving ? "Saving..." : activeEditorSection === "identity" ? "Save" : "Done"}
                      </button>
                    </footer>
                  ) : null}
                </section>
              </div>
            ) : null}
            {isEditor && onEditorSave ? (
              <footer className="dancer-profile-editor-footer">
                <p role="status" aria-live="polite">{editorStatus || (builderRequirements?.length ? `Profile essentials: ${completedRequirements}/${builderRequirements.length} complete` : "Save changes when finished")}</p>
                <button disabled={isEditorSaving || !requirementsComplete} onClick={() => void saveEditor()} type="button">
                  {isEditorSaving ? "Saving..." : saveLabel}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function DancerOnboardingCommand({
  effectiveStatus,
  finance,
  isVenueApproved,
  onProfileChange,
  profile,
  profileMediaContent,
  venueVerificationContent,
}: {
  effectiveStatus: string;
  finance?: LoadState["finance"];
  isVenueApproved: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  profileMediaContent: (controls: { continueToReview: () => void; profileReady: boolean }) => ReactNode;
  venueVerificationContent: ReactNode;
}) {
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPayoutWorking, setIsPayoutWorking] = useState(false);
  const [payoutSkipped, setPayoutSkipped] = useState(false);
  const [payoutStatus, setPayoutStatus] = useState("");
  const [natsLoginId, setNatsLoginId] = useState("");
  const [natsUsername, setNatsUsername] = useState("");
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const persistedStageName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const photos = dancerPhotoItemsFromProfile(profile);
  const approvedPhotos = photos.filter((photo) => photo.status === "approved");
  const pendingPhotos = photos.filter((photo) => photo.status === "pending");
  const rejectedPhotos = photos.filter((photo) => photo.status === "rejected");
  const profileStarted = Boolean(
    persistedStageName
    || persistedCity
    || avatarUrl
    || Object.keys(pendingAvatar || {}).length
    || photos.length,
  );
  const profileReady = Boolean(
    persistedStageName
    && persistedCity
    && avatarUrl
    && approvedPhotos.length,
  );
  const submitted = effectiveStatus === "pending_review" || effectiveStatus === "approved";
  const commissionPlatform = (finance?.commissionPlatform || {}) as Record<string, unknown>;
  const natsAffiliateAccount = (finance?.natsAffiliateAccount || null) as Record<string, unknown> | null;
  const natsSelected = commissionPlatform.selected === true;
  const natsConfigured = commissionPlatform.configured === true;
  const natsPortalUrl = typeof commissionPlatform.affiliatePortalUrl === "string" ? commissionPlatform.affiliatePortalUrl : "";
  const natsAccountStatus = String(natsAffiliateAccount?.status || "");
  const payoutSubmitted = natsAccountStatus === "requested" || natsAccountStatus === "active";
  const payoutStepComplete = payoutSubmitted || payoutSkipped;
  const payoutSkipKey = `mydancr:dancer-payout-setup-later:${String(profile?.id || "profile")}`;
  const setupDetail = profileReady
    ? "Identity, avatar, and at least one profile picture are approved. Other media can finish review separately."
    : dancerProfileSetupBlocker({ persistedStageName, persistedCity, avatarUrl, pendingAvatar, approvedPhotos, pendingPhotos, rejectedPhotos });
  const steps = useMemo(() => [
    {
      id: "dancer-profile-media",
      label: "Create & review profile",
      complete: submitted,
      detail: submitted ? "Your completed profile is ready for club verification." : profileReady ? "Review your full profile, then submit it for club verification." : setupDetail,
      locked: false,
    },
    {
      id: "dancer-onboarding-payouts",
      label: "Commission payouts",
      complete: payoutStepComplete,
      detail: natsAccountStatus === "active"
        ? "Your payout account is connected."
        : natsAccountStatus === "requested"
          ? "Payout account verification is pending."
          : payoutSkipped
            ? "Set up later from Earnings."
            : submitted
              ? "Connect your payout account now or set it up later."
              : "Submit your profile before starting optional payout setup.",
      locked: !submitted,
      optional: true,
    },
    {
      id: "dancer-onboarding-nfc",
      label: "Dressing-room tap",
      complete: isVenueApproved,
      detail: isVenueApproved ? "An official MyDancr dressing-room tap authorized your venue." : submitted ? "At the club, tap its official dressing-room sticker." : "Create, review, and submit your profile to unlock club verification.",
      locked: !submitted && !isVenueApproved,
    },
  ], [isVenueApproved, natsAccountStatus, payoutSkipped, payoutStepComplete, profileReady, setupDetail, submitted]);
  const firstIncomplete = steps.find((step) => !step.complete) || steps[steps.length - 1];
  const visibleExpandedStepId = expandedStepId || "";
  const storageKey = `mydancr:dancer-onboarding-step:${String(profile?.id || "profile")}`;

  useEffect(() => {
    setPayoutSkipped(window.localStorage.getItem(payoutSkipKey) === "true");
  }, [payoutSkipKey]);

  useEffect(() => {
    if (!profile?.id) return;
    window.localStorage.removeItem(storageKey);
  }, [profile?.id, storageKey]);

  useEffect(() => {
    const keepPhotosOpen = () => {
      window.localStorage.setItem(storageKey, "dancer-profile-media");
      setExpandedStepId("dancer-profile-media");
    };
    window.addEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
    return () => window.removeEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
  }, [storageKey]);

  function openStep(id: string) {
    const step = steps.find((candidate) => candidate.id === id);
    if (!step || step.locked) return;
    window.localStorage.setItem(storageKey, id);
    setExpandedStepId(id);
    window.requestAnimationFrame(() => {
      const section = document.getElementById(id);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById(`${id}-button`)?.focus({ preventScroll: true });
    });
  }

  function toggleStep(id: string) {
    const step = steps.find((candidate) => candidate.id === id);
    if (!step || step.locked) return;
    if (visibleExpandedStepId === id) {
      setExpandedStepId("");
      window.localStorage.removeItem(storageKey);
      return;
    }
    openStep(id);
  }

  function continueToProfileReview() {
    setExpandedStepId("dancer-profile-media");
    window.localStorage.setItem(storageKey, "dancer-profile-media");
    window.requestAnimationFrame(() => {
      document.getElementById("dancer-onboarding-profile-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector<HTMLButtonElement>("#dancer-onboarding-profile-review .dancer-onboarding-preview-open")?.focus({ preventScroll: true });
    });
  }

  async function submitProfile() {
    if (isSubmitting || !profileReady) return;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in again before continuing to club verification.");
      return;
    }
    setIsSubmitting(true);
    setStatus("Preparing your profile for club verification...");
    try {
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submitForReview: true }),
        fallbackMessage: "Unable to submit profile.",
      });
      if (!data.profile) throw new Error("Unable to submit profile.");
      const confirmedStatus = effectiveDancerProfileStatus(data.profile);
      if (confirmedStatus !== "pending_review" && confirmedStatus !== "approved") {
        throw new Error("Club verification was not unlocked. Please try again.");
      }
      onProfileChange?.(data.profile);
      window.localStorage.setItem(storageKey, "dancer-onboarding-payouts");
      setExpandedStepId("dancer-onboarding-payouts");
      setStatus("Profile submitted. Choose whether to set up payouts, then continue to the club tap.");
      window.requestAnimationFrame(() => {
        document.getElementById("dancer-onboarding-payouts")?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("dancer-onboarding-payouts-button")?.focus({ preventScroll: true });
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit profile.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function continueToNfc(message: string) {
    window.localStorage.setItem(storageKey, "dancer-onboarding-nfc");
    setExpandedStepId("dancer-onboarding-nfc");
    setPayoutStatus(message);
    window.requestAnimationFrame(() => {
      document.getElementById("dancer-onboarding-nfc")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("dancer-onboarding-nfc-button")?.focus({ preventScroll: true });
    });
  }

  function skipPayoutSetup() {
    window.localStorage.setItem(payoutSkipKey, "true");
    setPayoutSkipped(true);
    continueToNfc("Payout setup saved for later.");
  }

  async function requestOnboardingNatsLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setPayoutStatus("Sign in again to set up payouts.");
    setIsPayoutWorking(true);
    setPayoutStatus("Submitting your payout account for verification...");
    try {
      await requestDancerFinanceJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_nats_link", loginId: natsLoginId, username: natsUsername }),
        fallbackMessage: "Unable to link the payout account.",
      });
      window.localStorage.removeItem(payoutSkipKey);
      setPayoutSkipped(false);
      continueToNfc("Payout account submitted for verification. You can complete the club tap now.");
    } catch (error) {
      setPayoutStatus(error instanceof Error ? error.message : "Unable to link the payout account.");
    } finally {
      setIsPayoutWorking(false);
    }
  }

  return (
    <section className="dancer-onboarding-command" aria-labelledby="dancer-onboarding-heading">
      <div className="dancer-onboarding-command-head">
        <span>
          <span className="eyebrow">Setup checklist</span>
          <h2 id="dancer-onboarding-heading">Profile setup</h2>
          <p>Complete your profile, choose whether to set up payouts now, then authorize your first venue at the club.</p>
        </span>
        <b>{steps.filter((step) => step.complete).length} of {steps.length} complete</b>
      </div>
      <ol className="dancer-onboarding-steps" aria-label="Dancer profile approval progress">
        {steps.map((step, index) => {
          const open = visibleExpandedStepId === step.id;
          const isPayoutStep = step.id === "dancer-onboarding-payouts";
          const displayComplete = step.complete && (!isPayoutStep || natsAccountStatus === "active");
          const controlLabel = step.locked
            ? "Locked"
            : displayComplete
              ? "Complete"
              : step.id === "dancer-profile-media"
                ? profileStarted ? "Continue" : "Start"
                : isPayoutStep
                  ? natsSelected || natsAccountStatus === "requested" ? "Continue" : "Set up"
                  : "Verify";
          const controlTone = step.locked ? "locked" : displayComplete ? "complete" : "action";
          const panelId = `${step.id}-panel`;
          return (
            <li
              className={`${displayComplete ? "is-complete" : step.id === firstIncomplete.id ? "is-current" : ""} ${open ? "is-open" : ""} ${step.locked ? "is-locked" : ""} ${isPayoutStep && payoutSkipped ? "is-deferred" : ""}`.trim()}
              id={step.id}
              key={step.id}
            >
              <button
                aria-label={`${step.label}. ${step.detail} ${controlLabel}.`}
                aria-controls={panelId}
                aria-current={step.id === firstIncomplete.id ? "step" : undefined}
                aria-disabled={step.locked}
                aria-expanded={open}
                disabled={step.locked}
                id={`${step.id}-button`}
                onClick={() => toggleStep(step.id)}
                type="button"
              >
                <span className="dancer-onboarding-step-marker" aria-hidden="true">{index + 1}</span>
                <span className="dancer-onboarding-step-copy">
                  <span className="dancer-onboarding-step-title">
                    <strong>{step.label}</strong>
                    {step.optional ? <em>Optional</em> : null}
                  </span>
                  <small>{step.detail}</small>
                </span>
                <span className={`dancer-onboarding-step-control is-${controlTone}`} aria-hidden="true">
                  {controlTone === "locked" ? (
                    <svg className="dancer-onboarding-step-control-icon" viewBox="0 0 24 24">
                      <rect x="5" y="10" width="14" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  ) : (
                    <>
                      {controlTone === "complete" ? <span className="dancer-onboarding-step-check">✓</span> : null}
                      <span>{controlLabel}</span>
                      <svg className={`dancer-onboarding-step-control-chevron ${open ? "is-open" : ""}`} viewBox="0 0 24 24">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </>
                  )}
                </span>
              </button>
              <div
                aria-labelledby={`${step.id}-button`}
                className="dancer-onboarding-step-panel"
                hidden={!open}
                id={panelId}
                role="region"
              >
                {step.id === "dancer-profile-media" ? (
                  <>
                    {profileMediaContent({
                      continueToReview: continueToProfileReview,
                      profileReady,
                    })}
                    <div className="dancer-onboarding-preview-workspace dancer-onboarding-profile-review" id="dancer-onboarding-profile-review">
                      <div className="dancer-onboarding-review-action">
                        <span className="eyebrow">Final review</span>
                        <h3>Review and submit profile</h3>
                        <p>Check the full profile guests will see, then continue to club verification.</p>
                        <DancerProfilePreview
                          buttonClassName="dancer-onboarding-preview-open"
                          buttonLabel="Review full profile"
                          profile={profile}
                        />
                      </div>
                      {submitted ? (
                        <div className="dancer-onboarding-complete-note" role="status">
                          <strong>✓ Step 1 complete</strong>
                          <span>Your profile is ready. Set up payouts now or later, then complete the dressing-room tap.</span>
                        </div>
                      ) : (
                        <button className="dancer-onboarding-primary" id="dancer-onboarding-profile-review-button" type="button" disabled={isSubmitting || !profileReady} onClick={() => void submitProfile()}>
                          {isSubmitting ? "Preparing..." : "Continue to club verification"}
                        </button>
                      )}
                      <p className="dancer-onboarding-announcement" role="status" aria-live="polite">
                        {status || "Review and submit your completed profile to open club verification."}
                      </p>
                    </div>
                  </>
                ) : null}
                {step.id === "dancer-onboarding-payouts" ? (
                  <div className="dancer-onboarding-payout-workspace">
                    <article className="dancer-onboarding-payout-card">
                      <span className="eyebrow">Optional</span>
                      <h3>Commission payouts</h3>
                      <p>Connect a payout account to receive your verified Club Deal commissions. Payouts are managed through NATS.</p>
                      {natsAccountStatus === "active" ? <strong className="dancer-onboarding-payout-state is-active">✓ Payout account connected</strong> : null}
                      {natsAccountStatus === "requested" ? <strong className="dancer-onboarding-payout-state">Verification pending</strong> : null}
                      {natsPortalUrl ? <a className="dancer-onboarding-preview-open" href={natsPortalUrl} rel="noreferrer" target="_blank">Create or open payout account</a> : null}
                      {natsSelected && !payoutSubmitted ? (
                        <form className="account-form dancer-onboarding-payout-form" onSubmit={requestOnboardingNatsLink}>
                          <label>Payout account login ID <span>from NATS</span><input required inputMode="numeric" pattern="[1-9][0-9]*" value={natsLoginId} onChange={(event) => setNatsLoginId(event.target.value)} /></label>
                          <label>Payout account username <span>optional</span><input autoCapitalize="none" maxLength={80} value={natsUsername} onChange={(event) => setNatsUsername(event.target.value)} /></label>
                          <button disabled={isPayoutWorking || !natsConfigured} type="submit">{isPayoutWorking ? "Submitting..." : "Submit payout account"}</button>
                        </form>
                      ) : null}
                    </article>
                    <div className="dancer-onboarding-payout-actions">
                      {payoutSubmitted ? <button className="dancer-onboarding-primary" type="button" onClick={() => continueToNfc("Payout setup recorded. Continue with the official club tap.")}>Continue to club tap</button> : null}
                      <button className="dancer-onboarding-secondary" type="button" onClick={skipPayoutSetup}>Do this later</button>
                    </div>
                    {payoutStatus ? <p className="dancer-onboarding-announcement" role="status" aria-live="polite">{payoutStatus}</p> : null}
                  </div>
                ) : null}
                {step.id === "dancer-onboarding-nfc" ? venueVerificationContent : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function dancerPreviewSocialLinks(profile?: LoadState["profile"]) {
  const rows = Array.isArray(profile?.social_links) ? profile.social_links : [];
  return rows.flatMap((value, index) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
    const platform = String(row?.platform || "").toLowerCase() as SocialPlatform;
    const url = String(row?.url || "").trim();
    if (!row || row.is_active === false || !DANCER_PREVIEW_SOCIAL_PLATFORMS.has(platform) || !url) return [];
    return [{
      id: String(row.id || `preview-${platform}-${index}`),
      platform,
      handle: String(row.handle || ""),
      url,
    }];
  });
}

function dancerProfileSetupBlocker({
  persistedStageName,
  persistedCity,
  avatarUrl,
  pendingAvatar,
  approvedPhotos,
  pendingPhotos,
  rejectedPhotos,
}: {
  persistedStageName: string;
  persistedCity: string;
  avatarUrl: string;
  pendingAvatar?: Record<string, unknown>;
  approvedPhotos: DancerPhotoItem[];
  pendingPhotos: DancerPhotoItem[];
  rejectedPhotos: DancerPhotoItem[];
}) {
  if (!persistedStageName || !persistedCity) return "Save your stage name and city.";
  if (pendingAvatar) return "Your avatar is being moderated.";
  if (!avatarUrl) return "Upload a clear face avatar.";
  if (pendingPhotos.length) return `${pendingPhotos.length} profile ${pendingPhotos.length === 1 ? "picture is" : "pictures are"} still being moderated.`;
  if (rejectedPhotos.length) return "Replace the profile picture that did not pass moderation.";
  if (!approvedPhotos.length) return "Upload at least one profile picture that passes moderation.";
  return "Save the remaining profile changes.";
}

function persistedStageNameAndCity(profile?: LoadState["profile"]) {
  return Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
}

function persistedDancerStageName(profile?: LoadState["profile"]) {
  const identitySavedAt = String(profile?.identity_saved_at || profile?.identitySavedAt || "").trim();
  if (!identitySavedAt) return "";
  return String(profile?.stage_name || profile?.stageName || "").trim();
}

type DancerStepOneItemState = "complete" | "checking" | "missing" | "replace" | "unsaved";

function dancerStepOneStateLabel(state: DancerStepOneItemState) {
  if (state === "complete") return "Complete";
  if (state === "checking") return "Checking";
  if (state === "replace") return "Choose another";
  if (state === "unsaved") return "Unsaved changes";
  return "Missing";
}

function DancerOnboardingProfileMediaWorkspace({
  avatarContent,
  continueToReview,
  draftIdentity,
  identityContent,
  photoContent,
  profile,
  profileReady,
  socialContent,
  videoContent,
}: {
  avatarContent: ReactNode;
  continueToReview: () => void;
  draftIdentity: DancerIdentityDraft;
  identityContent: ReactNode;
  photoContent: ReactNode;
  profile?: LoadState["profile"];
  profileReady: boolean;
  socialContent: DancerProfileSocialEditor;
  videoContent: ReactNode;
}) {
  const persistedStageName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const photos = dancerPhotoItemsFromProfile(profile);
  const approvedPhotos = photos.filter((photo) => photo.status === "approved");
  const pendingPhotos = photos.filter((photo) => photo.status === "pending");
  const rejectedPhotos = photos.filter((photo) => photo.status === "rejected");
  const draftChanged = draftIdentity.stageName.trim() !== persistedStageName
    || draftIdentity.city.trim() !== persistedCity;
  const identityState: DancerStepOneItemState = draftChanged
    ? "unsaved"
    : persistedStageName && persistedCity
      ? "complete"
      : "missing";
  const avatarState: DancerStepOneItemState = pendingAvatar
    ? "checking"
    : avatarUrl
      ? "complete"
      : "missing";
  const photoState: DancerStepOneItemState = approvedPhotos.length
    ? "complete"
    : pendingPhotos.length
      ? "checking"
      : rejectedPhotos.length
        ? "replace"
        : "missing";
  const photoDetail = [
    `${photos.length} ${photos.length === 1 ? "picture" : "pictures"} added`,
    `${approvedPhotos.length} approved`,
    pendingPhotos.length ? `${pendingPhotos.length} checking` : "",
    rejectedPhotos.length ? `${rejectedPhotos.length} needs replacement` : "",
  ].filter(Boolean).join(" · ");
  const [continueAfterSave, setContinueAfterSave] = useState(false);
  const readyAfterSave = Boolean(
    draftIdentity.stageName.trim()
    && draftIdentity.city.trim()
    && avatarUrl
    && approvedPhotos.length,
  );

  useEffect(() => {
    if (!continueAfterSave || !profileReady) return;
    setContinueAfterSave(false);
    continueToReview();
  }, [continueAfterSave, continueToReview, profileReady]);

  async function saveAndContinue() {
    if (!readyAfterSave) return false;
    const saved = await saveDancerProfileEditor();
    if (saved) setContinueAfterSave(true);
    return saved;
  }

  const builderRequirements: DancerProfileBuilderRequirement[] = [
    { complete: Boolean(draftIdentity.stageName.trim() && draftIdentity.city.trim()), label: "Stage name & city", section: "identity", status: dancerStepOneStateLabel(identityState) },
    { complete: avatarState === "complete", label: "Avatar", section: "avatar", status: dancerStepOneStateLabel(avatarState) },
    { complete: photoState === "complete", label: "Profile photo", section: "photos", status: photoDetail },
  ];
  const editorSections: DancerProfileEditorSections = {
    identity: identityContent,
    avatar: avatarContent,
    photos: photoContent,
    videos: videoContent,
    socials: socialContent,
  };

  return (
    <article className="dancer-profile-editor-launch-card" aria-labelledby="dancer-profile-setup-launch-heading">
      <span>
        <strong id="dancer-profile-setup-launch-heading">Build your profile</strong>
      </span>
      <DancerProfilePreview
        builderRequirements={builderRequirements}
        buttonClassName="dancer-profile-editor-launch-button"
        buttonLabel={profileReady ? "Review profile setup" : "Open profile setup"}
        city={draftIdentity.city}
        editorSections={editorSections}
        name={draftIdentity.stageName}
        onEditorSave={saveAndContinue}
        profile={profile}
        saveLabel="Save & continue"
      />
    </article>
  );
}

function openDancerPayoutLinking() {
  const performanceSection = document.getElementById("dancer-performance") as HTMLDetailsElement | null;
  const payoutSection = document.getElementById("dancer-payout-detail") as HTMLDetailsElement | null;
  if (performanceSection) performanceSection.open = true;
  if (payoutSection) payoutSection.open = true;
  window.requestAnimationFrame(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    (payoutSection || performanceSection)?.scrollIntoView({ behavior, block: "start" });
  });
}

function dancerNeedsCommissionPayoutSetup(finance?: LoadState["finance"]) {
  const account = (finance?.natsAffiliateAccount || null) as Record<string, unknown> | null;
  const accountStatus = String(account?.status || "").toLowerCase();
  return !["requested", "active"].includes(accountStatus);
}

function DancerNatsSignupCallout({ finance }: { finance?: LoadState["finance"] }) {
  const platform = (finance?.commissionPlatform || {}) as Record<string, unknown>;
  if (!dancerNeedsCommissionPayoutSetup(finance)) return null;
  const portalUrl = typeof platform.affiliatePortalUrl === "string" ? platform.affiliatePortalUrl : "";
  const supportRequestUrl = "mailto:support@mydancr.com?subject=Commission%20payout%20account%20setup";
  return (
    <aside className="dancer-nats-signup-callout" aria-labelledby="dancer-nats-signup-heading">
      <span className="dancer-nats-signup-copy">
        <span className="eyebrow">Club Deal commissions</span>
        <strong id="dancer-nats-signup-heading">Get paid your commissions</strong>
        <small>Sign up for a commission payout account to receive the Club Deal commissions you earn.</small>
      </span>
      <span className="dancer-nats-signup-actions">
        <a href={portalUrl || supportRequestUrl} rel={portalUrl ? "noreferrer" : undefined} target={portalUrl ? "_blank" : undefined}>Sign up for commission payouts</a>
        {platform.selected === true
          ? <button onClick={openDancerPayoutLinking} type="button">I already have an account</button>
          : <a className="secondary" href={`${supportRequestUrl}&body=I%20already%20have%20a%20payout%20account%20and%20need%20to%20link%20it%20to%20MyDancr.`}>I already have an account</a>}
      </span>
    </aside>
  );
}

function DancerPanel({
  accountState,
  affiliations,
  analytics,
  deals,
  finance,
  nfc,
  onProfileChange,
  profile,
  rankingEvents,
  reviews,
  weeklyReport,
}: {
  accountState?: string;
  affiliations: Array<Record<string, unknown>>;
  analytics?: LoadState["analytics"];
  deals?: LoadState["deals"];
  finance?: LoadState["finance"];
  nfc?: LoadState["nfc"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  rankingEvents?: LoadState["rankingEvents"];
  reviews?: LoadState["reviews"];
  weeklyReport?: LoadState["weeklyReport"];
}) {
  const effectiveStatus = effectiveDancerProfileStatus(profile, accountState);
  const isApproved = effectiveStatus === "approved";
  const isPublic = isApproved && profile?.is_public !== false && profile?.isPublic !== false;
  const needsCommissionPayoutSetup = dancerNeedsCommissionPayoutSetup(finance);
  const isVenueApproved = Boolean(profile?.venue_approved_at || profile?.venueApprovedAt)
    || affiliations.some((item) => item.status === "active");
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [deletedPhotoStoragePaths, setDeletedPhotoStoragePaths] = useState<string[]>([]);
  const [draftIdentity, setDraftIdentity] = useState(() => ({
    stageName: persistedDancerStageName(profile),
    city: String(profile?.city || ""),
  }));

  useEffect(() => {
    if (isApproved || effectiveStatus !== "pending_review") return;
    let cancelled = false;
    let refreshInFlight = false;
    const refreshProfile = async () => {
      if (cancelled || document.visibilityState !== "visible" || refreshInFlight) return;
      refreshInFlight = true;
      const session = readSession();
      if (!session?.accessToken) {
        refreshInFlight = false;
        return;
      }
      try {
        const data = await requestDancerProfileJson({
          cache: "no-store",
          fallbackMessage: "Unable to refresh dancer profile.",
        });
        if (!cancelled && data.profile) onProfileChange?.(data.profile);
      } catch {
        // The visible dashboard remains usable and the next interval retries quietly.
      } finally {
        refreshInFlight = false;
      }
    };
    void refreshProfile();
    const interval = window.setInterval(refreshProfile, 8_000);
    document.addEventListener("visibilitychange", refreshProfile);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshProfile);
    };
  }, [effectiveStatus, isApproved, onProfileChange]);

  const refreshDancerProfile = useCallback(async () => {
    const session = readSession();
    if (!session?.accessToken) return;
    const data = await requestDancerProfileJson({
      cache: "no-store",
      fallbackMessage: "Unable to refresh dancer profile.",
    });
    if (!data.profile) throw new Error("Unable to refresh dancer profile.");
    onProfileChange?.(data.profile);
  }, [onProfileChange]);

  const identityContent = (
    <DancerSetupPanel
      deletedPhotoIds={deletedPhotoIds}
      deletedPhotoStoragePaths={deletedPhotoStoragePaths}
      onDeletedPhotoIdsSaved={() => {
        setDeletedPhotoIds([]);
        setDeletedPhotoStoragePaths([]);
      }}
      profile={profile}
      onProfileChange={onProfileChange}
      onDraftChange={setDraftIdentity}
      unifiedSave
    />
  );
  const avatarContent = <DancerAvatarPanel profile={profile} onProfileChange={onProfileChange} />;
  const socialContent: DancerProfileSocialEditor = (platform, controls) => (
    <SocialLinkModal
      onClose={controls.onClose}
      onProfileChange={onProfileChange}
      platform={platform}
      profile={profile}
      unifiedSave
    />
  );
  const photoContent = (
    <DancerPhotoPanel
      deletedPhotoIds={deletedPhotoIds}
      deletedPhotoStoragePaths={deletedPhotoStoragePaths}
      onDeletedPhotoIdsChange={setDeletedPhotoIds}
      onDeletedPhotoStoragePathsChange={setDeletedPhotoStoragePaths}
      profile={profile}
      onProfileChange={onProfileChange}
    />
  );
  const videoContent = <DancerTvStudio embedded />;
  const profileEditorSections: DancerProfileEditorSections = {
    identity: identityContent,
    avatar: avatarContent,
    photos: photoContent,
    videos: videoContent,
    socials: socialContent,
    share: <DancerSharePanel profile={profile} />,
  };
  const profileMediaWorkspace = (
    <div className="venue-dashboard-inner-grid dancer-onboarding-profile-workspace">
      <article className="dancer-profile-media-preview" aria-labelledby="dancer-profile-media-preview-heading">
        <span className="dancer-profile-media-preview-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M2.8 12s3.2-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>
        </span>
        <span className="dancer-profile-media-preview-copy">
          <strong id="dancer-profile-media-preview-heading">Edit profile</strong>
        </span>
        <DancerProfilePreview
          buttonClassName="dancer-profile-media-preview-button"
          buttonLabel="Edit full profile"
          city={draftIdentity.city}
          editorSections={profileEditorSections}
          isApproved
          isPublic={isPublic}
          name={draftIdentity.stageName}
          onClose={() => {
            const section = document.getElementById("dancer-profile-media") as HTMLDetailsElement | null;
            if (section) section.open = false;
          }}
          onEditorSave={saveDancerProfileEditor}
          profile={profile}
          saveLabel="Save & return to dashboard"
        />
      </article>
    </div>
  );
  const profileMediaSection = (
    <DashboardSection
      description="Edit your identity, media, socials, and share your profile."
      emphasis="primary"
      id="dancer-profile-media"
      title="Profile & media"
    >
      {profileMediaWorkspace}
    </DashboardSection>
  );

  return (
    <>
      <DancerActivationConfirmation
        affiliations={affiliations}
        isLive={isPublic}
        nfc={nfc}
        profile={profile}
      />
      {!isApproved ? (
        <DancerOnboardingCommand
          effectiveStatus={effectiveStatus}
          finance={finance}
          isVenueApproved={isVenueApproved}
          onProfileChange={onProfileChange}
          profile={profile}
          profileMediaContent={({ continueToReview, profileReady }) => (
            <DancerOnboardingProfileMediaWorkspace
              avatarContent={avatarContent}
              continueToReview={continueToReview}
              draftIdentity={draftIdentity}
              identityContent={identityContent}
              photoContent={photoContent}
              profile={profile}
              profileReady={profileReady}
              socialContent={socialContent}
              videoContent={videoContent}
            />
          )}
          venueVerificationContent={<DancerNfcPanel initialAffiliations={affiliations} initialNfcState={nfc || null} onAuthorizationChange={refreshDancerProfile} />}
        />
      ) : null}
      {isApproved ? (
        <DashboardSection
          description="Approval, venue access, and public visibility."
          emphasis="summary"
          id="dancer-overview"
          title="Profile status"
        >
          <div className="venue-dashboard-inner-grid dancer-overview-grid">
            <div className="dancer-status-metrics" aria-label="Current profile status">
              <Metric label="Stage name" value={persistedDancerStageName(profile) || "Draft"} />
              <Metric label="Status" value="Approved" />
              <Metric label="Dressing-room tap" value={isVenueApproved ? "Authorized" : "Tap required"} />
              <Metric label="Photo review" value={photoStatusLabel(normalizePhotoStatus(profile?.photo_review_status))} />
            </div>
            <DancerNfcPanel
              compactAuthorized
              initialAffiliations={affiliations}
              initialNfcState={nfc || null}
              onAuthorizationChange={refreshDancerProfile}
            />
            <DancerVisibilityPanel profile={profile} onProfileChange={onProfileChange} />
          </div>
        </DashboardSection>
      ) : null}
      {isApproved ? profileMediaSection : null}
      {isApproved ? (
        <DashboardSection
          description="Post and manage shifts shown on your profile."
          emphasis="primary"
          id="dancer-schedule"
          title="Schedule"
        >
          <DancerShiftManager />
        </DashboardSection>
      ) : null}
      {isApproved ? (
        <DashboardSection
          badge={needsCommissionPayoutSetup ? "Payout setup needed" : undefined}
          description="See your reach, rewards, payouts, and weekly progress."
          emphasis="secondary"
          id="dancer-performance"
          title="Performance & rewards"
        >
          <div className="dancer-performance-workspace">
            <DancerNatsSignupCallout finance={finance} />
            <DancerPerformanceSummary analytics={analytics} deals={deals} finance={finance} />
            <div className="dancer-performance-details">
              <DancerPerformanceDetail
                badge={`${String(deals?.successfulRedemptionsThisMonth || 0)} this month`}
                description="Commissions, tier progress, and verified activity."
                title="Club Deal rewards"
              >
                <DancerDealPanel deals={deals} />
              </DancerPerformanceDetail>
              <DancerPerformanceDetail
                badge={formatCents(Number(((finance?.balances || {}) as Record<string, unknown>).availableCents || 0))}
                description="Balances, payout setup, and history."
                id="dancer-payout-detail"
                title="Earnings & payouts"
              >
                <DancerPayoutPanel finance={finance} />
              </DancerPerformanceDetail>
              <DancerPerformanceDetail
                badge={formatRankMove(weeklyReport)}
                description="Follower growth and ranking milestones."
                title="Weekly results"
              >
                <DancerImpactPanel events={rankingEvents} report={weeklyReport} />
              </DancerPerformanceDetail>
            </div>
          </div>
        </DashboardSection>
      ) : null}
    </>
  );
}

function DancerActivationConfirmation({
  affiliations,
  isLive,
  nfc,
  profile,
}: {
  affiliations: Array<Record<string, unknown>>;
  isLive: boolean;
  nfc?: LoadState["nfc"];
  profile?: LoadState["profile"];
}) {
  const [completionRequested, setCompletionRequested] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCompletionRequested(params.get("nfc") === "complete");
  }, []);

  if (!completionRequested || !isLive) return null;

  const enrollment = nfc?.enrollment && typeof nfc.enrollment === "object"
    ? nfc.enrollment as Record<string, unknown>
    : null;
  const enrollmentVenue = enrollment?.venue && typeof enrollment.venue === "object"
    ? enrollment.venue as Record<string, unknown>
    : null;
  const activeAffiliation = affiliations.find((item) => item.status === "active");
  const affiliatedVenue = activeAffiliation?.venue && typeof activeAffiliation.venue === "object"
    ? activeAffiliation.venue as Record<string, unknown>
    : null;
  const venueName = String(enrollmentVenue?.name || affiliatedVenue?.name || "").trim();
  const slug = String(profile?.slug || "").trim();

  function acknowledgeCompletion() {
    const url = new URL(window.location.href);
    url.searchParams.delete("nfc");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setCompletionRequested(false);
  }

  function openProfileManager(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const sectionId = "dancer-profile-media";
    const url = new URL(window.location.href);
    url.searchParams.delete("nfc");
    url.hash = sectionId;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setCompletionRequested(false);
    const section = document.getElementById(sectionId);
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="dancer-activation-confirmation" role="status" aria-live="polite" aria-labelledby="dancer-activation-title">
      <span className="dancer-activation-check" aria-hidden="true">✓</span>
      <div className="dancer-activation-copy">
        <span className="eyebrow">Dancer activation complete</span>
        <h2 id="dancer-activation-title">Your profile is live</h2>
        <p>
          {venueName ? `Approved through ${venueName}. ` : "Your dressing-room tap was approved. "}
          Guests can now discover your profile on MyDancr.
        </p>
        <div className="dancer-activation-actions">
          {slug ? <Link href={`/dancers/${encodeURIComponent(slug)}`} onClick={acknowledgeCompletion}>View live profile</Link> : null}
          <a href="#dancer-profile-media" onClick={openProfileManager}>Manage profile</a>
        </div>
      </div>
      <button type="button" onClick={acknowledgeCompletion} aria-label="Dismiss profile live confirmation">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </section>
  );
}

function DancerVisibilityPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const initialVisible = profile?.is_public !== false && profile?.isPublic !== false;
  const [isPublic, setIsPublic] = useState(initialVisible);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsPublic(profile?.is_public !== false && profile?.isPublic !== false);
  }, [profile]);

  async function toggleVisibility() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const nextPublic = !isPublic;
    setIsSaving(true);
    setStatus(nextPublic ? "Reactivating your public profile..." : "Hiding your profile from the site...");
    try {
      const data = await requestDancerProfileVisibilityJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPublic: nextPublic }),
        fallbackMessage: "Unable to update profile visibility.",
      });
      const savedPublic = data.profile?.is_public === true || data.profile?.isPublic === true;
      if (savedPublic !== nextPublic) throw new Error("Profile visibility did not save. Try again.");
      if (data.visibility?.verified !== true || data.visibility?.publicProfileVisible !== nextPublic) {
        throw new Error("Public profile visibility could not be verified. Try again.");
      }
      if (data.profile) onProfileChange?.({ ...(profile || {}), ...data.profile });
      setIsPublic(savedPublic);
      setStatus(
        savedPublic
          ? "Your profile is back on and visible to guests."
          : "Incognito is on. Your profile was verified hidden from guests. You can turn it back on at any time.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update profile visibility.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className={`info-panel visibility-panel ${isPublic ? "" : "is-incognito"}`}>
      <h2>Profile visibility</h2>
      <div className="visibility-copy">
        <div className="visibility-state" aria-label={`Profile visibility: ${isPublic ? "Public, visible" : "Incognito, hidden"}`}>
          <strong>{isPublic ? "Public" : "Incognito"}</strong>
          <span aria-hidden="true">·</span>
          <b>{isPublic ? "Visible" : "Hidden"}</b>
        </div>
        <p>{isPublic ? "Guests can find your approved profile across MyDancr." : "Your profile is hidden from guests; your dashboard and tools stay available."}</p>
      </div>
      <button className="visibility-toggle" type="button" onClick={toggleVisibility} disabled={isSaving}>
        {isSaving ? "Verifying..." : isPublic ? "Go incognito" : "Make profile public"}
      </button>
      {status ? <p className="visibility-status" role="status" aria-live="polite">{status}</p> : null}
    </article>
  );
}

function DancerLockedAnalyticsPanel() {
  return (
    <article className="info-panel locked-analytics-panel">
      <div className="locked-analytics-head">
        <h2>Analytics</h2>
        <span>Locked</span>
      </div>
      <p>Locked until profile approval.</p>
      <small>Once your profile is approved, you&apos;ll see profile views, attributed deal redemptions, followers, and shift activity here.</small>
      <div className="locked-preview-list" aria-label="Analytics preview">
        <span>Profile views</span>
        <span>Deal redemptions</span>
        <span>Followers</span>
      </div>
    </article>
  );
}

function DancerPerformanceSummary({
  analytics,
  deals,
  finance,
}: {
  analytics?: LoadState["analytics"];
  deals?: LoadState["deals"];
  finance?: LoadState["finance"];
}) {
  const balances = (finance?.balances || {}) as Record<string, unknown>;

  return (
    <section className="dancer-performance-summary" aria-label="Performance and rewards summary">
      <Metric label="Current rank" value={String(analytics?.currentRank || "Unranked")} />
      <Metric label="30-day views" value={String(analytics?.profileViews30Days || 0)} />
      <Metric label="Successful Club Deals" value={String(deals?.successfulRedemptionsThisMonth || 0)} />
      <Metric label="Available rewards" value={formatCents(Number(balances.availableCents || 0))} />
    </section>
  );
}

function DancerPerformanceDetail({
  badge,
  children,
  description,
  id,
  title,
}: {
  badge: string;
  children: ReactNode;
  description: string;
  id?: string;
  title: string;
}) {
  return (
    <details className="dancer-performance-detail" id={id}>
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <b>{badge}</b>
        <i aria-hidden="true">+</i>
      </summary>
      <div className="dancer-performance-detail-body">{children}</div>
    </details>
  );
}

function DancerDealPanel({ deals }: { deals?: LoadState["deals"] }) {
  const earnedCommissionCents = Number(deals?.earnedCommissionCents || 0);
  const payableCommissionCents = Number(deals?.payableCommissionCents || 0);
  const successfulThisMonth = Number(deals?.successfulRedemptionsThisMonth || 0);
  const currentShare = Number(deals?.currentDancerSharePercent || 30);
  const nextTierAt = deals?.nextTierAt === null ? null : Number(deals?.nextTierAt || 10);

  return (
    <article className="info-panel deal-panel" aria-label="Club Deal reward details">
      <div className="deal-metrics">
        <Metric label="MyDancr rewards earned" value={formatCents(earnedCommissionCents)} />
        <Metric label="Ready for MyDancr payout" value={formatCents(payableCommissionCents)} />
        <Metric label="Successful this month" value={String(successfulThisMonth)} />
        <Metric label="Current dancer share" value={`${currentShare}%`} />
      </div>
      <p className="dancer-performance-progress">
        {nextTierAt === null
          ? "Top 50% dancer tier reached"
          : `${String(deals?.redemptionsUntilNextTier || 0)} more successful redemptions to unlock the ${nextTierAt === 10 ? "40%" : "50%"} tier.`}
      </p>
      <details className="dancer-performance-explainer">
        <summary>More Club Deal activity</summary>
        <div className="deal-metrics">
          <Metric label="Saved / shared intent" value={`${String(deals?.qrSaves || 0)} / ${String(deals?.qrShares || 0)}`} />
          <Metric label="Cashier opens" value={String(deals?.qrOpens || 0)} />
          <Metric label="Available / paid" value={`${String(deals?.payableCommissions || 0)} / ${String(deals?.paidCommissions || 0)}`} />
          <Metric label="Reversed" value={String(deals?.rejectedCommissions || 0)} />
        </div>
      </details>
      <details className="dancer-performance-explainer">
        <summary>View commission tiers</summary>
        <div className="commission-tier-table">
          <div><span>1–9 monthly</span><b>30% dancer</b><b>70% MyDancr</b></div>
          <div><span>10–24 monthly</span><b>40% dancer</b><b>60% MyDancr</b></div>
          <div><span>25+ monthly</span><b>50% dancer</b><b>50% MyDancr</b></div>
        </div>
      </details>
      <details className="dancer-performance-explainer">
        <summary>How Club Deal rewards work</summary>
        <p>Your dancer credit follows a verified check-in to the guest&apos;s cashier tap. Successful, server-confirmed redemptions earn commission.</p>
      </details>
    </article>
  );
}

function DancerPayoutPanel({ finance }: { finance?: LoadState["finance"] }) {
  const [status, setStatus] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyView, setHistoryView] = useState<"earnings" | "payouts">("earnings");
  const [isWorking, setIsWorking] = useState(false);
  const [localFinance, setLocalFinance] = useState(finance);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  useEffect(() => setLocalFinance(finance), [finance]);
  const currentFinance = localFinance || finance;
  const payouts = Array.isArray(currentFinance?.payouts) ? currentFinance.payouts as Array<Record<string, unknown>> : [];
  const earnings = Array.isArray(currentFinance?.earnings) ? currentFinance.earnings as Array<Record<string, unknown>> : [];
  const balances = (currentFinance?.balances || {}) as Record<string, unknown>;
  const payoutAccount = (currentFinance?.payoutAccount || null) as Record<string, unknown> | null;
  const settings = (currentFinance?.settings || {}) as Record<string, unknown>;
  const commissionPlatform = (currentFinance?.commissionPlatform || {}) as Record<string, unknown>;
  const natsAffiliateAccount = (currentFinance?.natsAffiliateAccount || null) as Record<string, unknown> | null;
  const natsExports = Array.isArray(currentFinance?.natsExports) ? currentFinance.natsExports as Array<Record<string, unknown>> : [];
  const natsSelected = commissionPlatform.selected === true;
  const natsConfigured = commissionPlatform.configured === true;
  const natsActive = natsAffiliateAccount?.status === "active";
  const natsPortalUrl = typeof commissionPlatform.affiliatePortalUrl === "string" ? commissionPlatform.affiliatePortalUrl : "";
  const [natsLoginId, setNatsLoginId] = useState("");
  const [natsUsername, setNatsUsername] = useState("");
  const visibleEarnings = historyFilter === "all" ? earnings : earnings.filter((earning) => String(earning.status) === historyFilter);
  const payoutsEnabled = settings.payoutsEnabled === true;
  const setupComplete = payoutAccount?.onboarding_status === "complete"
    && payoutAccount?.payout_eligibility === "eligible"
    && payoutAccount?.verification_status === "verified";
  const currentMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("finance");
    if (result === "connected") setStatus("Payout account connected and verified.");
    if (result === "review") setStatus("Payout account connected. The payout provider is reviewing eligibility.");
    if (result === "setup_error") setStatus("Payout setup could not be completed. Please try again.");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  function beginDancerPayoutAction(pendingStatus: string) {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setIsWorking(true);
    setStatus(pendingStatus);
    return { requestId, controller };
  }

  function isCurrentDancerPayoutAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishDancerPayoutAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    if (mountedRef.current) setIsWorking(false);
  }

  async function payoutAction(action: "connect_onboarding" | "cash_out") {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    const pending = beginDancerPayoutAction(action === "cash_out" ? "Checking available earnings..." : "Opening secure payout setup...");
    if (!pending) return;
    const { requestId, controller } = pending;
    try {
      const data = await requestDancerFinanceJson({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action }),
        fallbackMessage: "Unable to update payouts.",
        signal: controller.signal,
      });
      if (!isCurrentDancerPayoutAction(requestId, controller)) return;
      if (data.onboarding?.url) window.location.assign(data.onboarding.url);
      if (data.finance) setLocalFinance(data.finance);
      if (action === "cash_out") setStatus("Cash-out request reserved. Status will update after verified provider confirmation.");
    } catch (error) {
      if (isCurrentDancerPayoutAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to update payouts.");
    } finally {
      finishDancerPayoutAction(requestId);
    }
  }

  async function requestNatsLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    const pending = beginDancerPayoutAction("Submitting your payout account for verification...");
    if (!pending) return;
    const { requestId, controller } = pending;
    try {
      const data = await requestDancerFinanceJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_nats_link", loginId: natsLoginId, username: natsUsername }),
        fallbackMessage: "Unable to link the payout account.",
        signal: controller.signal,
      });
      if (!isCurrentDancerPayoutAction(requestId, controller)) return;
      if (data.finance) setLocalFinance(data.finance);
      setStatus("Payout account submitted. MyDancr will activate it after matching the provider record.");
    } catch (error) {
      if (isCurrentDancerPayoutAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to link the payout account.");
    } finally {
      finishDancerPayoutAction(requestId);
    }
  }

  async function downloadStatement() {
    setStatus("Preparing statement...");
    try {
      await downloadDashboardBlob(
        await requestDancerFinanceStatement(currentMonth),
        `mydancr-${currentMonth}-dancer-commission-statement.csv`,
      );
      setStatus("Statement downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download statement.");
    }
  }

  return (
    <article className="info-panel deal-panel dancer-earnings-panel" aria-labelledby="dancer-payout-heading">
      <div className="venue-deal-heading">
        <div>
          <span className="eyebrow">Commission payouts</span>
          <h2 id="dancer-payout-heading">Payout account</h2>
        </div>
        <strong className={`deal-state ${(natsSelected ? natsActive : payoutsEnabled) ? "active" : ""}`}>
          {natsSelected ? (natsActive ? "Account connected" : natsAffiliateAccount?.status === "requested" ? "Verification pending" : "Setup required") : payoutsEnabled ? "Payouts available" : "Approval pending"}
        </strong>
      </div>
      <div className="deal-metrics earnings-balance-grid">
        <Metric label="Available balance" value={formatCents(Number(balances.availableCents || 0))} />
        <Metric label="Pending earnings" value={formatCents(Number(balances.pendingCents || 0))} />
        <Metric label="Payout processing" value={formatCents(Number(balances.processingCents || 0))} />
        <Metric label="Lifetime earnings" value={formatCents(Number(balances.lifetimeCents || 0))} />
      </div>
      {natsSelected ? (
        <>
          {natsPortalUrl ? <div className="earnings-actions"><a className="button-link" href={natsPortalUrl} target="_blank" rel="noreferrer">{natsActive ? "Open payout account" : "Create or open payout account"}</a></div> : null}
          {!natsActive ? <form className="account-form" onSubmit={requestNatsLink}>
            <label>Payout account login ID <span>from NATS</span><input required inputMode="numeric" pattern="[1-9][0-9]*" value={natsLoginId} onChange={(event) => setNatsLoginId(event.target.value)} /></label>
            <label>Payout account username <span>optional</span><input autoCapitalize="none" maxLength={80} value={natsUsername} onChange={(event) => setNatsUsername(event.target.value)} /></label>
            <button disabled={isWorking || !natsConfigured} type="submit">Submit payout account for verification</button>
          </form> : null}
          {!natsConfigured ? <p className="earnings-notice">Payout setup is temporarily unavailable. Your verified commissions will continue to accrue.</p> : null}
          {natsAffiliateAccount?.last_error ? <p role="alert">{String(natsAffiliateAccount.last_error)}</p> : null}
        </>
      ) : (
        <>
          <div className="earnings-actions">
            <button disabled={isWorking || !payoutsEnabled} type="button" onClick={() => payoutAction("connect_onboarding")}>Set Up Payouts</button>
            <button disabled={isWorking || !payoutsEnabled || Number(balances.availableCents || 0) < Number(settings.minimumPayoutCents || 0)} type="button" onClick={() => payoutAction(setupComplete ? "cash_out" : "connect_onboarding")}>
              {setupComplete ? "Cash Out" : "Cash Out · Set up first"}
            </button>
          </div>
          {!payoutsEnabled ? <p className="earnings-notice">Earnings tracking is active. Real payout setup and money movement remain off until provider and legal approval.</p> : null}
          {payoutAccount?.last_error ? <p role="alert">{String(payoutAccount.last_error)}</p> : null}
        </>
      )}

      <details className="dancer-performance-explainer">
        <summary>How payouts work</summary>
        <div className="dancer-performance-explainer-copy">
          <p>{natsSelected
            ? "MyDancr validates cashier-tap redemptions, calculates your tiered commission, and sends eligible rewards to your verified payout account. Payouts are managed through NATS."
            : "Qualifying Club Deal activity starts as pending and becomes available after review."}</p>
          <p>{natsSelected
            ? "No guest personal information is included."
            : "The approved payout provider securely handles identity, account details, and money movement. MyDancr stores only the provider account reference and payout status."}</p>
        </div>
      </details>

      <section className="earnings-history" aria-label="Rewards history">
        <div className="earnings-history-tabs" role="tablist" aria-label="Rewards history views">
          <button aria-selected={historyView === "earnings"} className={historyView === "earnings" ? "active" : ""} role="tab" type="button" onClick={() => setHistoryView("earnings")}>Earnings history</button>
          <button aria-selected={historyView === "payouts"} className={historyView === "payouts" ? "active" : ""} role="tab" type="button" onClick={() => setHistoryView("payouts")}>Payout history</button>
        </div>
        {historyView === "earnings" ? (
          <>
            <div className="earnings-filters" role="group" aria-label="Filter earnings history">
              {["all", "pending", "available", "paid"].map((filter) => (
                <button className={historyFilter === filter ? "active" : ""} key={filter} type="button" onClick={() => setHistoryFilter(filter)}>
                  {filter[0].toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>
            <div className="commission-tier-table">
              {visibleEarnings.slice(0, 50).map((earning) => (
                <div key={String(earning.id)}>
                  <span>{dancerFinanceVenueName(earning.venues)} · {String(earning.earning_type || "earning").replaceAll("_", " ")}</span>
                  <b>{formatCents(Number(earning.amount_cents || 0))}</b>
                  <span>{formatFinanceDate(earning.created_at)} · {String(earning.status)}</span>
                </div>
              ))}
              {!visibleEarnings.length ? <p>No earnings match this filter.</p> : null}
            </div>
          </>
        ) : natsSelected ? (
          natsExports.length ? <div className="commission-tier-table" aria-label="Recent payout transfers">
            {natsExports.slice(0, 50).map((item) => <div key={String(item.id)}>
              <span>Commission {formatFinanceDate(item.created_at)}</span>
              <b>{formatCents(Number(item.amount_cents || 0))}</b>
              <span>{String(item.status || "pending").replaceAll("_", " ")}</span>
              {item.last_error ? <span role="alert">{String(item.last_error)}</span> : null}
            </div>)}
          </div> : <p>No payout transfers yet.</p>
        ) : payouts.length ? (
          <div className="commission-tier-table" aria-label="Recent dancer payouts">
            {payouts.slice(0, 50).map((payout) => (
              <div key={String(payout.id)}>
                <span>Requested {formatFinanceDate(payout.requested_at || payout.created_at)}</span>
                <b>{formatCents(Number(payout.amount_cents || 0))}</b>
                <span>{String(payout.status)} · {String(payout.payment_provider || "provider")}</span>
                {payout.processing_at ? <span>Processing {formatFinanceDate(payout.processing_at)}</span> : null}
                {payout.paid_at ? <span>Paid {formatFinanceDate(payout.paid_at)}</span> : null}
                {payout.provider_reference_id ? <span>Reference {String(payout.provider_reference_id)}</span> : null}
                {payout.failure_message ? <span role="alert">{String(payout.failure_message)}</span> : null}
              </div>
            ))}
          </div>
        ) : <p>No payout requests yet.</p>}
        <button className="earnings-statement-button" type="button" onClick={downloadStatement}>Download monthly statement</button>
      </section>
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

function dancerFinanceVenueName(value: unknown) {
  const venue = Array.isArray(value) ? value[0] : value;
  return venue && typeof venue === "object" && "name" in venue ? String((venue as { name?: unknown }).name || "Venue") : "Venue";
}

async function downloadDashboardBlob(file: Blob, filename: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatFinanceDate(value: unknown) {
  if (!value) return "Not set";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCents(value: number) {
  return `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DancerSetupPanel({
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  onDeletedPhotoIdsSaved,
  onDraftChange,
  onProfileChange,
  profile,
  unifiedSave = false,
}: {
  deletedPhotoIds?: string[];
  deletedPhotoStoragePaths?: string[];
  onDeletedPhotoIdsSaved?: () => void;
  onDraftChange?: (draft: DancerIdentityDraft) => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  unifiedSave?: boolean;
}) {
  const [stageName, setStageName] = useState("");
  const [city, setCity] = useState("");
  const [cityOptions, setCityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [cityOptionsStatus, setCityOptionsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isResetting, setIsResetting] = useState(false);
  const deletedPhotoIdsRef = useRef<string[]>(deletedPhotoIds);
  const deletedPhotoStoragePathsRef = useRef<string[]>(deletedPhotoStoragePaths);
  const saveInFlightRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const draftKey = `mydancr:dancer-profile-draft:${String(profile?.id || "profile")}`;
  const editorSaveRef = useRef<() => Promise<boolean>>(async () => true);
  editorSaveRef.current = () => saveProfile();

  useEffect(() => {
    console.log("ACTIVE_EDIT_PROFILE_VERSION", "canonical-profile-approval-v14");
  }, []);

  useEffect(() => {
    if (!unifiedSave) return;
    const addSaveTask = (event: Event) => {
      const detail = (event as CustomEvent<DancerProfileEditorSaveRequest>).detail;
      detail?.tasks.push(() => editorSaveRef.current());
    };
    window.addEventListener(DANCER_PROFILE_EDITOR_SAVE_EVENT, addSaveTask);
    return () => window.removeEventListener(DANCER_PROFILE_EDITOR_SAVE_EVENT, addSaveTask);
  }, [unifiedSave]);

  useEffect(() => {
    if (draftDirtyRef.current) return;
    const savedStageName = persistedDancerStageName(profile);
    const profileCity = String(profile?.city || "").trim();
    const matchingCity = cityOptions.find((option) => option.value.toLocaleLowerCase("en-US") === profileCity.toLocaleLowerCase("en-US"));
    const savedCity = cityOptionsStatus === "ready" ? matchingCity?.value || "" : profileCity;
    let nextDraft = { stageName: savedStageName, city: savedCity };
    if (!draftHydratedRef.current) {
      try {
        const stored = JSON.parse(window.localStorage.getItem(draftKey) || "null");
        if (stored && typeof stored === "object") {
          nextDraft = {
            stageName: typeof stored.stageName === "string" ? stored.stageName : savedStageName,
            city: typeof stored.city === "string" ? stored.city : savedCity,
          };
          draftDirtyRef.current = nextDraft.stageName !== savedStageName || nextDraft.city !== savedCity;
        }
      } catch {
        window.localStorage.removeItem(draftKey);
      }
      draftHydratedRef.current = true;
    }
    setStageName(nextDraft.stageName);
    setCity(nextDraft.city);
    onDraftChange?.(nextDraft);
  }, [cityOptions, cityOptionsStatus, draftKey, onDraftChange, profile]);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const draft = { stageName, city };
    onDraftChange?.(draft);
    if (draftDirtyRef.current) window.localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [city, draftKey, onDraftChange, stageName]);

  useEffect(() => {
    let cancelled = false;

    async function loadCityOptions() {
      try {
        const response = await fetch("/api/public/cities", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load available cities.");
        const options = Array.isArray(data.cities)
          ? data.cities.filter((option: any) => Boolean(option?.value && option?.label))
          : [];
        if (!options.length) throw new Error("No dancer signup cities are available.");
        if (!cancelled) {
          setCityOptions(options);
          setCityOptionsStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setCityOptions([]);
          setCityOptionsStatus("error");
        }
      }
    }

    void loadCityOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    if ((deletedPhotoIds.length || deletedPhotoStoragePaths.length) && saveStatus === "saved" && !saveInFlightRef.current) {
      setSaveStatus("idle");
    }
  }, [deletedPhotoIds, deletedPhotoStoragePaths, saveStatus]);

  async function hardResetProfile() {
    if (isResetting || saveInFlightRef.current) return;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    console.log("PUBLIC_PROFILE_STATE_BEFORE_RESET", {
      dancerId: profile?.id || null,
      status: profile?.status ?? null,
      isPublic: profile?.is_public ?? profile?.isPublic ?? null,
      approvedAt: profile?.approved_at ?? null,
      verificationStatus: profile?.verification_status ?? null,
      photoReviewStatus: profile?.photo_review_status ?? null,
    });
    setIsResetting(true);
    setStatus("Reloading the latest saved profile...");
    try {
      const data = await requestDancerProfileJson({
        method: "GET",
        cache: "no-store",
        fallbackMessage: "Unable to reload the saved profile.",
      });
      if (!data.profile) throw new Error("Unable to reload the saved profile.");

      console.log("PUBLIC_PROFILE_STATE_AFTER_RESET", {
        dancerId: data.profile.id || null,
        status: data.profile.status ?? null,
        isPublic: data.profile.is_public ?? data.profile.isPublic ?? null,
        approvedAt: data.profile.approved_at ?? null,
        verificationStatus: data.profile.verification_status ?? null,
        photoReviewStatus: data.profile.photo_review_status ?? null,
      });
      deletedPhotoIdsRef.current = [];
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsSaved?.();
      onProfileChange?.(data.profile);
      draftDirtyRef.current = false;
      window.localStorage.removeItem(draftKey);
      setSaveStatus("idle");
      setStatus("Latest saved profile reloaded.");
    } catch (error) {
      console.error("DANCER_PROFILE_HARD_RESET_FAILED", error);
      setStatus(error instanceof Error ? error.message : "Unable to reload the saved profile.");
    } finally {
      setIsResetting(false);
    }
  }

  async function saveProfile(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saveInFlightRef.current) return false;

    const session = readSession();
    if (!session?.accessToken) {
      setSaveStatus("error");
      setStatus("Sign in required.");
      return false;
    }

    saveInFlightRef.current = true;
    setSaveStatus("saving");
    setStatus("Saving...");
    const idsToDelete = [...deletedPhotoIdsRef.current];
    const storagePathsToDelete = [...deletedPhotoStoragePathsRef.current];

    try {
      const payload = {
        stageName,
        city,
        deletedPhotoIds: idsToDelete,
        deletedPhotoStoragePaths: storagePathsToDelete,
      };
      console.log("EDIT_PROFILE_BEFORE_SAVE", {
        deletedPhotoIds: idsToDelete,
        profilePhotoIds: Array.isArray(profile?.dancer_photos) ? (profile.dancer_photos as Array<any>).map((photo) => photo.id) : [],
      });
      console.log("EDIT_PROFILE_SAVE_PAYLOAD", {
        stageName: Boolean(stageName),
        city,
        deletedPhotoIds: idsToDelete,
        deletedPhotoStoragePathCount: storagePathsToDelete.length,
      });
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        fallbackMessage: "Unable to save profile.",
      });

      const refreshedPhotoRows = [
        ...(Array.isArray(data.profile?.dancer_photos) ? data.profile.dancer_photos : []),
        ...(Array.isArray(data.profile?.pending_photo_reviews) ? data.profile.pending_photo_reviews : []),
      ];
      const refreshedPhotoIds = new Set(refreshedPhotoRows.map((photo: any) => String(photo?.id || "")).filter(Boolean));
      const incorrectlyRestoredIds = idsToDelete.filter((id) => refreshedPhotoIds.has(id));
      const confirmedDeletedIds = new Set((Array.isArray(data.deletedPhotoIds) ? data.deletedPhotoIds : []).map((id: unknown) => String(id)));
      const unconfirmedDeletedIds = idsToDelete.filter((id) => !confirmedDeletedIds.has(id));
      console.log("EDIT_PROFILE_REFETCHED_PHOTOS", {
        photoIds: Array.from(refreshedPhotoIds),
        requestedDeletedIds: idsToDelete,
        confirmedDeletedIds: Array.from(confirmedDeletedIds),
      });
      if (incorrectlyRestoredIds.length) throw new Error("DELETED_PHOTO_RETURNED_AFTER_SAVE");
      if (unconfirmedDeletedIds.length) throw new Error("PROFILE_PHOTO_DELETE_COUNT_MISMATCH");

      if (data.profile) onProfileChange?.(data.profile);
      draftDirtyRef.current = false;
      window.localStorage.removeItem(draftKey);
      deletedPhotoIdsRef.current = [];
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsSaved?.();
      setSaveStatus("saved");
      const hasPendingPhotos = Array.isArray(data.profile?.pending_photo_reviews) && data.profile.pending_photo_reviews.length > 0;
      setStatus(hasPendingPhotos
        ? "Saved Profile. Photos awaiting review will appear on your live profile after approval."
        : "Saved Profile");
      return true;
    } catch (error) {
      console.error("EDIT_PROFILE_SAVE_FAILED", error);
      setSaveStatus("error");
      setStatus(error instanceof Error ? error.message : "Profile could not be saved.");
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  }

  const visibleStatus = status
    || (saveStatus === "saving" ? "Saving changes..." : draftDirtyRef.current ? "Unsaved changes" : saveStatus === "saved" ? "Saved" : "");

  return (
    <article className="info-panel setup-panel dancer-profile-identity-editor">
      {unifiedSave ? null : <h2>Setup</h2>}
      <form className="dancer-profile-identity-form" onSubmit={saveProfile}>
        <label>
          Stage name
          <input className="dancer-stage-name-input" type="text" value={stageName} minLength={2} maxLength={40} autoComplete="nickname" placeholder="Enter stage name" onChange={(event) => {
            draftDirtyRef.current = true;
            setStageName(event.target.value);
            setSaveStatus("idle");
            setStatus("");
          }} required />
        </label>
        <label>
          City
          <select value={city} disabled={cityOptionsStatus !== "ready"} onChange={(event) => {
            draftDirtyRef.current = true;
            setCity(event.target.value);
            setSaveStatus("idle");
            setStatus("");
          }} required>
            <option value="" disabled>
              {cityOptionsStatus === "loading" ? "Loading available cities..." : cityOptionsStatus === "error" ? "Cities temporarily unavailable" : "Select a city"}
            </option>
            {cityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <small>{cityOptionsStatus === "error" ? "The live city list could not be loaded. Try again before saving." : "Choose from active MyDancr venue markets."}</small>
        </label>
        {unifiedSave ? null : (
          <div className="dancer-profile-form-actions">
            <button className="dancer-profile-save-action primary-action" type="submit" disabled={saveStatus === "saving" || cityOptionsStatus !== "ready"}>
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save profile"}
            </button>
            <button aria-label="Reload saved profile" className="dancer-profile-reload-action" type="button" onClick={hardResetProfile} disabled={isResetting || saveStatus === "saving"}>
              {isResetting ? "Reloading..." : "Reload saved"}
            </button>
          </div>
        )}
        {visibleStatus ? (
          <p className={`dancer-form-save-state ${draftDirtyRef.current ? "is-unsaved" : "is-saved"}`} role="status" aria-live="polite">
            {visibleStatus}
          </p>
        ) : null}
      </form>
    </article>
  );
}

function DancerAvatarPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const avatarUrl = String(profile?.avatarPhotoUrl || "");
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectAvatar(nextFile: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : "");
    setStatus(nextFile ? "Avatar selected. Upload started automatically." : "");
    if (nextFile) void uploadAvatar(nextFile);
  }

  async function refreshProfile() {
    const data = await requestDancerProfileJson({
      cache: "no-store",
      fallbackMessage: "Unable to refresh your avatar.",
    });
    if (!data.profile) throw new Error("Unable to refresh your avatar.");
    onProfileChange?.(data.profile);
    return data.profile as Record<string, unknown>;
  }

  async function uploadAvatar(nextFile: File) {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    if (!nextFile.type.startsWith("image/")) return setStatus("Choose a JPEG, PNG, WebP, HEIC, or HEIF image.");
    if (nextFile.size > 25 * 1024 * 1024) return setStatus("Avatar photos must be 25 MB or smaller.");
    const formData = new FormData();
    const uploadKey = `${nextFile.name}:${nextFile.size}:${nextFile.lastModified}:avatar:${Date.now()}`;
    formData.set("file", nextFile);
    formData.set("idempotencyKey", uploadKey);
    setIsSaving(true);
    setUploadProgress(25);
    setStatus("Checking your avatar...");
    try {
      const data = await requestDancerAvatarJson({
        method: "POST",
        headers: { "idempotency-key": uploadKey },
        body: formData,
        fallbackMessage: "Unable to upload avatar.",
      });
      setUploadProgress(85);
      await refreshProfile();
      setFile(null);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
      const decision = String(data.decision || "pending").toLowerCase();
      setStatus(decision === "approved"
        ? "Avatar approved and saved."
        : "Avatar uploaded. We are checking it now; your current approved avatar stays visible.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to upload avatar.");
    } finally {
      setIsSaving(false);
      setUploadProgress(0);
    }
  }

  async function removeAvatar() {
    if (!window.confirm("Remove your current avatar? A moderated avatar is required before profile submission.")) return;
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    setIsSaving(true);
    setStatus("Removing avatar...");
    try {
      await requestDancerAvatarJson({
        method: "DELETE",
        fallbackMessage: "Unable to remove avatar.",
      });
      await refreshProfile();
      setStatus("Avatar removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove avatar.");
    } finally {
      setIsSaving(false);
    }
  }

  const visibleAvatar = previewUrl || avatarUrl;
  const moderationLabel = pendingAvatar ? "Checking" : avatarUrl ? "Approved" : "Required";
  return (
    <article className="info-panel dancer-avatar-panel">
      <p className="dancer-profile-editor-intro">Required · Use a clear solo face photo of yourself.</p>
      <div className="dancer-avatar-editor" aria-label="Profile photo preview">
        <span className="dancer-avatar-preview">
          {visibleAvatar ? <img src={visibleAvatar} alt="Selected dancer avatar preview" /> : <b aria-hidden="true">+</b>}
        </span>
        <strong className={`dancer-avatar-state is-${moderationLabel.toLowerCase()}`}>{moderationLabel}</strong>
      </div>
      <div className="dancer-avatar-upload-controls">
        <div className="photo-source-grid dancer-avatar-source-grid">
          <label className={`photo-source-action${isSaving ? " is-disabled" : ""}`}>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              aria-label="Choose avatar from your photo library"
              className="photo-source-input"
              disabled={isSaving}
              type="file"
              onChange={(event) => {
                selectAvatar(event.target.files?.[0] || null);
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4zM7 15l3-3 2.5 2.5L15 12l3 3" /><circle cx="16.5" cy="9" r="1" /></svg></span>
            <span className="photo-source-copy"><strong>Gallery</strong><small>Choose a clear face photo</small></span>
            <span className="photo-source-cta" aria-hidden="true">Choose</span>
          </label>
          <label className={`photo-source-action${isSaving ? " is-disabled" : ""}`}>
            <input
              accept="image/*"
              aria-label="Take a new avatar photo"
              capture="user"
              className="photo-source-input"
              disabled={isSaving}
              type="file"
              onChange={(event) => {
                selectAvatar(event.target.files?.[0] || null);
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 8h3l1.5-2h5L16 8h3v10H5z" /><circle cx="12" cy="13" r="3" /></svg></span>
            <span className="photo-source-copy"><strong>Camera</strong><small>Take a new face photo now</small></span>
            <span className="photo-source-cta" aria-hidden="true">Open</span>
          </label>
        </div>
        {isSaving ? <progress aria-label="Avatar upload progress" max="100" value={uploadProgress} /> : null}
        {file && !isSaving ? <button type="button" onClick={() => void uploadAvatar(file)}>Retry avatar upload</button> : null}
        {avatarUrl ? <button type="button" disabled={isSaving} onClick={() => void removeAvatar()}>Remove avatar</button> : null}
      </div>
      <p className="dancer-avatar-guidance">AI checks that only you appear, then centers the photo automatically.</p>
      {status || pendingAvatar ? <p role="status" aria-live="polite">{status || "We are checking this photo. Your current approved photo stays visible."}</p> : null}
    </article>
  );
}

function DancerShiftPanel() {
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [shifts, setShifts] = useState<Array<Record<string, any>>>([]);
  const [venueId, setVenueId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState("");
  const [checkInStatus, setCheckInStatus] = useState("");
  const [checkInTone, setCheckInTone] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState("");
  const [activeCheckInId, setActiveCheckInId] = useState("");
  const [editingShiftId, setEditingShiftId] = useState("");
  const [editVenueId, setEditVenueId] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");

  const loadShifts = useCallback(async () => {
    const data = await requestDancerShiftsJson({
      cache: "no-store",
      fallbackMessage: "Unable to load posted shifts.",
    });
    const approvedVenues = Array.isArray(data.venues) ? data.venues : [];
    setShifts(data.shifts || []);
    setVenues(approvedVenues);
    setVenueId((current) => approvedVenues.some((venue: { id: string }) => venue.id === current)
      ? current
      : String(approvedVenues[0]?.id || ""));
    setEditVenueId((current) => !current || approvedVenues.some((venue: { id: string }) => venue.id === current)
      ? current
      : "");
  }, []);

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;
    void loadShifts().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load posted shifts.");
    });
  }, [loadShifts]);

  async function postShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!venueId || !startsAt || !endsAt) {
      setStatus("Choose a venue, start time, and end time.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const data = await requestDancerShiftsJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
        fallbackMessage: "Unable to post shift.",
      });
      setStatus(`Shift posted. ${data.broadcastRecipients || 0} followers notified.`);
      setCheckInStatus("Shift posted. During the shift, tap the venue's official dressing-room sticker to appear Working Now.");
      setStartsAt("");
      setEndsAt("");
      await loadShifts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to post shift.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEditingShift(shift: Record<string, any>) {
    setEditingShiftId(String(shift.id));
    setEditVenueId(String(shift.venue_id || ""));
    setEditStartsAt(toDateTimeLocalValue(shift.starts_at));
    setEditEndsAt(toDateTimeLocalValue(shift.ends_at));
    setStatus("Edit the shift hours, then save. Exact times stay private and are used for check-in and commission eligibility.");
  }

  function stopEditingShift() {
    setEditingShiftId("");
    setEditVenueId("");
    setEditStartsAt("");
    setEditEndsAt("");
  }

  async function saveShiftEdit(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!editVenueId || !editStartsAt || !editEndsAt) {
      setStatus("Choose a venue, start time, and end time before saving.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      await requestDancerShiftsJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shiftId,
          venueId: editVenueId,
          startsAt: new Date(editStartsAt).toISOString(),
          endsAt: new Date(editEndsAt).toISOString(),
        }),
        fallbackMessage: "Unable to update shift.",
      });
      setStatus("Shift updated. During those posted hours, tap the venue's dressing-room sticker to check in.");
      stopEditingShift();
      await loadShifts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update shift.");
    } finally {
      setIsSaving(false);
    }
  }

  async function cancelShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setDeletingShiftId(shiftId);
    try {
      const data = await requestDancerShiftsJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId, status: "cancelled" }),
        fallbackMessage: "Unable to cancel shift.",
      });

      setShifts((current) => current.filter((shift) => String(shift.id) !== shiftId));
      if (editingShiftId === shiftId) stopEditingShift();
      setStatus(`Shift cancelled. ${data.cancellationRecipients || 0} guests notified.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to cancel shift.");
    } finally {
      setDeletingShiftId("");
    }
  }

  async function checkOutShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setActiveCheckInId(shiftId);
    setStatus("");
    try {
      await requestDancerShiftCheckInJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId }),
        fallbackMessage: "Unable to check out.",
      });
      setCheckInStatus("Club check-in ended. Club Deal commission tracking is stopped.");
      setCheckInTone("success");
      setStatus("Checked out. This shift is no longer Working Now.");
      await loadShifts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to check out.";
      setCheckInStatus(message);
      setCheckInTone("error");
      setStatus(message);
    } finally {
      setActiveCheckInId("");
    }
  }

  const editablePostedShifts = shifts
    .filter((shift) => shift.status === "posted")
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const checkInReadyShifts = editablePostedShifts
    .filter((shift) => shift.status === "posted" && !shift.checked_out_at && new Date(shift.ends_at).getTime() >= Date.now())
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const activeShift =
    checkInReadyShifts.find((shift) => canCheckOutOfShift(shift)) ||
    checkInReadyShifts.find((shift) => canCheckInToShift(shift)) ||
    checkInReadyShifts[0] ||
    null;
  const isCheckedInToActiveShift = activeShift ? canCheckOutOfShift(activeShift) : false;
  const activeLocationIsVerified = activeShift ? isCurrentLocationVerification(activeShift) : false;

  return (
    <article className="info-panel shift-panel">
      <h2>Post Schedule</h2>
      <div className={activeShift ? "shift-checkin-card ready" : "shift-checkin-card"}>
        <span>
          <strong>{activeShift ? (isCheckedInToActiveShift ? (activeLocationIsVerified ? "Club check-in active" : "Club check-in expired") : canCheckInToShift(activeShift) ? "Ready for dressing-room tap" : "Next posted shift") : "No shift ready for check-in"}</strong>
          <small>
            {activeShift
              ? isCheckedInToActiveShift
                ? activeLocationIsVerified
                  ? `${venueName(activeShift)} is live in Now until this club check-in expires or the shift ends.`
                  : `${venueName(activeShift)} is not shown in Working Now. A new dressing-room tap can start one six-hour session only after the cooldown ends.`
                : `${venueName(activeShift)} is posted. During the shift, tap the venue's official dressing-room sticker to check in.`
              : "Post one or more shifts below. Your public cards only show Working Now when checked in, or the nearest upcoming shift when you are not checked in."}
          </small>
        </span>
        {activeShift && !isCheckedInToActiveShift ? <b className="check-in-confirmation">Tap at the club</b> : null}
        {activeShift && isCheckedInToActiveShift ? (
          <button
            type="button"
            className="check-in-confirmation"
            disabled
            aria-label="Check-in confirmed"
            aria-live="polite"
          >
            ✓ Checked in
          </button>
        ) : null}
        {activeShift && canCheckOutOfShift(activeShift) ? (
          <>
            <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => checkOutShift(String(activeShift.id))}>
              {activeCheckInId === String(activeShift.id) ? "Saving..." : "Check out"}
            </button>
          </>
        ) : null}
        {checkInStatus ? (
          <small
            className={`shift-checkin-status is-${checkInTone}`}
            role={checkInTone === "error" ? "alert" : "status"}
            aria-live={checkInTone === "error" ? "assertive" : "polite"}
          >
            {checkInStatus}
          </small>
        ) : null}
      </div>
      <form onSubmit={postShift}>
        <label>
          Approved venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={!venues.length || isSaving} required>
            <option value="">{venues.length ? "Choose approved venue" : "No tap-approved venues"}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label>
          Ends
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
        <button type="submit" disabled={isSaving || !venues.length}>
          {isSaving ? "Posting..." : "Post another shift"}
        </button>
        {!venues.length ? <p>Tap a venue&apos;s official dressing-room sticker to approve it before posting a shift there.</p> : null}
      </form>
      <div className="shift-list-head">
        <strong>Posted shifts</strong>
        <small>All posted shifts live here for editing or deleting. Public cards show only Working Now or the closest upcoming shift.</small>
      </div>
      <div className="shift-list">
        {editablePostedShifts.map((shift) => (
          <div className={deletingShiftId === String(shift.id) ? "dashboard-shift is-deleting" : "dashboard-shift"} key={String(shift.id)}>
            {editingShiftId === String(shift.id) ? (
              <>
                <label>
                  Approved venue
                  <select value={editVenueId} onChange={(event) => setEditVenueId(event.target.value)} required>
                    <option value="">Choose approved venue</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Starts
                  <input type="datetime-local" value={editStartsAt} onChange={(event) => setEditStartsAt(event.target.value)} required />
                </label>
                <label>
                  Ends
                  <input type="datetime-local" value={editEndsAt} onChange={(event) => setEditEndsAt(event.target.value)} required />
                </label>
                <div className="shift-actions">
                  <button type="button" disabled={isSaving} onClick={() => saveShiftEdit(String(shift.id))}>
                    {isSaving ? "Saving..." : "Save shift"}
                  </button>
                  <button type="button" onClick={stopEditingShift}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  <strong>{venueName(shift)}</strong>
                  <small>{formatDashboardShift(shift.starts_at, shift.ends_at)}</small>
                </span>
                <em>{dashboardShiftStatus(shift)}</em>
                <div className="shift-actions">
                  {canCheckInToShift(shift) ? <b className="check-in-confirmation">Tap at dressing room</b> : null}
                  {canCheckOutOfShift(shift) ? (
                    <>
                      <button type="button" className="check-in-confirmation" disabled aria-label="Check-in confirmed">
                        ✓ Checked in
                      </button>
                      <button type="button" disabled={activeCheckInId === String(shift.id)} onClick={() => checkOutShift(String(shift.id))}>
                        {activeCheckInId === String(shift.id) ? "Saving..." : "Check Out"}
                      </button>
                    </>
                  ) : null}
                  {shift.status !== "cancelled" ? (
                    <>
                      <button type="button" disabled={Boolean(deletingShiftId)} onClick={() => startEditingShift(shift)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(deletingShiftId)}
                        aria-busy={deletingShiftId === String(shift.id)}
                        onClick={() => cancelShift(String(shift.id))}
                      >
                        {deletingShiftId === String(shift.id) ? "Deleting..." : "Delete shift"}
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ))}
        {!editablePostedShifts.length ? <p>No posted shifts yet. Add as many shifts as you need above.</p> : null}
      </div>
      {status ? <p className="shift-panel-feedback" role="status" aria-live="polite">{status}</p> : null}
    </article>
  );
}

function canCheckInToShift(shift: Record<string, any>) {
  if (shift.status !== "posted" || shift.checked_in_at || shift.checked_out_at) return false;
  return isShiftCheckInWindowOpen(shift);
}

function canCheckOutOfShift(shift: Record<string, any>) {
  if (shift.status !== "posted" || !shift.checked_in_at || shift.checked_out_at) return false;
  return new Date(shift.ends_at).getTime() >= Date.now();
}

function isShiftCheckInWindowOpen(shift: Record<string, any>) {
  const startsAt = new Date(shift.starts_at);
  const endsAt = new Date(shift.ends_at);
  const now = new Date();
  return now >= startsAt && now <= endsAt;
}

function dashboardShiftStatus(shift: Record<string, any>) {
  if (shift.status === "cancelled") return "Cancelled";
  if (shift.checked_out_at) return "Checked Out";
  if (isCurrentLocationVerification(shift) && new Date(shift.ends_at).getTime() >= Date.now()) return "Club check-in active";
  if (shift.checked_in_at && !shift.checked_out_at) return "Tap again";
  return "Not checked in";
}

function venueName(shift: Record<string, any>) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Venue");
}

function formatDashboardShift(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return "Time pending";
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}

function toDateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function DancerImpactPanel({
  events,
  report,
}: {
  events?: LoadState["rankingEvents"];
  report?: LoadState["weeklyReport"];
}) {
  return (
    <article className="info-panel impact-panel" aria-label="Weekly result details">
      <div className="weekly-result-summary">
        <span>
          <strong>{String(report?.followersGained || 0)} new followers</strong>
          <small>This week</small>
        </span>
        <b>{String(report?.profileViews || 0)} views · {String(report?.goingSignals || 0)} Going signals</b>
      </div>
      <div className="event-list">
        {(events || []).slice(0, 5).map((event) => (
          <div className="event-row" key={String(event.id)}>
            <strong>{String(event.message || "Ranking update")}</strong>
            <span>{formatEventDate(String(event.createdAt || ""))}</span>
          </div>
        ))}
        {!events?.length ? <p>No ranking milestones yet.</p> : null}
      </div>
    </article>
  );
}

function formatRankMove(report?: LoadState["weeklyReport"]) {
  if (!report) return "Pending";
  const start = report.startRank ? `#${report.startRank}` : "Unranked";
  const current = report.currentRank ? `#${report.currentRank}` : "Unranked";
  return `${start} to ${current}`;
}

function formatEventDate(value: string) {
  if (!value) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(new Date(value));
}

function DancerSharePanel({ profile }: { profile?: LoadState["profile"] }) {
  const [shareUrl, setShareUrl] = useState("");
  const [status, setStatus] = useState("");
  const slug = String(profile?.slug || "");

  useEffect(() => {
    if (!slug) return;
    const nextShareUrl = `${window.location.origin}/dancers/${slug}`;
    setShareUrl(nextShareUrl);
  }, [slug]);

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Profile link copied.");
    } catch {
      setStatus("Copy failed. Select the link manually.");
    }
  }

  return (
    <article className="info-panel share-panel" aria-labelledby="dancer-share-heading">
      <div className="share-panel-head">
        <div>
          <h2 id="dancer-share-heading">Your public profile</h2>
        </div>
        <strong className="share-free-badge">Free · $0/month</strong>
      </div>
      {slug ? (
        <div className="share-grid">
          <div className="share-link-row">
            <span>
              <small>Your profile link</small>
              <strong>/dancers/{slug}</strong>
            </span>
          </div>
          <div className="share-actions">
            <button type="button" onClick={copyLink}>
              {status === "Profile link copied." ? "Copied" : "Copy link"}
            </button>
            <Link href={`/dancers/${slug}`}>Open profile</Link>
          </div>
          {status ? <p className="share-status" role="status" aria-live="polite">{status}</p> : null}
        </div>
      ) : (
        <p>Save your stage name first to create a public profile link.</p>
      )}
    </article>
  );
}

function socialValuesFromProfile(profile?: LoadState["profile"]) {
  const existing = Array.isArray(profile?.social_links) ? profile.social_links : [];
  return Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => {
    const row = existing.find((item: any) => item?.platform === platform.key && item?.is_active !== false);
    return [platform.key, String(row?.url || row?.handle || "")];
  })) as Record<SocialPlatform, string>;
}

function SocialLinkModal({
  onClose,
  onProfileChange,
  platform,
  profile,
  unifiedSave = false,
}: {
  onClose: () => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  platform: SocialPlatform;
  profile?: LoadState["profile"];
  unifiedSave?: boolean;
}) {
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const draftHydratedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const savePendingRef = useRef(false);
  const draftKey = `mydancr:dancer-social-draft:${String(profile?.id || "profile")}`;
  const editorSaveRef = useRef<() => Promise<boolean>>(async () => true);
  const persistedSocials = useMemo(() => socialValuesFromProfile(profile), [profile]);
  const selectedPlatform = SOCIAL_PLATFORMS.find((item) => item.key === platform) || SOCIAL_PLATFORMS[0];
  const persistedValue = persistedSocials[selectedPlatform.key] || "";
  const hasExistingLink = Boolean(persistedValue.trim());
  editorSaveRef.current = () => saveSocials();

  useEffect(() => {
    if (!unifiedSave) return;
    const addSaveTask = (event: Event) => {
      const detail = (event as CustomEvent<DancerProfileEditorSaveRequest>).detail;
      detail?.tasks.push(() => editorSaveRef.current());
    };
    window.addEventListener(DANCER_PROFILE_EDITOR_SAVE_EVENT, addSaveTask);
    return () => window.removeEventListener(DANCER_PROFILE_EDITOR_SAVE_EVENT, addSaveTask);
  }, [unifiedSave]);

  useEffect(() => {
    if (draftDirtyRef.current) return;
    const nextSocials: Record<string, string> = { ...persistedSocials };
    if (!draftHydratedRef.current) {
      try {
        const stored = JSON.parse(window.localStorage.getItem(draftKey) || "null");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          Object.assign(nextSocials, stored);
          draftDirtyRef.current = true;
        }
      } catch {
        window.localStorage.removeItem(draftKey);
      }
      draftHydratedRef.current = true;
    }
    setSocials(nextSocials);
  }, [draftKey, persistedSocials]);

  useEffect(() => {
    if (draftHydratedRef.current && draftDirtyRef.current) {
      window.localStorage.setItem(draftKey, JSON.stringify(socials));
    }
  }, [draftKey, socials]);

  async function saveSocials(event?: React.FormEvent<HTMLFormElement>, values = socials) {
    event?.preventDefault();
    if (savePendingRef.current) return false;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return false;
    }

    savePendingRef.current = true;
    setIsSaving(true);
    setStatus("");
    try {
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          socials: SOCIAL_PLATFORMS.map((platform) => {
            const value = (values[platform.key] || "").trim();
            return {
              platform: platform.key,
              handle: toSocialHandle(value),
              url: toSocialUrl(platform.key, value),
              isActive: Boolean(value),
            };
          }),
        }),
        fallbackMessage: "Unable to save socials.",
      });
      if (data.profile) onProfileChange?.(data.profile);
      draftDirtyRef.current = false;
      window.localStorage.removeItem(draftKey);
      setStatus("Social links saved.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save socials.");
      return false;
    } finally {
      savePendingRef.current = false;
      setIsSaving(false);
    }
  }

  function discardSelectedDraftAndClose() {
    const nextSocials = { ...socials, [selectedPlatform.key]: persistedValue };
    const hasRemainingDraft = SOCIAL_PLATFORMS.some((item) => (
      String(nextSocials[item.key] || "") !== String(persistedSocials[item.key] || "")
    ));
    draftDirtyRef.current = hasRemainingDraft;
    setSocials(nextSocials);
    setStatus("");
    if (hasRemainingDraft) {
      window.localStorage.setItem(draftKey, JSON.stringify(nextSocials));
    } else {
      window.localStorage.removeItem(draftKey);
    }
    onClose();
  }

  async function saveSelectedSocial(event: React.FormEvent<HTMLFormElement>) {
    const saved = await saveSocials(event);
    if (saved) onClose();
  }

  async function removeSelectedSocial() {
    if (!hasExistingLink || savePendingRef.current) return;
    const nextSocials = { ...socials, [selectedPlatform.key]: "" };
    draftDirtyRef.current = true;
    setSocials(nextSocials);
    setStatus("");
    const saved = await saveSocials(undefined, nextSocials);
    if (saved) onClose();
  }

  return (
    <div
      className="dancer-social-link-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) discardSelectedDraftAndClose();
      }}
    >
      <section
        aria-labelledby="dancer-social-link-modal-heading"
        aria-modal="true"
        className="dancer-profile-builder-panel dancer-social-link-modal"
        data-section="socials"
        id="dancer-profile-builder-panel"
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div className={`dancer-social-link-modal-heading is-${selectedPlatform.key}`}>
            <span aria-hidden="true"><SocialPlatformIcon platform={selectedPlatform.key} /></span>
            <h2 id="dancer-social-link-modal-heading">{hasExistingLink ? "Edit" : "Add"} {selectedPlatform.label}</h2>
          </div>
          <button
            aria-label={`Close ${selectedPlatform.label} social link editor`}
            data-social-modal-close
            disabled={isSaving}
            onClick={discardSelectedDraftAndClose}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div>
          <form className="dancer-social-link-form" onSubmit={(event) => void saveSelectedSocial(event)}>
            <label htmlFor={`dancer-social-${selectedPlatform.key}`}>
              Profile link or username
              <input
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                id={`dancer-social-${selectedPlatform.key}`}
                inputMode="url"
                placeholder={selectedPlatform.placeholder}
                spellCheck={false}
                value={socials[selectedPlatform.key] || ""}
                onChange={(event) => {
                  draftDirtyRef.current = true;
                  setSocials((current) => ({ ...current, [selectedPlatform.key]: event.target.value }));
                  setStatus("");
                }}
              />
            </label>
            {status || isSaving ? (
              <p className={`dancer-form-save-state ${status ? "is-unsaved" : "is-saved"}`} role="status" aria-live="polite">
                {status || "Saving changes..."}
              </p>
            ) : null}
            <button className="dancer-social-link-save" type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : hasExistingLink ? "Save changes" : "Save"}
            </button>
            {hasExistingLink ? (
              <button className="dancer-social-link-remove" disabled={isSaving} onClick={() => void removeSelectedSocial()} type="button">
                Remove link
              </button>
            ) : null}
          </form>
        </div>
      </section>
    </div>
  );
}

const SOCIAL_PLATFORMS: ReadonlyArray<{ key: SocialPlatform; label: string; placeholder: string }> = [
  { key: "instagram", label: "Instagram", placeholder: "Username or profile URL" },
  { key: "tiktok", label: "TikTok", placeholder: "Username or profile URL" },
  { key: "snapchat", label: "Snapchat", placeholder: "Username or profile URL" },
  { key: "x", label: "X", placeholder: "Username or profile URL" },
  { key: "onlyfans", label: "OnlyFans", placeholder: "Username or profile URL" },
];

function toSocialHandle(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/^@/, "") || "";
}

function toSocialUrl(platform: string, value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;

  const handle = toSocialHandle(text);
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "tiktok") return `https://tiktok.com/@${handle}`;
  if (platform === "snapchat") return `https://snapchat.com/add/${handle}`;
  if (platform === "x") return `https://x.com/${handle}`;
  if (platform === "onlyfans") return `https://onlyfans.com/${handle}`;
  return text;
}

type DancerPhotoItem = {
  id: string;
  imageUrl: string;
  label: string;
  status: "approved" | "pending" | "rejected";
  note: string;
  storagePath?: string;
  isPrimary?: boolean;
  sortOrder?: number;
};

const DANCER_ONBOARDING_MEDIA_PREVIEW_SLOTS = 5;
const DANCER_PHOTOS_KEEP_OPEN_EVENT = "mydancr:dancer-photos-keep-open";

type DancerPhotoQueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  source: "gallery" | "camera";
  makePrimary: boolean;
  stage: "queued" | "uploading" | "checking" | "failed";
  progress: number;
  error?: string;
};

function DancerPhotoPanel({
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  onDeletedPhotoIdsChange,
  onDeletedPhotoStoragePathsChange,
  onProfileChange,
  profile,
}: {
  deletedPhotoIds?: string[];
  deletedPhotoStoragePaths?: string[];
  onDeletedPhotoIdsChange?: (deletedPhotoIds: string[]) => void;
  onDeletedPhotoStoragePathsChange?: (deletedPhotoStoragePaths: string[]) => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [isPrimary, setIsPrimary] = useState(false);
  const [photos, setPhotos] = useState<DancerPhotoItem[]>(() =>
    relabelPhotoItems(dancerPhotoItemsFromProfile(profile, deletedPhotoIds)),
  );
  const [queuedPhotos, setQueuedPhotos] = useState<DancerPhotoQueueItem[]>([]);
  const [uploadingQueueItemId, setUploadingQueueItemId] = useState("");
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isArranging, setIsArranging] = useState(false);
  const [deletingPhotoIds, setDeletingPhotoIds] = useState<Set<string>>(() => new Set());
  const deletedPhotoIdsRef = useRef<string[]>(deletedPhotoIds);
  const deletedPhotoStoragePathsRef = useRef<string[]>(deletedPhotoStoragePaths);
  const galleryPhotoInputRef = useRef<HTMLInputElement>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement>(null);
  const queuedPreviewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    setPhotos((current) =>
      excludePendingDeletions(
        relabelPhotoItems(preserveConfirmedPhotoPreviews(dancerPhotoItemsFromProfile(profile, deletedPhotoIdsRef.current), current)),
        deletedPhotoIdsRef.current,
      ),
    );
  }, [profile, deletedPhotoIds, deletedPhotoStoragePaths]);

  useEffect(() => () => {
    queuedPreviewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    queuedPreviewUrlsRef.current.clear();
  }, []);

  function queuePhotos(files: File[], source: DancerPhotoQueueItem["source"]) {
    window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));
    const replacingPrimary = isPrimary && photos.some((photo) => photo.isPrimary) ? 1 : 0;
    const availableProfileSlots = Math.max(0, MAX_DANCER_PROFILE_PHOTOS - photos.length + replacingPrimary - queuedPhotos.length);
    const selectedFiles = files.slice(0, availableProfileSlots);
    if (!selectedFiles.length) {
      setStatus("Your profile picture library is full. Delete or replace a picture first.");
      return;
    }

    const additions = selectedFiles.map((nextFile, index) => {
      const previewUrl = URL.createObjectURL(nextFile);
      queuedPreviewUrlsRef.current.add(previewUrl);
      const validType = nextFile.type.startsWith("image/");
      const validSize = nextFile.size <= 25 * 1024 * 1024;
      return {
        id: `${nextFile.name}:${nextFile.size}:${nextFile.lastModified}:${crypto.randomUUID()}`,
        file: nextFile,
        previewUrl,
        source,
        makePrimary: isPrimary && index === 0,
        stage: validType && validSize ? "queued" : "failed",
        progress: 0,
        error: !validType ? "Choose a JPEG, PNG, WebP, HEIC, or HEIF image." : !validSize ? "Photos must be 25 MB or smaller." : undefined,
      } satisfies DancerPhotoQueueItem;
    });
    const omitted = files.length - selectedFiles.length;
    setQueuedPhotos((current) => [...current, ...additions]);
    setIsPrimary(false);
    setStatus(`${additions.length} ${additions.length === 1 ? "photo" : "photos"} selected. Upload started automatically${omitted ? `. ${omitted} exceeded the available profile slots.` : "."}`);
    const uploadable = additions.filter((item) => !item.error);
    if (uploadable.length) void uploadPhotoBatch(uploadable);
  }

  function updateQueuedPhoto(id: string, changes: Partial<DancerPhotoQueueItem>) {
    setQueuedPhotos((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  function removeQueuedPhoto(id: string) {
    setQueuedPhotos((current) => current.filter((item) => {
      if (item.id !== id) return true;
      queuedPreviewUrlsRef.current.delete(item.previewUrl);
      URL.revokeObjectURL(item.previewUrl);
      return false;
    }));
  }

  async function persistQueuedPhotoDeletions() {
    const idsToDelete = [...deletedPhotoIdsRef.current];
    if (!idsToDelete.length) return;

    setStatus("Saving deleted photos before upload...");
    const data = await requestDancerProfileJson({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deletedPhotoIds: idsToDelete }),
      fallbackMessage: "Unable to save deleted photos before upload.",
    });

    const confirmedIds = new Set((data.deletedPhotoIds || []).map((id: unknown) => String(id)));
    const unconfirmedIds = idsToDelete.filter((id) => !confirmedIds.has(id));
    if (unconfirmedIds.length) {
      throw new Error("The deleted photo slots could not be confirmed. Please try again.");
    }

    deletedPhotoIdsRef.current = [];
    deletedPhotoStoragePathsRef.current = [];
    onDeletedPhotoIdsChange?.([]);
    onDeletedPhotoStoragePathsChange?.([]);
    if (data.profile) onProfileChange?.(data.profile);
  }

  async function uploadPhotoBatch(batch: DancerPhotoQueueItem[]) {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    if (!batch.length) return setStatus("Choose profile photos or take a new photo first.");
    if (!batch.some((item) => item.makePrimary) && photos.length + batch.length > MAX_DANCER_PROFILE_PHOTOS) {
      return setStatus("Your profile picture library is full. Delete or replace a picture before adding more.");
    }

    setIsUploading(true);
    setStatus(`Preparing ${batch.length} ${batch.length === 1 ? "photo" : "photos"}...`);
    const failedItems: DancerPhotoQueueItem[] = [];
    let workingPhotos = [...photos];
    let acceptedCount = 0;
    let rejectedCount = 0;
    try {
      await persistQueuedPhotoDeletions();
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index];
        const makePrimary = item.makePrimary;
        setUploadingQueueItemId(item.id);
        updateQueuedPhoto(item.id, { stage: "uploading", progress: 25, error: undefined });
        setStatus(`Checking photo ${index + 1} of ${batch.length}...`);
        try {
          if (!makePrimary && workingPhotos.length >= MAX_DANCER_PROFILE_PHOTOS) {
            throw new Error("No profile photo slot is available for this photo.");
          }
          const uploadSortOrder = makePrimary ? 0 : nextGalleryPhotoSortOrder(workingPhotos);
          const uploadKey = `${item.file.name}:${item.file.size}:${item.file.lastModified}:${makePrimary ? "primary" : "gallery"}:${Date.now()}:${crypto.randomUUID()}`;
          const formData = new FormData();
          formData.set("file", item.file);
          formData.set("isPrimary", String(makePrimary));
          formData.set("replaceExisting", String(makePrimary));
          formData.set("sortOrder", String(uploadSortOrder));
          formData.set("idempotencyKey", uploadKey);

          const data = await requestDancerPhotosJson({
            method: "POST",
            headers: { "idempotency-key": uploadKey },
            body: formData,
            fallbackMessage: "Unable to upload photo.",
          });
          updateQueuedPhoto(item.id, { stage: "checking", progress: 85 });
          const uploadStatus = normalizePhotoStatus(data.photo?.reviewStatus || data.photo?.review_status || data.decision);
          const approved = uploadStatus === "approved";
          const uploadedPhoto: DancerPhotoItem = {
            id: String(data.photo?.id || data.moderationRecordId || `${item.file.name}:${item.file.lastModified}`),
            imageUrl: approved ? String(data.photo?.imageUrl || item.previewUrl) : item.previewUrl,
            label: Boolean(data.photo?.isPrimary || data.photo?.is_primary || makePrimary) ? "Main Photo" : "Photo",
            status: uploadStatus,
            note: data.message ? `${photoStatusLabel(uploadStatus)}: ${data.message}` : photoStatusNote(uploadStatus),
            storagePath: String(data.photo?.storage_path || ""),
            isPrimary: Boolean(data.photo?.isPrimary || data.photo?.is_primary || makePrimary),
            sortOrder: Number(data.photo?.sortOrder ?? data.photo?.sort_order ?? uploadSortOrder),
          };
          if (uploadStatus === "rejected") {
            rejectedCount += 1;
            queuedPreviewUrlsRef.current.delete(item.previewUrl);
            URL.revokeObjectURL(item.previewUrl);
          } else {
            acceptedCount += 1;
            workingPhotos = relabelPhotoItems(mergePhotoItems(workingPhotos, [uploadedPhoto]));
            setPhotos(workingPhotos);
            if (approved && data.photo?.imageUrl) {
              queuedPreviewUrlsRef.current.delete(item.previewUrl);
              URL.revokeObjectURL(item.previewUrl);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to upload photo.";
          const friendlyMessage = message.includes("valid JPEG, PNG, or WebP") || message.includes("HEIC or HEIF")
            ? "That photo could not be converted. Choose another photo or set your phone camera to Most Compatible."
            : message;
          failedItems.push({ ...item, stage: "failed", progress: 0, error: friendlyMessage });
        }
      }

      if (acceptedCount) {
        const refreshData = await requestDancerProfileJson({
          cache: "no-store",
          fallbackMessage: "Unable to refresh uploaded photos.",
        });
        if (refreshData.profile) {
          const refreshedPhotos = preserveConfirmedPhotoPreviews(dancerPhotoItemsFromProfile(refreshData.profile), workingPhotos);
          workingPhotos = relabelPhotoItems(mergePhotoItems(refreshedPhotos, workingPhotos.filter((photo) => photo.status === "pending")));
          setPhotos(workingPhotos);
          onProfileChange?.(refreshData.profile);
        }
      }

      const processedIds = new Set(batch.map((item) => item.id));
      setQueuedPhotos((current) => [
        ...current.filter((item) => !processedIds.has(item.id)),
        ...failedItems,
      ]);
      if (galleryPhotoInputRef.current) galleryPhotoInputRef.current.value = "";
      if (cameraPhotoInputRef.current) cameraPhotoInputRef.current.value = "";
      const summary = [
        acceptedCount ? `${acceptedCount} sent through moderation` : "",
        rejectedCount ? `${rejectedCount} rejected` : "",
        failedItems.length ? `${failedItems.length} ready to retry` : "",
      ].filter(Boolean).join(". ");
      setStatus(summary || "No photos were uploaded.");
    } finally {
      setUploadingQueueItemId("");
      setIsUploading(false);
      window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));
    }
  }

  async function savePhotoArrangement(nextOrder: DancerPhotoItem[]) {
    if (nextOrder.some((photo) => photo.status !== "approved" || !photo.imageUrl)) {
      setStatus("Wait for every photo to finish checking before changing the main photo or order.");
      return;
    }
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    const previousPhotos = photos;
    const arranged = relabelPhotoItems(nextOrder.map((photo, index) => ({
      ...photo,
      isPrimary: index === 0,
      sortOrder: index,
    })));
    setPhotos(arranged);
    setIsArranging(true);
    setStatus("Saving photo order...");
    try {
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainPhotoUrl: arranged[0]?.imageUrl || "",
          galleryPhotoUrls: arranged.slice(1).map((photo) => photo.imageUrl),
        }),
        fallbackMessage: "Unable to save photo order.",
      });
      if (!data.profile) throw new Error("Unable to save photo order.");
      const refreshedPhotos = relabelPhotoItems(dancerPhotoItemsFromProfile(data.profile));
      setPhotos(refreshedPhotos);
      onProfileChange?.(data.profile);
      setStatus("Photo order saved.");
    } catch (error) {
      setPhotos(previousPhotos);
      setStatus(error instanceof Error ? error.message : "Unable to save photo order.");
    } finally {
      setIsArranging(false);
    }
  }

  function makePhotoPrimary(photoId: string) {
    const selected = photos.find((photo) => photo.id === photoId);
    if (!selected || selected.isPrimary) return;
    void savePhotoArrangement([selected, ...photos.filter((photo) => photo.id !== photoId)]);
  }

  function moveGalleryPhoto(photoId: string, direction: -1 | 1) {
    const index = photos.findIndex((photo) => photo.id === photoId);
    const nextIndex = index + direction;
    if (index <= 0 || nextIndex <= 0 || nextIndex >= photos.length) return;
    const nextOrder = [...photos];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    void savePhotoArrangement(nextOrder);
  }

  async function deletePhoto(photo: DancerPhotoItem) {
    if (!window.confirm("Delete this photo from your profile?")) return;
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");

    setDeletingPhotoIds((current) => new Set(current).add(photo.id));
    setStatus("Deleting photo...");
    try {
      await requestDancerPhotosJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId: photo.id }),
        fallbackMessage: "Unable to delete photo.",
      });

      setPhotos((current) => relabelPhotoItems(current.filter((item) => item.id !== photo.id)));
      deletedPhotoIdsRef.current = deletedPhotoIdsRef.current.filter((id) => id !== photo.id);
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsChange?.(deletedPhotoIdsRef.current);
      onDeletedPhotoStoragePathsChange?.([]);
      setStatus("Photo deleted permanently.");
      window.dispatchEvent(new Event(DANCER_PHOTOS_KEEP_OPEN_EVENT));

      const refreshData = await requestDancerProfileJson({
        cache: "no-store",
        fallbackMessage: "Unable to verify the deleted photo.",
      });
      if (refreshData.profile) {
        const refreshedPhotos = dancerPhotoItemsFromProfile(refreshData.profile);
        if (refreshedPhotos.some((item) => item.id === photo.id)) {
          throw new Error("The photo could not be permanently deleted. Please try again.");
        }
        setPhotos(relabelPhotoItems(refreshedPhotos));
        onProfileChange?.(refreshData.profile);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete photo.");
    } finally {
      setDeletingPhotoIds((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
    }
  }

  const hasMainPhoto = photos.some((photo) => photo.isPrimary);

  return (
    <article aria-label="Profile photo manager" className="info-panel upload-panel">
      <div className="dancer-photo-upload-form">
        <div className="photo-upload-heading">
          <span><strong>Add at least 1 solo picture of yourself. You can add more later.</strong></span>
        </div>
        {hasMainPhoto ? (
          <label className="photo-primary-choice">
            <input checked={isPrimary} disabled={isUploading} type="checkbox" onChange={(event) => setIsPrimary(event.target.checked)} />
            <span>
              <strong>Replace my main photo</strong>
              <small>The next photo you choose will become your main photo.</small>
            </span>
          </label>
        ) : null}
        <div className="photo-source-grid">
          <label className={`photo-source-action${isUploading ? " is-disabled" : ""}`}>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              aria-label="Choose profile photos from your library"
              className="photo-source-input"
              disabled={isUploading}
              multiple
              ref={galleryPhotoInputRef}
              type="file"
              onChange={(event) => {
                queuePhotos(Array.from(event.target.files || []), "gallery");
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4zM7 15l3-3 2.5 2.5L15 12l3 3" /><circle cx="16.5" cy="9" r="1" /></svg>
            </span>
            <span className="photo-source-copy">
              <strong>Gallery</strong>
              <small>Choose solo photos of yourself</small>
            </span>
            <span className="photo-source-cta" aria-hidden="true">Choose</span>
          </label>
          <label className={`photo-source-action${isUploading ? " is-disabled" : ""}`}>
            <input
              accept="image/*"
              aria-label="Take a new profile photo"
              capture="environment"
              className="photo-source-input"
              disabled={isUploading}
              ref={cameraPhotoInputRef}
              type="file"
              onChange={(event) => {
                queuePhotos(Array.from(event.target.files || []), "camera");
                event.target.value = "";
              }}
            />
            <span className="photo-source-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 8h3l1.5-2h5L16 8h3v10H5z" /><circle cx="12" cy="13" r="3" /></svg>
            </span>
            <span className="photo-source-copy">
              <strong>Camera</strong>
              <small>Take a solo photo now</small>
            </span>
            <span className="photo-source-cta" aria-hidden="true">Open</span>
          </label>
        </div>
        {status ? <p className="photo-upload-status" role="status" aria-live="polite">{status}</p> : null}
      </div>
      {queuedPhotos.length ? (
        <div className="photo-upload-queue" aria-label="Photos ready to upload">
          {queuedPhotos.map((item, index) => (
            <div className={`photo-review-card is-pending ${uploadingQueueItemId === item.id ? "is-uploading" : ""}`.trim()} key={item.id}>
              <div className="photo-preview" style={{ backgroundImage: `url(${item.previewUrl})` }} />
              <span>
                <strong>{item.makePrimary ? "Main Photo" : `Selected photo ${index + 1}`}</strong>
                <small>{item.stage === "uploading" ? "Uploading securely" : item.stage === "checking" ? "Running automatic review" : item.error ? "Upload failed" : "Waiting to upload"}</small>
                {item.stage !== "failed" ? <progress aria-label={`Photo ${index + 1} upload progress`} max="100" value={item.progress} /> : null}
                <em>{item.error || (item.source === "camera" ? "Taken with your phone camera." : "Selected from your phone.")}</em>
                <span className="photo-queue-actions">
                  {item.error ? <button className="photo-retry-button" disabled={isUploading} onClick={() => void uploadPhotoBatch([{ ...item, stage: "queued", progress: 0, error: undefined }])} type="button">Retry</button> : null}
                  <button className="photo-delete-button" disabled={isUploading} onClick={() => removeQueuedPhoto(item.id)} type="button">Remove</button>
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {photos.length ? (
        <div className="dancer-media-manager-title">
          <strong>Your photos</strong>
          <span>{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
        </div>
      ) : null}
      <div className="photo-review-list">
        {photos.map((photo, photoIndex) => {
          const isApprovedGalleryPhoto = photo.status === "approved" && !photo.isPrimary;
          const canMoveEarlier = isApprovedGalleryPhoto && photoIndex > 1;
          const canMoveLater = isApprovedGalleryPhoto && photoIndex < photos.length - 1;
          return (
            <div className={`photo-review-card is-${photo.status}`} key={photo.id}>
              {photo.imageUrl ? <div className="photo-preview" style={{ backgroundImage: `url(${photo.imageUrl})` }} /> : <div className="photo-preview empty">Review</div>}
              <span>
                <strong>{photo.label}</strong>
                <small>{photoStatusLabel(photo.status)}</small>
                <em>{photo.note}</em>
                <span className="photo-card-actions">
                  {isApprovedGalleryPhoto ? <button className="photo-main-action primary-action" disabled={isArranging} type="button" onClick={() => makePhotoPrimary(photo.id)}>Make main</button> : null}
                  {canMoveEarlier ? <button aria-label={`Move ${photo.label} earlier`} className="photo-order-action" disabled={isArranging} title="Move earlier" type="button" onClick={() => moveGalleryPhoto(photo.id, -1)}>↑</button> : null}
                  {canMoveLater ? <button aria-label={`Move ${photo.label} later`} className="photo-order-action" disabled={isArranging} title="Move later" type="button" onClick={() => moveGalleryPhoto(photo.id, 1)}>↓</button> : null}
                  <button
                    className="photo-card-remove-action"
                    type="button"
                    disabled={deletingPhotoIds.has(photo.id) || isArranging}
                    onClick={() => deletePhoto(photo)}
                  >
                    {deletingPhotoIds.has(photo.id) ? "Deleting..." : "Delete"}
                  </button>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function dancerPhotoItemsFromProfile(
  profile: LoadState["profile"],
  excludedPhotoIds: string[] = [],
): DancerPhotoItem[] {
  const approvedPhotos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const pendingReviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews as Array<Record<string, unknown>> : [];

  const approvedItems = approvedPhotos.flatMap<DancerPhotoItem>((photo) => {
    const id = String(photo.id || "").trim();
    if (!id) return [];
    const reviewStatus = normalizePhotoStatus(photo.review_status || photo.reviewStatus || "approved");
    const isPrimary = Boolean(photo.is_primary || photo.isPrimary);
    return [{
      id,
      imageUrl: String(photo.imageUrl || photo.image_url || ""),
      label: isPrimary ? "Main Photo" : "Photo",
      status: reviewStatus,
      note: photoStatusNote(reviewStatus),
      storagePath: String(photo.storage_path || photo.storagePath || ""),
      isPrimary,
      sortOrder: Number(photo.sort_order ?? photo.sortOrder ?? 0),
    }];
  });

  const pendingItems = pendingReviews.flatMap<DancerPhotoItem>((review) => {
    const id = String(review.id || "").trim();
    if (!id) return [];
    const isPrimary = Boolean(review.is_primary || review.isPrimary || String(review.upload_context || "").includes("main"));
    return [{
      id,
      imageUrl: String(review.previewUrl || review.preview_url || ""),
      label: isPrimary ? "Main Photo" : "Photo",
      status: "pending",
      note: "We are checking this photo. This page updates automatically.",
      storagePath: String(review.temporary_storage_path || review.storagePath || ""),
      isPrimary,
      sortOrder: Number(review.sort_order ?? review.sortOrder ?? (isPrimary ? 0 : 0)),
    }];
  });

  return mergePhotoItems(excludePendingDeletions([approvedItems, pendingItems].flat(), excludedPhotoIds));
}

function excludePendingDeletions(incomingPhotos: DancerPhotoItem[], pendingDeletedIds: string[]) {
  const deleted = new Set(pendingDeletedIds);
  return incomingPhotos.filter((photo) => !deleted.has(photo.id));
}

function nextGalleryPhotoSortOrder(photos: DancerPhotoItem[]) {
  const used = new Set(
    photos
      .filter((photo) => !photo.isPrimary)
      .map((photo) => Number(photo.sortOrder))
      .filter((sortOrder) => Number.isInteger(sortOrder) && sortOrder > 0),
  );
  for (let sortOrder = 1; sortOrder <= MAX_DANCER_PROFILE_PHOTOS; sortOrder += 1) {
    if (!used.has(sortOrder)) return sortOrder;
  }
  return MAX_DANCER_PROFILE_PHOTOS;
}

function preserveConfirmedPhotoPreviews(incomingPhotos: DancerPhotoItem[], currentPhotos: DancerPhotoItem[]) {
  const currentById = new Map(currentPhotos.map((photo) => [photo.id, photo]));
  return incomingPhotos.map((photo) => {
    const current = currentById.get(photo.id);
    if (photo.imageUrl || !current?.imageUrl) return photo;
    return { ...photo, imageUrl: current.imageUrl };
  });
}

function primaryPhotoIdFromProfile(profile: LoadState["profile"]) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const primary = photos.find((photo) => photo.is_primary || photo.isPrimary);
  return primary?.id || null;
}

function mergePhotoItems(...groups: DancerPhotoItem[][]) {
  const byKey = new Map<string, DancerPhotoItem>();
  groups.flat().forEach((photo) => {
    const sortOrder = Number(photo.sortOrder);
    const key = photo.isPrimary
      ? "main"
      : Number.isInteger(sortOrder) && sortOrder > 0
        ? `gallery:${sortOrder}`
        : `photo:${photo.id}`;
    byKey.set(key, photo);
  });
  return Array.from(byKey.values()).slice(0, MAX_DANCER_PROFILE_PHOTOS);
}

function relabelPhotoItems(items: DancerPhotoItem[]) {
  return orderPhotoItemsForDisplay(mergePhotoItems(items)).map((photo, index) => {
    if (index === 0) return { ...photo, label: "Main Photo" };
    return { ...photo, label: `Photo ${index + 1}` };
  });
}

function orderPhotoItemsForDisplay(items: DancerPhotoItem[]) {
  const primary = items.find((photo) => photo.isPrimary);
  const gallery = items
    .filter((photo) => photo !== primary)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  return primary ? [primary, ...gallery] : gallery;
}

function normalizePhotoStatus(value: unknown): DancerPhotoItem["status"] {
  const status = String(value || "").toLowerCase();
  if (status === "approved" || status === "live") return "approved";
  if (status === "rejected" || status === "denied") return "rejected";
  return "pending";
}

function photoStatusLabel(status: DancerPhotoItem["status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Choose another";
  return "Checking";
}

function photoStatusNote(status: DancerPhotoItem["status"]) {
  if (status === "approved") return "Ready for your profile.";
  if (status === "rejected") return "This photo cannot be used. Choose another photo.";
  return "We are checking this photo. This page updates automatically.";
}

function photoUploadStatusMessage(status: DancerPhotoItem["status"], message?: unknown) {
  const detail = typeof message === "string" && message.trim() ? message.trim() : photoStatusNote(status);
  if (status === "approved") return `Approved: ${detail}`;
  if (status === "rejected") return `Choose another photo: ${detail}`;
  return `Checking: ${detail}`;
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="info-panel">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VenueAnalyticsMetric({ label, value, change }: { label: string; value: number; change: number | null }) {
  return (
    <div className="metric venue-analytics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={change === null ? "" : change >= 0 ? "positive" : "negative"}>
        {change === null ? "No prior-period baseline" : `${change >= 0 ? "+" : ""}${change}% vs prior period`}
      </small>
    </div>
  );
}

function VenueDealReadOnlyPanel({
  deals,
  dealRequests,
  finance,
  isVenuePublished,
  referralFee,
  revenue,
  venueCity,
  venueSlug,
  canRequestDeals,
  onDealRequestsChange,
}: {
  deals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  finance?: LoadState["finance"];
  isVenuePublished: boolean;
  referralFee?: LoadState["referralFee"];
  revenue?: LoadState["dealRevenue"];
  venueCity: string;
  venueSlug: string;
  canRequestDeals: boolean;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
}) {
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestedOfferKey, setRequestedOfferKey] = useState<string>(CLUB_DEAL_OFFER_PRESETS[0].key);
  const [requestNotes, setRequestNotes] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [requestStatusTone, setRequestStatusTone] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [confirmedRequestId, setConfirmedRequestId] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const liveDeals = deals.filter((deal) => deal.isActive === true);
  const displayedDeals = [...liveDeals, ...deals.filter((deal) => deal.isActive !== true)];
  const currentFee = referralFee?.current && typeof referralFee.current === "object"
    ? referralFee.current as Record<string, unknown>
    : null;
  const scheduledFees = Array.isArray(referralFee?.scheduled)
    ? referralFee.scheduled as Array<Record<string, unknown>>
    : [];
  const feeHistory = Array.isArray(referralFee?.history)
    ? referralFee.history as Array<Record<string, unknown>>
    : [];

  async function submitDealRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRequesting(true);
    setRequestStatusTone("sending");
    setConfirmedRequestId("");
    setRequestStatus("Sending request to MyDancr…");
    try {
      const data = await requestDashboardJson("/api/venue/deal-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offerKey: requestedOfferKey, requestNotes }),
        expectedRole: "venue",
        fallbackMessage: "Unable to send this Club Deal request.",
      });
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
      setRequestStatus(`MyDancr received your ${confirmedOfferTitle} request. It is saved and pending review.`);
    } catch (error) {
      setRequestStatusTone("error");
      setRequestStatus(error instanceof Error ? error.message : "Unable to send this Club Deal request.");
    } finally {
      setIsRequesting(false);
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

      <section className="venue-contract-summary" aria-label="Current MyDancr agreement">
        <div>
          <span>Fee per confirmed guest</span>
          <strong>{currentFee ? `${formatCents(Number(currentFee.feeCents || 0))} per confirmed guest` : "Agreement pending"}</strong>
          <small>{currentFee ? `Effective ${formatDashboardDate(String(currentFee.effectiveFrom || ""))}` : "MyDancr records this after the venue agreement is signed."}</small>
        </div>
        <div>
          <span>Agreement ID</span>
          <strong>{currentFee ? String(currentFee.agreementReference || "Recorded by MyDancr") : "Not recorded"}</strong>
          <small>{scheduledFees.length ? `${scheduledFees.length} scheduled fee update${scheduledFees.length === 1 ? "" : "s"}` : "No scheduled fee changes"}</small>
        </div>
        <div>
          <span>Redemption status</span>
          <strong>{liveDeals.length ? "Enabled" : "Not active"}</strong>
          <small>Guests redeem by holding their phone near the MyDancr redemption sticker at checkout. MyDancr supplies and manages these stickers.</small>
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
              <div><dt>Fee per guest</dt><dd>{Number(deal.payoutAmountCents || 0) > 0 ? `${formatCents(Number(deal.payoutAmountCents || 0))} per confirmed guest` : "Pending"}</dd></div>
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
            <p>After the deal and agreed fee are recorded, the offer and its terms will appear here automatically.</p>
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
          <h3 id="venue-deal-request-heading">Request another deal</h3>
          <p>Send the offer details. MyDancr reviews the terms and publishes approved deals.</p>
        </div>
        {canRequestDeals ? (
          <button
            disabled={isRequesting}
            type="button"
            onClick={() => {
              setIsRequestOpen((current) => !current);
              setRequestStatus("");
              setRequestStatusTone("idle");
              setConfirmedRequestId("");
            }}
          >
            {isRequestOpen ? "Close request" : "Request a new deal"}
          </button>
        ) : <small>Only venue owners and managers can request a new deal.</small>}
        {isRequestOpen && canRequestDeals ? (
          <form onSubmit={submitDealRequest}>
            <label>
              Requested offer
              <select value={requestedOfferKey} onChange={(event) => setRequestedOfferKey(event.target.value)}>
                {CLUB_DEAL_OFFER_PRESETS.map((offer) => <option value={offer.key} key={offer.key}>{offer.title}</option>)}
              </select>
            </label>
            <label>
              Notes (optional)
              <textarea
                maxLength={1000}
                onChange={(event) => setRequestNotes(event.target.value)}
                placeholder="Dates, hours, exclusions, or other details"
                rows={4}
                value={requestNotes}
              />
            </label>
            <button className="primary" disabled={isRequesting} type="submit">{isRequesting ? "Sending…" : "Send request to MyDancr"}</button>
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
                  <strong>{String(dealRequest.offerTitle || "Club Deal request")}</strong>
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

      <details className="venue-contract-history">
        <summary>Agreement history</summary>
        <div>
          {feeHistory.map((term) => (
            <section key={String(term.id)}>
              <strong>{formatCents(Number(term.feeCents || 0))} per confirmed guest</strong>
              <span>{String(term.agreementReference || "MyDancr agreement")}</span>
              <small>{formatDashboardDate(String(term.effectiveFrom || ""))}{term.effectiveUntil ? ` – ${formatDashboardDate(String(term.effectiveUntil))}` : " onward"}</small>
            </section>
          ))}
          {!feeHistory.length ? <p>No agreement history has been recorded.</p> : null}
        </div>
      </details>

      <details className="venue-deal-performance" open>
        <summary><span><strong>Monthly activity & billing</strong><small>Confirmed redemptions, fees, and invoices</small></span></summary>
        <div className="venue-deal-performance-body">
          <div className="deal-metrics venue-deal-metrics">
            <Metric label="Confirmed redemptions" value={String(revenue?.confirmedCashierTapsThisMonth || 0)} />
            <Metric label="From dancer profiles" value={String(revenue?.dancerAttributedRedemptionsThisMonth || 0)} />
            <Metric label="Direct visits" value={String(revenue?.directVenueRedemptionsThisMonth || 0)} />
            <Metric label="Fees this month" value={formatCents(Number(revenue?.myDancrFeesCentsThisMonth || 0))} />
            <Metric label="Amount due" value={formatCents(Number(revenue?.pendingVenuePaymentCents || 0))} />
          </div>
          <VenueFinanceSummary finance={finance} />
        </div>
      </details>
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

function formatPercent(value: unknown) {
  const number = readOptionalNumber(value);
  return number === null ? "—" : `${number}%`;
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

function formatVenueReviewHours(opensAt: unknown, closesAt: unknown) {
  const formatTime = (value: unknown) => {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return "";
    const hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${match[2]} ${suffix}`;
  };
  const opens = formatTime(opensAt);
  const closes = formatTime(closesAt);
  return opens && closes ? `${opens} – ${closes}` : "";
}

function formatDashboardDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function DashboardSignInRecovery({
  onSignedIn,
  role,
}: {
  onSignedIn: () => void;
  role: "dancer" | "venue";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "login", role, email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (data.account?.role !== role || !data.session?.accessToken || !data.session?.refreshToken) {
        throw new Error(`Use a ${role} account to open this dashboard.`);
      }

      if (!persistDashboardSession({ ...data.session, account: data.account })) {
        throw new Error("Unable to save your dashboard session in this browser.");
      }
      setStatus(`Signed in. Opening your ${role} dashboard...`);
      onSignedIn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button className="primary-link" type="button" onClick={() => setIsOpen(true)}>
        Sign in
      </button>
    );
  }

  return (
    <form className="venue-sign-in-recovery dashboard-sign-in-recovery" onSubmit={signIn}>
      <p>Sign in here to reopen the dashboard without leaving this page.</p>
      <label>
        {role === "venue" ? "Venue" : "Dancer"} account email
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button className="primary-link" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Signing in..." : `Sign in to ${role} dashboard`}
      </button>
      {status ? <p className="venue-sign-in-status" role="status">{status}</p> : null}
    </form>
  );
}

function checkInErrorMessage(data: any) {
  const message = String(data?.error || "Unable to check in.");
  if (data?.code === "outside_geofence") {
    const requiredRadiusFeet = Number.isFinite(Number(data?.requiredRadiusFeet))
      ? Math.round(Number(data.requiredRadiusFeet))
      : 300;
    return `You can't check in yet. You're outside the club's ${requiredRadiusFeet.toLocaleString()} ft check-in area. Move closer to the club and try again.`;
  }
  if (Number.isFinite(Number(data?.distanceFeet)) && Number.isFinite(Number(data?.requiredRadiusFeet))) {
    return `${message} Your location was about ${Math.round(Number(data.distanceFeet)).toLocaleString()} ft away; check-in requires ${Math.round(Number(data.requiredRadiusFeet)).toLocaleString()} ft or less.`;
  }
  return message;
}

function dashboardName(profile: Record<string, unknown> | null | undefined, role: DashboardRole) {
  if (!profile) return "";
  if (role === "dancer") return persistedDancerStageName(profile);
  return "";
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function DashboardStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .dashboard-shell { --mydancr-dashboard-gap: 18px; --mydancr-dashboard-panel: #0b0b10; --mydancr-dashboard-panel-raised: #111118; --mydancr-dashboard-border: rgba(255,255,255,.11); --mydancr-dashboard-radius: 16px; --mydancr-dashboard-muted: rgba(218,214,230,.72); min-height: 100vh; padding: max(18px, calc(env(safe-area-inset-top) + 12px)) clamp(12px, 4vw, 56px) 56px; scroll-padding-top: max(18px, calc(env(safe-area-inset-top) + 12px)); background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.1), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.14), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
      .dashboard-head, .dashboard-grid { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .dashboard-close { flex: 0 0 42px; width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(180,169,196,.2); border-radius: 50%; color: #f8f7fb; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 10px 24px rgba(0,0,0,.3); text-decoration: none; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
      .dashboard-close svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; }
      .dashboard-close:hover { border-color: rgba(126,234,255,.42); background: rgba(38,34,48,.92); }
      .dashboard-close:active { transform: scale(.96); }
      .dashboard-close:focus-visible, .customer-dashboard-tabs a:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .primary-link { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      button.primary-link { width: fit-content; cursor: pointer; font: inherit; }
      button.primary-link:disabled { cursor: wait; opacity: .68; }
      .venue-sign-in-recovery { width: min(100%, 460px); display: grid; gap: 12px; padding: 18px; border: 1px solid rgba(139,92,246,.42); border-radius: 18px; background: rgba(5,5,10,.96); box-shadow: 0 18px 54px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.06); }
      .venue-sign-in-recovery > p { font-size: 15px; line-height: 1.45; }
      .venue-sign-in-recovery label { display: grid; gap: 7px; color: #f7f2ff; font-size: 13px; font-weight: 850; }
      .venue-sign-in-recovery input { min-height: 48px; box-sizing: border-box; padding: 0 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; color: #fff; background: #15141b; font: inherit; }
      .venue-sign-in-recovery input:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .venue-sign-in-recovery .primary-link { width: 100%; min-height: 48px; border-color: rgba(139,92,246,.7); background: linear-gradient(135deg, #5b21b6, #3b00b9); }
      .venue-sign-in-recovery .venue-sign-in-status { color: #bfefff; font-size: 14px; font-weight: 750; }
      .dashboard-head { min-height: 72px; box-sizing: border-box; display: grid; gap: 12px; margin-bottom: var(--mydancr-dashboard-gap); padding: 10px 12px 14px; border: 1px solid rgba(139,92,246,.16); border-radius: var(--mydancr-dashboard-radius); background: rgba(5,5,8,.98); box-shadow: 0 14px 34px rgba(0,0,0,.38); }
      .dashboard-head-row { display: grid; grid-template-columns: minmax(0, 1fr) 42px; align-items: center; gap: 12px; }
      .dashboard-head-copy { min-width: 0; display: grid; gap: 5px; align-content: center; overflow: hidden; }
      .dashboard-head-title-row { min-width: 0; display: flex; align-items: center; gap: 10px; }
      .dashboard-head h1 { max-width: 100%; overflow: hidden; color: #f8f7fb; font-family: var(--font-display, "Space Grotesk", "Outfit", sans-serif); font-size: clamp(21px, 5vw, 26px); font-weight: 850; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
      .dashboard-live-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid rgba(99,255,190,.28); border-radius: 999px; color: #8dffd0; background: rgba(32,185,121,.1); font-size: 10px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .dashboard-live-status i { width: 7px; height: 7px; border-radius: 50%; background: #65ffb9; box-shadow: 0 0 10px rgba(101,255,185,.5); }
      .dashboard-head p { font-size: clamp(15px, 2.2vw, 17px); line-height: 1.45; }
      .dashboard-head .eyebrow { color: #f8f7fb; }
      .dashboard-shell-venue .dashboard-head { min-height: 0; gap: 18px; padding: 24px 26px; border-radius: 24px; background: #07070a; box-shadow: 0 20px 48px rgba(0,0,0,.34); }
      .dashboard-shell-venue .dashboard-head-row { align-items: start; gap: 18px; }
      .dashboard-shell-venue .dashboard-head-copy { gap: 8px; overflow: visible; }
      .dashboard-shell-venue .dashboard-head h1 { overflow: visible; font-size: clamp(32px,5vw,48px); line-height: 1; text-overflow: clip; white-space: normal; }
      .dashboard-shell-venue .dashboard-head p { color: var(--mydancr-dashboard-muted); font-size: clamp(15px,2.2vw,17px); }
      .dashboard-shell-venue .dashboard-head .eyebrow { color: #94e5ff; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(32px, 5vw, 48px); line-height: 1; letter-spacing: -.025em; }
      h2 { margin: 0; font-size: 22px; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .dashboard-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--mydancr-dashboard-gap); }
      .agent-dashboard-shortcut { grid-column: 1 / -1; min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 18px; border: 1px solid rgba(126,234,255,.24); border-radius: var(--mydancr-dashboard-radius); color: #fff; background: linear-gradient(115deg, rgba(18,105,125,.18), rgba(48,22,91,.18)); text-decoration: none; }
      .agent-dashboard-shortcut span { display: grid; gap: 4px; }
      .agent-dashboard-shortcut small { color: #7eeaff; font-size: 11px; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
      .agent-dashboard-shortcut strong { font-size: 18px; }
      .agent-dashboard-shortcut b { color: #d9d2e9; font-size: 13px; white-space: nowrap; }
      .agent-dashboard-shortcut:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .venue-dashboard-grid { grid-template-columns: 1fr; }
      .dashboard-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .venue-dashboard-loading { display: grid; gap: var(--mydancr-dashboard-gap); }
      .venue-dashboard-loading-command, .venue-dashboard-loading-actions, .venue-dashboard-loading-metrics { border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .venue-dashboard-loading-command { min-height: 226px; display: grid; grid-template-columns: 112px minmax(0,1fr); align-items: start; gap: 18px; padding: 22px; }
      .venue-dashboard-loading-pill, .venue-dashboard-loading-copy span, .venue-dashboard-loading-actions span, .venue-dashboard-loading-metrics span { display: block; background: linear-gradient(100deg, rgba(255,255,255,.055) 20%, rgba(139,92,246,.13) 45%, rgba(255,255,255,.055) 70%); background-size: 240% 100%; animation: venueDashboardLoadingPulse 1.25s ease-in-out infinite; }
      .venue-dashboard-loading-pill { width: 86px; height: 42px; border-radius: 999px; }
      .venue-dashboard-loading-copy { display: grid; gap: 13px; padding-top: 3px; }
      .venue-dashboard-loading-copy span { height: 18px; border-radius: 7px; }
      .venue-dashboard-loading-copy span:first-child { width: min(78%, 330px); height: 28px; }
      .venue-dashboard-loading-copy span:last-child { width: min(62%, 260px); }
      .venue-dashboard-loading-actions { min-height: 86px; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; padding: 12px; }
      .venue-dashboard-loading-actions span { border-radius: 12px; }
      .venue-dashboard-loading-metrics { min-height: 74px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; overflow: hidden; }
      .venue-dashboard-loading-metrics span { border-radius: 0; }
      @keyframes venueDashboardLoadingPulse { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
      @media (prefers-reduced-motion: reduce) { .venue-dashboard-loading-pill, .venue-dashboard-loading-copy span, .venue-dashboard-loading-actions span, .venue-dashboard-loading-metrics span { animation: none; } }
      .venue-command-panel, .venue-publication-panel, .venue-workspace-tabs, .venue-workspace-summary, .venue-workspace-business-summary, .venue-dashboard-metrics { grid-column: 1 / -1; }
      .venue-command-panel { display: grid; gap: var(--mydancr-dashboard-gap); padding: 16px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 18px; background: var(--mydancr-dashboard-panel); }
      .venue-command-status { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 0 2px; }
      .venue-command-status h2 { color: #f8f7fb; font-size: 20px; letter-spacing: -.015em; line-height: 1.15; }
      .venue-command-status p, .venue-command-primary p { color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 760; line-height: 1.35; }
      .venue-live-pill { display: grid; place-items: center; padding: 7px 10px; border: 1px solid rgba(38,210,159,.65); border-radius: 999px; color: #76f0c8; background: rgba(10,74,57,.36); font-size: 11px; font-weight: 950; letter-spacing: .08em; }
      .venue-live-pill.is-draft { border-color: rgba(196,181,253,.38); color: #ddd6fe; background: rgba(109,40,217,.14); }
      .venue-live-pill.is-inactive { border-color: var(--mydancr-dashboard-border); color: var(--mydancr-dashboard-muted); background: rgba(255,255,255,.035); }
      .venue-refresh-control { display: grid; justify-items: end; gap: 5px; }
      .venue-refresh-control small, .venue-refresh-status { color: var(--mydancr-dashboard-muted); font-size: 10px; font-weight: 760; }
      .venue-refresh-control button { min-height: 34px; padding: 0 11px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; color: #f8fafc; background: rgba(255,255,255,.045); font: inherit; font-size: 11px; font-weight: 850; cursor: pointer; }
      .venue-refresh-control button:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-refresh-control button:disabled { opacity: .6; cursor: wait; }
      .venue-command-primary { display: grid; gap: 8px; padding: 16px; border: 1px solid rgba(255,255,255,.13); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel-raised); }
      .venue-command-primary > strong { color: #f8f7fb; font-size: clamp(21px, 4vw, 27px); line-height: 1.08; }
      .venue-command-links { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin-top: 5px; }
      .venue-command-primary .venue-current-deals-link, .venue-command-primary .venue-working-now-link { width: 100%; max-width: 100%; min-height: 52px; box-sizing: border-box; border-radius: 14px; }
      .venue-command-primary .venue-current-deals-link { border: 1px solid rgba(196,181,253,.58); color: #f8fafc; background: #7c3aed; box-shadow: 0 0 18px rgba(124,58,237,.2); }
      .venue-command-primary .venue-working-now-link { border: 1px solid var(--mydancr-dashboard-border); color: #f8fafc; background: #111118; box-shadow: none; }
      .venue-command-primary .venue-working-now-link.is-live { border-color: rgba(16,185,129,.58); color: #d1fae5; background: rgba(6,78,59,.34); box-shadow: 0 0 18px rgba(16,185,129,.12); }
      .venue-publication-panel { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(139,92,246,.32); border-radius: var(--mydancr-dashboard-radius); background: linear-gradient(145deg, rgba(31,19,53,.72), rgba(11,11,16,.98) 64%); box-shadow: inset 3px 0 0 rgba(139,92,246,.72); }
      .venue-publication-panel.is-published { border-color: rgba(16,185,129,.34); background: linear-gradient(145deg, rgba(6,78,59,.18), rgba(11,11,16,.98) 64%); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-publication-panel > div:first-child { display: grid; gap: 7px; }
      .venue-publication-panel h2 { margin: 0; color: #f8fafc; font-size: clamp(20px,3.5vw,27px); line-height: 1.08; }
      .venue-publication-panel p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.48; }
      .venue-publication-actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .venue-publication-actions > button, .venue-publication-actions > a { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 16px; border: 1px solid rgba(255,255,255,.16); border-radius: 10px; color: #f8fafc; background: #17171d; font: inherit; font-size: 13px; font-weight: 900; text-decoration: none; cursor: pointer; }
      .venue-publication-actions > .primary { border-color: rgba(196,181,253,.6); background: #7c3aed; box-shadow: 0 0 18px rgba(124,58,237,.2); }
      .venue-publication-actions > .venue-preview-action { gap: 9px; border-color: rgba(139,92,246,.7); background: linear-gradient(145deg,rgba(58,28,116,.82),rgba(20,11,40,.92)); box-shadow: 0 0 0 1px rgba(124,58,237,.15),0 0 22px rgba(124,58,237,.24),inset 0 1px 0 rgba(255,255,255,.08); }
      .venue-publication-actions > .venue-preview-action > svg { width: 18px; height: 18px; fill: none; stroke: #d8ccff; stroke-width: 1.8; filter: drop-shadow(0 0 7px rgba(167,139,250,.95)); }
      .venue-publication-actions > .venue-preview-action:hover { border-color: rgba(196,181,253,.92); background: linear-gradient(145deg,rgba(76,35,154,.9),rgba(28,14,56,.96)); box-shadow: 0 0 0 1px rgba(167,139,250,.2),0 0 28px rgba(124,58,237,.34),inset 0 1px 0 rgba(255,255,255,.1); }
      .venue-publication-actions > button:focus-visible, .venue-publication-actions > a:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
      .venue-publication-actions > button:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
      .venue-publication-panel > p[role="status"] { padding: 10px 12px; border: 1px solid rgba(148,229,255,.24); border-radius: 9px; color: #baf5ff; background: rgba(148,229,255,.07); font-weight: 850; }
      .venue-review-request { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(251,191,36,.25); border-radius: 10px; background: rgba(251,191,36,.045); }
      .venue-review-completion { display: grid; gap: 9px; padding: 14px; border: 1px solid rgba(139,92,246,.44); border-radius: 13px; background: linear-gradient(145deg,rgba(46,22,89,.36),rgba(8,8,12,.9)); box-shadow: inset 0 1px 0 rgba(255,255,255,.045); }
      .venue-review-completion h3 { margin: 0; color: #f8fafc; font-size: 19px; line-height: 1.15; }
      .venue-review-completion > p { color: #aaa3b4; font-size: 12px; line-height: 1.45; }
      .venue-review-completion .venue-publication-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin-top: 3px; }
      .venue-review-completion .venue-publication-actions > * { width: 100%; min-height: 52px; padding-inline: 18px; border-radius: 14px; line-height: 1.2; white-space: nowrap; }
      .venue-review-completion .venue-publication-actions > .venue-preview-action { border-color: rgba(167,139,250,.45) !important; background: rgba(8,8,13,.9) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.045) !important; }
      .venue-review-completion .venue-publication-actions > .venue-preview-action:hover { border-color: rgba(196,181,253,.72) !important; background: rgba(20,13,35,.94) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.06) !important; }
      .venue-review-completion .venue-publication-actions > .primary { border-color: rgba(196,181,253,.72) !important; color: #fff !important; background: linear-gradient(135deg,#6d28d9,#7c3aed) !important; box-shadow: 0 8px 22px rgba(76,29,149,.28), inset 0 1px 0 rgba(255,255,255,.14) !important; }
      .venue-review-package { display: grid; gap: 14px; padding: 14px; border: 1px solid rgba(255,255,255,.13); border-radius: 13px; background: rgba(8,8,12,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.035); }
      .venue-review-package-heading { min-width: 0; display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: center; gap: 13px; }
      .venue-review-package-heading > span:last-child { min-width: 0; display: grid; gap: 5px; }
      .venue-review-package-heading > span:last-child > strong { color: #f8fafc; font-size: clamp(19px,3vw,23px); line-height: 1.08; }
      .venue-review-package-heading > span:last-child > small { color: #a19aa9; font-size: 11px; line-height: 1.4; }
      .venue-review-logo { width: 72px; height: 72px; display: grid; place-items: center; overflow: hidden; box-sizing: border-box; padding: 8px; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; color: #f3eaff; background: #17171d; box-shadow: inset 0 1px 0 rgba(255,255,255,.045); font-size: 18px; font-weight: 950; letter-spacing: .06em; }
      .venue-review-logo img { width: 100%; height: 100%; display: block; object-fit: contain; }
      .venue-review-logo img.is-compact-logo-source { transform: scale(1.7); transform-origin: center; }
      .venue-review-package-section { min-width: 0; display: grid; gap: 9px; padding-top: 13px; border-top: 1px solid rgba(255,255,255,.09); }
      .venue-review-package-section > strong { color: #f8fafc; font-size: 15px; line-height: 1.2; }
      .venue-review-commercial-heading { min-width: 0; display: grid; gap: 5px; }
      .venue-review-commercial-heading strong { color: #f8fafc; font-size: 17px; line-height: 1.15; }
      .venue-review-commercial-heading small { color: #9ca3af; font-size: 11px; line-height: 1.4; }
      .venue-review-package dl { min-width: 0; display: grid; gap: 8px; margin: 0; }
      .venue-review-package dl > div { min-width: 0; display: grid; grid-template-columns: minmax(108px,.42fr) minmax(0,1fr); gap: 11px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.08); border-radius: 9px; background: rgba(255,255,255,.025); }
      .venue-review-package dt { color: #8f879a; font-size: 10px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
      .venue-review-package dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #f8fafc; font-size: 12px; font-weight: 800; line-height: 1.35; }
      .venue-review-request label { color: #f8fafc; font-size: 12px; font-weight: 900; }
      .venue-review-request textarea { width: 100%; min-height: 88px; box-sizing: border-box; resize: vertical; padding: 10px 11px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #f8fafc; background: #111118; font: inherit; }
      .venue-review-request textarea:focus { border-color: #7c3aed; outline: 2px solid rgba(124,58,237,.22); outline-offset: 1px; }
      .venue-review-request button { width: fit-content; min-height: 42px; padding: 0 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 9px; color: #f8fafc; background: #17171d; font: inherit; font-weight: 900; }
      .venue-review-request button:disabled { opacity: .45; cursor: not-allowed; }
      .venue-workspace-tabs { position: sticky; z-index: 30; top: max(8px, env(safe-area-inset-top)); display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; padding: 5px; border: 1px solid rgba(255,255,255,.12); border-radius: 16px; background: rgba(7,7,11,.94); box-shadow: 0 16px 38px rgba(0,0,0,.42); backdrop-filter: blur(18px); }
      .venue-workspace-tabs button { min-width: 0; min-height: 78px; display: grid; align-content: center; gap: 4px; padding: 8px 9px; border: 0; border-radius: 11px; color: #a9a3b3; background: transparent; font: inherit; text-align: center; cursor: pointer; }
      .venue-workspace-tabs button:hover { color: #fff; background: rgba(255,255,255,.045); }
      .venue-workspace-tabs button:focus-visible { outline: 2px solid #a78bfa; outline-offset: -2px; }
      .venue-workspace-tabs button.active { color: #fff; background: linear-gradient(135deg,rgba(124,58,237,.9),rgba(88,28,135,.92)); box-shadow: 0 8px 20px rgba(76,29,149,.28), inset 0 1px 0 rgba(255,255,255,.14); }
      .venue-workspace-tabs strong { overflow: hidden; font-size: 14px; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
      .venue-workspace-tabs small { display: grid; min-height: 21px; place-items: center; color: #cbd5e1; font-size: 9px; font-weight: 820; line-height: 1.18; }
      .venue-workspace-tabs button.active small { color: #f8fafc; }
      .venue-workspace-tab-status { overflow: hidden; color: #94a3b8; font-size: 8px; font-weight: 780; line-height: 1.12; text-overflow: ellipsis; white-space: nowrap; }
      .venue-workspace-tabs button.active .venue-workspace-tab-status { color: #ddd6fe; }
      .venue-workspace-business-summary { display: grid; gap: 7px; padding: 16px 18px; border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .venue-workspace-business-summary h2 { margin: 0; color: #f8fafc; font-size: clamp(20px,3.5vw,25px); line-height: 1.08; }
      .venue-workspace-business-summary p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.45; }
      .venue-workspace-summary[hidden], .venue-publication-panel[hidden], .venue-workspace-business-summary[hidden], .venue-dashboard-metrics[hidden], .venue-dashboard-section[hidden] { display: none !important; }
      .venue-dashboard-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel); }
      .venue-dashboard-metrics .metric { min-width: 0; min-height: 66px; padding: 12px 14px; border-left: 1px solid var(--mydancr-dashboard-border); background: transparent; }
      .venue-dashboard-metrics .metric:first-child { border-left: 0; }
      .venue-dashboard-metrics .metric strong { font-size: 22px; }
      .venue-dashboard-metrics .metric span { font-size: 10px; }
      .venue-tonight-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .venue-dashboard-section { grid-column: 1 / -1; overflow: clip; scroll-margin-top: calc(var(--mydancr-preview-banner-offset, 0px) + 12px); border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); box-shadow: none; }
      .venue-dashboard-section > summary { min-height: 76px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 16px 18px; color: #f8fafc; cursor: pointer; list-style: none; }
      .venue-dashboard-section > summary::-webkit-details-marker { display: none; }
      .venue-dashboard-section > summary:focus-visible { outline: 2px solid #7c3aed; outline-offset: -4px; }
      .venue-dashboard-section > summary:hover { background: rgba(255,255,255,.025); }
      .venue-dashboard-section[open] > summary { border-bottom: 1px solid var(--mydancr-dashboard-border); background: rgba(139,92,246,.035); }
      .venue-dashboard-section-copy { min-width: 0; display: grid; gap: 5px; }
      .venue-dashboard-section-copy > strong { color: #f8fafc; font-size: clamp(17px, 2.8vw, 21px); line-height: 1.05; }
      .venue-dashboard-section-copy > span:last-child { max-width: 72ch; color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 720; line-height: 1.35; }
      .venue-dashboard-section-badge { width: fit-content; padding: 7px 10px; border: 1px solid rgba(139,92,246,.34); border-radius: 999px; color: #e6ddf7; background: rgba(109,40,217,.13); font-size: 11px; font-weight: 900; white-space: nowrap; }
      .venue-dashboard-section-toggle { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(124,58,237,.44); border-radius: 50%; color: #f8fafc; background: rgba(124,58,237,.15); font-size: 20px; line-height: 1; transition: transform .18s ease, background .18s ease; }
      .venue-dashboard-section[open] .venue-dashboard-section-toggle { transform: rotate(45deg); background: rgba(124,58,237,.28); }
      .venue-dashboard-section-toggle.is-chevron svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .venue-dashboard-section[open] .venue-dashboard-section-toggle.is-chevron { transform: rotate(180deg); background: rgba(124,58,237,.2); }
      .venue-dashboard-section-body { display: grid; gap: var(--mydancr-dashboard-gap); padding: 16px; }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-summary { border-color: rgba(76,223,166,.2); background: linear-gradient(145deg,rgba(8,25,20,.58),#09090d 70%); }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-primary { border-color: rgba(139,92,246,.3); background: linear-gradient(145deg,rgba(25,16,41,.82),#09090d 72%); box-shadow: inset 3px 0 0 rgba(139,92,246,.62); }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-secondary { border-color: rgba(148,229,255,.17); background: linear-gradient(145deg,rgba(10,21,27,.48),#09090d 72%); }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-utility { border-color: rgba(255,255,255,.075); background: #07070a; }
      .dashboard-shell-dancer .dashboard-section-summary > summary { min-height: 68px; }
      .dashboard-shell-dancer .dashboard-section-primary > summary { min-height: 80px; }
      .dashboard-shell-dancer .dashboard-section-secondary > summary { min-height: 72px; }
      .dashboard-shell-dancer .dashboard-section-utility > summary { min-height: 64px; }
      .dashboard-shell-dancer .dashboard-section-primary .venue-dashboard-section-copy > strong { font-size: clamp(20px,3vw,23px); }
      .dashboard-shell-dancer .dashboard-section-utility .venue-dashboard-section-copy > strong { color: #e4e2e8; font-size: clamp(16px,2.5vw,18px); }
      .dashboard-shell-dancer .dashboard-section-utility .venue-dashboard-section-copy > span:last-child { color: rgba(218,218,226,.72); font-size: 12px; }
      .dashboard-shell-dancer .dashboard-section-summary .venue-dashboard-section-toggle,
      .dashboard-shell-dancer .dashboard-section-utility .venue-dashboard-section-toggle { width: 28px; height: 28px; }
      .dancer-status-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }
      .dashboard-shell-dancer .dancer-status-metrics .metric { min-width: 0; min-height: 68px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.1) !important; border-radius: 12px !important; background: rgba(255,255,255,.035) !important; }
      .dashboard-shell-dancer .dancer-status-metrics .metric span { color: rgba(218,218,226,.68); font-size: 11px; }
      .dashboard-shell-dancer .dancer-status-metrics .metric strong { font-size: clamp(15px,2.4vw,18px); }
      .venue-dashboard-inner-grid { display: grid; gap: var(--mydancr-dashboard-gap); }
      .venue-dashboard-overview-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .venue-dashboard-account-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .venue-dashboard-section-body > .info-panel, .venue-dashboard-inner-grid > .info-panel { grid-column: auto; border-color: transparent; background: var(--mydancr-dashboard-panel-raised); box-shadow: none; }
      .venue-dashboard-account-grid > .support-panel, .venue-dashboard-account-grid > .account-controls-panel { grid-column: 1 / -1; }
      .customer-dashboard-tabs { position: sticky; z-index: 20; top: max(8px, env(safe-area-inset-top)); grid-column: 1 / -1; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding: 5px; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; background: rgba(7,7,11,.92); box-shadow: 0 16px 38px rgba(0,0,0,.4); backdrop-filter: blur(16px); }
      .customer-dashboard-tabs a { min-width: 0; min-height: 42px; display: grid; place-items: center; padding: 0 8px; border-radius: 11px; color: #d8cfeb; font-size: 13px; font-weight: 900; text-align: center; text-decoration: none; }
      .customer-dashboard-tabs a:hover { color: #fff; background: rgba(126,234,255,.08); }
      .customer-action-status { grid-column: 1 / -1; max-width: none; padding: 11px 14px; border: 1px solid rgba(126,234,255,.28); border-radius: 10px; color: #aaf2ff; background: rgba(11,87,110,.16); font-size: 14px; }
      .info-panel { border: 1px solid var(--mydancr-dashboard-border); background: var(--mydancr-dashboard-panel); border-radius: var(--mydancr-dashboard-radius); padding: 16px; display: grid; gap: 14px; box-shadow: none; }
      .info-panel h2 { font-size: clamp(20px, 3vw, 24px); line-height: 1.08; }
      .info-panel > p { color: var(--mydancr-dashboard-muted); font-size: 14px; line-height: 1.45; }
      .info-panel > div { display: grid; gap: 10px; }
      .setup-panel { grid-column: span 3; }
      .setup-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .setup-panel label, .upload-panel label, .verification-panel label, .shift-panel label, .customer-settings-panel label, .socials-panel label, .share-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .setup-panel label:nth-of-type(4) { grid-column: span 3; }
      .setup-panel input, .setup-panel textarea, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select, .customer-settings-panel input[type="text"], .customer-settings-panel input:not([type]), .socials-panel input, .share-panel input { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .setup-panel input, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select, .customer-settings-panel input:not([type]), .socials-panel input, .share-panel input { min-height: 42px; }
      .setup-panel .dancer-stage-name-input { box-sizing: border-box; height: 56px; min-height: 56px; max-height: 56px; padding-block: 0; }
      .setup-panel textarea { resize: vertical; min-height: 108px; }
      .setup-panel button, .upload-panel button, .verification-panel button, .shift-panel button, .customer-settings-panel button, .socials-panel button, .share-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; }
      .setup-panel button:disabled, .upload-panel button:disabled, .verification-panel button:disabled, .shift-panel button:disabled, .customer-settings-panel button:disabled, .socials-panel button:disabled { opacity: .62; cursor: wait; }
      .setup-panel p, .upload-panel p, .verification-panel p, .shift-panel p, .customer-settings-panel p, .socials-panel p, .share-panel p { color: #94e5ff; font-size: 14px; }
      .visibility-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #6d28d9, #22c7ff); font: inherit; font-weight: 950; cursor: pointer; }
      .visibility-panel button:disabled { opacity: .62; cursor: wait; }
      .visibility-panel.is-incognito { border-color: rgba(148,229,255,.34); box-shadow: inset 0 0 0 1px rgba(148,229,255,.08); }
      .visibility-copy { display: grid; gap: 8px; }
      .visibility-state { width: fit-content; min-height: 34px; display: inline-flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #fff; background: rgba(255,255,255,.045); }
      .visibility-state strong { font-size: 13px; }
      .visibility-state span { color: rgba(255,255,255,.38); }
      .visibility-state b { color: #70efbd; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
      .visibility-panel.is-incognito .visibility-state b { color: #b7effa; }
      .visibility-copy p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.45; }
      .visibility-panel button.visibility-toggle { width: fit-content; min-height: 44px; padding: 0 13px; border-radius: 999px; font-size: 11px; }
      .visibility-status { margin: 0; }
      .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .visibility-panel, .venue-working-panel, .venue-verification-panel { grid-column: span 3; }
      .dancer-performance-workspace { display: grid; gap: 14px; }
      .dancer-nats-signup-callout { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 16px; padding: 17px 18px; border: 1px solid rgba(148,229,255,.26); border-radius: var(--mydancr-dashboard-radius); background: linear-gradient(145deg,rgba(12,33,42,.68),#09090d 72%); box-shadow: inset 3px 0 0 rgba(148,229,255,.58); }
      .dancer-nats-signup-copy { min-width: 0; display: grid; gap: 5px; }
      .dancer-nats-signup-copy .eyebrow { color: #94e5ff; }
      .dancer-nats-signup-copy > strong { color: #fff; font-size: clamp(18px,2.8vw,22px); line-height: 1.08; }
      .dancer-nats-signup-copy > small { max-width: 68ch; color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 720; line-height: 1.4; }
      .dancer-nats-signup-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
      .dancer-nats-signup-actions > a, .dancer-nats-signup-actions > button, .dancer-nats-signup-actions > b { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; font: inherit; font-size: 13px; font-weight: 950; text-align: center; text-decoration: none; white-space: nowrap; }
      .dancer-nats-signup-actions > a { border-color: rgba(126,234,255,.48); color: #fff; background: linear-gradient(135deg,#6d28d9,#0b94c9); box-shadow: 0 8px 22px rgba(61,27,143,.24); }
      .dancer-nats-signup-actions > a.secondary { border-color: rgba(255,255,255,.14); color: #f8f7fb; background: #17171d; box-shadow: none; }
      .dancer-nats-signup-actions > button { color: #f8f7fb; background: #17171d; cursor: pointer; }
      .dancer-nats-signup-actions > b { color: var(--mydancr-dashboard-muted); background: rgba(255,255,255,.035); }
      .dancer-nats-signup-actions > a:focus-visible, .dancer-nats-signup-actions > button:focus-visible { outline: 2px solid #94e5ff; outline-offset: 3px; }
      .dancer-performance-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel-raised); }
      .dancer-performance-summary .metric { min-height: 76px; padding: 13px 15px; border-top: 0; border-left: 1px solid var(--mydancr-dashboard-border); }
      .dancer-performance-summary .metric:first-child { border-left: 0; }
      .dancer-performance-details { display: grid; gap: 10px; }
      .dancer-performance-detail { overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel-raised); }
      .dancer-performance-detail > summary { min-height: 78px; display: grid; grid-template-columns: minmax(0, 1fr) auto 38px; align-items: center; gap: 12px; padding: 14px 16px; list-style: none; cursor: pointer; }
      .dancer-performance-detail > summary::-webkit-details-marker, .dancer-performance-explainer > summary::-webkit-details-marker { display: none; }
      .dancer-performance-detail > summary > span { min-width: 0; display: grid; gap: 4px; }
      .dancer-performance-detail > summary strong { color: #fff; font-size: 18px; }
      .dancer-performance-detail > summary small { color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.35; }
      .dancer-performance-detail > summary > b { width: fit-content; padding: 6px 9px; border: 1px solid rgba(50,255,164,.22); border-radius: 999px; color: #78ffc0; background: rgba(50,255,164,.06); font-size: 11px; white-space: nowrap; }
      .dancer-performance-detail > summary > i { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid rgba(124,58,237,.48); border-radius: 50%; color: #fff; background: rgba(82,35,214,.2); font-size: 24px; font-style: normal; line-height: 1; transition: transform .18s ease; }
      .dancer-performance-detail[open] > summary > i { transform: rotate(45deg); }
      .dancer-performance-detail > summary:focus-visible, .dancer-performance-explainer > summary:focus-visible, .earnings-history-tabs button:focus-visible { outline: 2px solid #94e5ff; outline-offset: -3px; }
      .dancer-performance-detail-body { padding: 16px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .dancer-performance-detail-body > .info-panel { grid-column: auto; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .dancer-performance-progress { margin: 0; padding: 11px 13px; border: 1px solid rgba(50,255,164,.2); border-radius: 10px; color: #dfffee !important; background: rgba(50,255,164,.06); font-weight: 850; }
      .dancer-performance-explainer { overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: rgba(255,255,255,.025); }
      .dancer-performance-explainer > summary { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 13px; color: #f7f2ff; font-size: 13px; font-weight: 900; list-style: none; cursor: pointer; }
      .dancer-performance-explainer > summary::after { content: "+"; color: #94e5ff; font-size: 20px; line-height: 1; }
      .dancer-performance-explainer[open] > summary::after { content: "−"; }
      .dancer-performance-explainer > .deal-metrics, .dancer-performance-explainer > .commission-tier-table, .dancer-performance-explainer > .dancer-performance-explainer-copy { margin: 0 12px 12px; }
      .dancer-performance-explainer > p { margin: 0; padding: 0 13px 13px; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.5; }
      .dancer-performance-explainer-copy { display: grid; gap: 8px; }
      .dancer-performance-explainer-copy p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.5; }
      .earnings-history { display: grid; gap: 12px; }
      .earnings-history-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; padding: 5px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: rgba(255,255,255,.025); }
      .earnings-history-tabs button { min-height: 40px; border: 0; border-radius: 7px; color: var(--mydancr-dashboard-muted); background: transparent; font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; }
      .earnings-history-tabs button.active { color: #fff; background: rgba(82,35,214,.48); box-shadow: inset 0 0 0 1px rgba(124,58,237,.5); }
      .earnings-filters { display: flex !important; flex-wrap: wrap; gap: 6px !important; }
      .earnings-filters button { min-height: 34px; padding: 0 10px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 999px; color: var(--mydancr-dashboard-muted); background: rgba(255,255,255,.03); font: inherit; font-size: 11px; font-weight: 850; cursor: pointer; }
      .earnings-filters button.active { border-color: rgba(148,229,255,.38); color: #fff; background: rgba(148,229,255,.1); }
      .earnings-statement-button { width: fit-content; min-height: 40px; padding: 0 12px; }
      .weekly-result-summary { display: flex !important; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: rgba(255,255,255,.03); }
      .weekly-result-summary > span { display: grid; gap: 3px; }
      .weekly-result-summary strong { color: #fff; font-size: 17px; }
      .weekly-result-summary small, .weekly-result-summary b { color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .impact-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .event-list { display: grid; gap: 10px; }
      .event-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .event-row span { color: #b9accd; font-size: 13px; }
      .impact-panel p { color: #94e5ff; font-size: 14px; }
      .locked-analytics-panel { grid-column: span 2; align-content: start; }
      .locked-analytics-head { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; }
      .locked-analytics-head span { width: fit-content; padding: 5px 9px; border-radius: 999px; border: 1px solid rgba(148,229,255,.2); background: rgba(148,229,255,.08); color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .locked-analytics-panel p { color: #fff; font-size: 18px; font-weight: 900; }
      .locked-analytics-panel small { color: #b9accd; font-size: 14px; line-height: 1.55; }
      .locked-preview-list { display: grid; gap: 8px; margin-top: 2px; }
      .locked-preview-list span { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); color: rgba(247,242,255,.72); font-size: 13px; font-weight: 850; }
      .share-panel-head { display: flex !important; align-items: center; justify-content: space-between; gap: 14px; }
      .share-panel-head > div { display: grid; gap: 5px; }
      .share-free-badge { width: fit-content; padding: 6px 9px; border: 1px solid rgba(50,255,164,.22); border-radius: 999px; color: #78ffc0; background: rgba(50,255,164,.06); font-size: 11px; white-space: nowrap; }
      .share-grid { display: grid; gap: 10px; }
      .share-link-row { min-width: 0; padding: 12px 13px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: var(--mydancr-dashboard-panel-raised); }
      .share-link-row > span { min-width: 0; display: grid; gap: 4px; }
      .share-link-row small { color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .share-link-row strong { overflow: hidden; color: #fff; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
      .share-grid img, .qr-placeholder { width: 180px; height: 180px; border-radius: 8px; background: #f7f2ff; }
      .qr-placeholder { display: grid; place-items: center; color: #050507; font-weight: 950; }
      .share-actions { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px !important; }
      .share-panel .share-actions button, .share-actions a { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 13px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 900; text-decoration: none; }
      .share-panel .share-actions button { border: 1px solid rgba(124,58,237,.5); color: #fff; background: rgba(82,35,214,.56); }
      .share-actions a { border: 1px solid rgba(255,255,255,.12); color: #fff; background: rgba(255,255,255,.06); }
      .share-status { margin: 0; color: #78ffc0 !important; font-size: 12px !important; }
      .socials-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .upload-panel form, .verification-panel form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: end; }
      .shift-panel form { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 12px; align-items: end; }
      .shift-checkin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px; border-radius: 8px; border: 1px solid rgba(148,229,255,.18); background: rgba(148,229,255,.06); }
      .shift-checkin-card.ready { border-color: rgba(50,255,164,.42); background: rgba(50,255,164,.1); box-shadow: inset 3px 0 0 rgba(50,255,164,.78); }
      .shift-checkin-card span { display: grid; gap: 5px; }
      .shift-checkin-card strong { color: #fff; font-size: 18px; }
      .shift-checkin-card small { color: #cfc5de; line-height: 1.45; }
      .shift-checkin-card button { min-height: 44px; border: 0; border-radius: 8px; color: #050507; background: #94e5ff; font-weight: 950; cursor: pointer; padding: 0 16px; }
      .shift-checkin-card button.check-in-retry { color: #fff; background: #7c3aed; box-shadow: 0 10px 24px rgba(82,35,214,.26), inset 0 1px 0 rgba(255,255,255,.12); }
      .shift-checkin-card button.check-in-retry::before { content: "↻"; margin-right: 7px; font-size: 16px; line-height: 1; }
      .shift-checkin-card button.check-in-confirmation, .shift-actions button.check-in-confirmation { border: 1px solid var(--dancr-color-success-medium); color: var(--dancr-color-success); background: var(--dancr-color-success-soft); box-shadow: inset 0 0 0 1px var(--dancr-color-success-soft) !important; cursor: default !important; filter: none !important; opacity: 1 !important; }
      .shift-checkin-card .shift-checkin-status { grid-column: 1 / -1; display: block; padding: 10px 12px; border: 1px solid rgba(148,229,255,.24); border-radius: 8px; color: #94e5ff; background: rgba(148,229,255,.08); font-weight: 850; }
      .shift-checkin-card .shift-checkin-status.is-error { border-color: var(--dancr-color-danger-medium); color: #fecaca; background: var(--dancr-color-danger-soft); }
      .shift-checkin-card .shift-checkin-status.is-success { border-color: var(--dancr-color-success-medium); color: #a7f3d0; background: var(--dancr-color-success-soft); }
      .shift-checkin-card button.shift-demo-managed:disabled { border: 1px solid rgba(255,255,255,.12); color: #b7b1c0; background: rgba(255,255,255,.055); box-shadow: none; cursor: default; filter: none; opacity: 1; }
      .shift-end-confirmation { grid-column: 1 / -1; display: grid !important; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 12px; border: 1px solid rgba(245,158,11,.34); border-radius: 10px; background: rgba(120,53,15,.18); }
      .shift-end-confirmation > span { min-width: 0; display: grid; gap: 4px; }
      .shift-end-confirmation > span strong { font-size: 15px; }
      .shift-end-confirmation > span small { color: #e7d7be; }
      .shift-end-confirmation > div { display: grid; grid-template-columns: repeat(2,minmax(112px,1fr)); gap: 8px; }
      .shift-end-confirmation button { min-height: 44px; padding: 0 13px; }
      .shift-end-confirmation button.shift-end-cancel { border: 1px solid rgba(255,255,255,.14); color: #fff; background: rgba(255,255,255,.07); }
      .shift-end-confirmation button.shift-end-confirm { border: 1px solid var(--dancr-color-danger-medium); color: #fee2e2; background: var(--dancr-color-danger-soft); }
      .shift-list-head { display: grid; gap: 4px; padding-top: 4px; }
      .shift-list-head strong { color: #fff; font-size: 18px; }
      .shift-list-head small { color: #b9accd; line-height: 1.45; }
      .check-row { min-height: 42px; display: flex !important; align-items: center; gap: 9px !important; padding-bottom: 10px; }
      .check-row input { width: 18px; height: 18px; }
      .dancer-photo-upload-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
      .photo-upload-heading { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .photo-upload-heading > span { min-width: 0; display: grid; gap: 3px; }
      .photo-upload-heading strong { color: #fff; font-size: 15px; }
      .photo-upload-heading small { color: #aca4b7; font-size: 12px; line-height: 1.4; }
      .photo-upload-heading > b { flex: 0 0 auto; padding: 5px 8px; border: 1px solid rgba(126,234,255,.22); border-radius: 999px; color: #b7effa; background: rgba(34,199,255,.07); font-size: 10px; white-space: nowrap; }
      .photo-primary-choice { min-width: 0; display: flex !important; align-items: center; gap: 9px !important; padding: 9px 10px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; color: #f4eff9; background: rgba(255,255,255,.035); cursor: pointer; }
      .photo-primary-choice input { width: 18px; height: 18px; flex: 0 0 18px; margin: 0; accent-color: #22c7ff; }
      .photo-primary-choice > span { min-width: 0; display: grid; gap: 2px; }
      .photo-primary-choice strong { font-size: 12px; }
      .photo-primary-choice small { color: #a69daf; font-size: 10px; line-height: 1.35; }
      .photo-source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 10px; }
      .photo-source-action { position: relative; min-width: 0; min-height: 74px; height: 100%; display: grid !important; grid-template-columns: 42px minmax(0,1fr) auto; align-items: center; gap: 9px !important; overflow: hidden; padding: 10px; border: 1px solid rgba(126,234,255,.2); border-radius: 12px; color: #f8f5fb; background: linear-gradient(145deg,rgba(124,58,237,.13),rgba(34,199,255,.055)); box-sizing: border-box; cursor: pointer; }
      .photo-source-action:hover { border-color: rgba(126,234,255,.42); background: linear-gradient(145deg,rgba(124,58,237,.2),rgba(34,199,255,.09)); }
      .photo-source-action:focus-within { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .photo-source-action.is-disabled { opacity: .58; cursor: wait; }
      .photo-source-input { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; min-height: 0 !important; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
      .photo-source-input:disabled { cursor: wait; }
      .photo-source-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; color: #8beafa; background: rgba(34,199,255,.09); }
      .photo-source-icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .photo-source-copy { min-width: 0; display: grid; gap: 2px; }
      .photo-source-copy strong { color: #fff; font-size: 13px; }
      .photo-source-copy small { color: #aaa2b4; font-size: 10px; line-height: 1.3; }
      .photo-source-cta { min-width: 60px; display: grid; place-items: center; padding: 5px 7px; border: 1px solid rgba(126,234,255,.2); border-radius: 999px; color: #b8effa; background: rgba(34,199,255,.07); box-sizing: border-box; font-size: 9px; font-weight: 950; text-transform: uppercase; }
      .photo-upload-queue { display: grid; gap: 10px; margin-top: 12px; }
      .photo-review-card.is-uploading { border-color: rgba(34,211,238,.58); box-shadow: inset 3px 0 0 rgba(34,211,238,.88); }
      .photo-slot-summary { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #b9eff8; font-size: 11px; }
      .photo-slot-summary strong { color: #e7faff; font-size: 11px; }
      .photo-slot-summary span { color: #9a91a4; }
      .photo-upload-status { margin: 0; padding: 8px 10px; border-radius: 9px; color: #c9f5fc; background: rgba(34,199,255,.07); font-size: 11px; line-height: 1.4; }
      .photo-review-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
      .photo-review-card { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .photo-review-list .photo-review-card { grid-template-columns: minmax(0, 1fr); align-content: start; min-height: 310px; }
      .photo-review-list .photo-preview { width: 100%; aspect-ratio: 4 / 5; }
      .photo-review-card.is-pending { border-color: rgba(217,173,79,.58); background: rgba(217,173,79,.1); box-shadow: inset 3px 0 0 rgba(217,173,79,.88); }
      .photo-review-card.is-approved { border-color: rgba(50,255,164,.36); background: rgba(50,255,164,.08); }
      .photo-review-card.is-rejected { border-color: rgba(255,104,124,.58); background: rgba(255,104,124,.12); box-shadow: inset 3px 0 0 rgba(255,104,124,.9); }
      .photo-review-card span { display: grid; gap: 4px; }
      .photo-review-card strong { color: #fff; }
      .photo-review-card small { color: #94e5ff; font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: .08em; }
      .photo-review-card em { color: #cfc5de; font-size: 13px; font-style: normal; line-height: 1.35; }
      .photo-review-card progress { width: 100%; height: 7px; accent-color: #7eeaff; }
      .photo-queue-actions, .photo-card-actions { display: flex !important; flex-wrap: wrap; gap: 7px !important; }
      .photo-card-actions { align-items: center; margin-top: 5px; }
      .photo-card-actions button, .photo-retry-button { min-height: 44px; padding: 0 11px; border: 1px solid rgba(34,211,238,.28); border-radius: 999px; color: #b5f1ff; background: rgba(34,211,238,.08); font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; }
      .photo-card-actions button:disabled, .photo-retry-button:disabled { opacity: .5; cursor: wait; }
      .photo-card-actions .photo-main-action { flex: 1 1 auto; min-width: 86px; min-height: 44px !important; padding: 0 13px !important; border-radius: 999px !important; font-size: 11px !important; white-space: nowrap; }
      .photo-card-actions .photo-order-action { width: 44px; min-width: 44px; max-width: 44px; min-height: 44px !important; padding: 0 !important; border-color: rgba(126,234,255,.2) !important; border-radius: 50% !important; color: #d5f8ff !important; background: rgba(126,234,255,.07) !important; box-shadow: none !important; font-size: 17px !important; }
      .photo-card-actions .photo-order-action:hover { border-color: rgba(126,234,255,.48) !important; background: rgba(126,234,255,.13) !important; }
      .photo-card-actions .photo-card-remove-action { flex: 0 0 auto; min-height: 44px !important; padding: 0 12px !important; border-color: rgba(255,104,124,.34) !important; border-radius: 999px !important; color: #ffbdc7 !important; background: rgba(255,104,124,.08) !important; box-shadow: none !important; font-size: 11px !important; }
      .photo-card-actions .photo-card-remove-action:hover { border-color: rgba(255,104,124,.62) !important; color: #ffe0e5 !important; background: rgba(255,104,124,.15) !important; }
      .photo-delete-button { width: fit-content; min-height: 36px; margin-top: 4px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.14); color: #ffd6dc; font: inherit; font-size: 13px; font-weight: 950; cursor: pointer; }
      .photo-delete-button:disabled { opacity: .62; cursor: wait; }
      .photo-preview { width: 96px; aspect-ratio: 3 / 4; display: grid; place-items: center; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,.12); color: #94e5ff; font-size: 12px; font-weight: 950; text-transform: uppercase; }
      .photo-preview:not(.empty) { filter: brightness(1.14) contrast(1.03); }
      .review-list { display: grid; gap: 10px; }
      .review-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .review-row span { color: #94e5ff; font-size: 13px; font-weight: 850; text-transform: capitalize; }
      .review-row.is-rejected { border-color: rgba(255,104,124,.58); background: rgba(255,104,124,.12); box-shadow: inset 3px 0 0 rgba(255,104,124,.9); }
      .review-row.is-rejected strong, .review-row.is-rejected span { color: #ffb3bf; }
      .review-row.is-approved { border-color: rgba(50,255,164,.36); background: rgba(50,255,164,.08); }
      .shift-list { display: grid; gap: 10px; }
      .dashboard-shift { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .dashboard-shift.is-deleting { opacity: .66; }
      .dashboard-shift span { display: grid; gap: 4px; }
      .dashboard-shift small { color: #b9accd; }
      .dashboard-shift em { width: fit-content; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(148,229,255,.22); background: rgba(148,229,255,.08); color: #94e5ff; font-size: 11px; font-style: normal; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .dashboard-shift label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .dashboard-shift input, .dashboard-shift select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .dashboard-shift button { color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); padding: 0 12px; }
      .dashboard-shift button:disabled { cursor: wait; }
      .shift-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .shift-actions button:first-child { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.1); }
      .shift-panel-feedback { margin: 0; color: #94e5ff; font-size: 14px; line-height: 1.45; }
      .billing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .billing-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .billing-actions button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .billing-actions p { color: #94e5ff; font-size: 14px; }
      .account-summary-panel { align-content: start; }
      .account-summary-heading { display: flex !important; align-items: center; justify-content: space-between; gap: 12px !important; }
      .account-summary-heading h2, .support-panel-heading h2, .account-controls-heading h2 { margin: 0; }
      .account-status-pill { width: fit-content; min-height: 30px; display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #d7d1df; background: rgba(255,255,255,.045); font-size: 11px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .account-status-pill.is-active { border-color: rgba(52,211,153,.3); color: #86efac; background: rgba(6,78,59,.2); }
      .account-summary-list { display: grid; margin: 0; border-top: 1px solid rgba(255,255,255,.08); }
      .account-summary-list > div { min-width: 0; min-height: 52px; display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .account-summary-list > div:last-child { border-bottom: 0; }
      .account-summary-list dt { color: #9f96ac; font-size: 12px; font-weight: 850; }
      .account-summary-list dd { min-width: 0; margin: 0; color: #f8f7fb; font-size: 15px; font-weight: 850; overflow-wrap: anywhere; }
      .account-controls-heading, .support-panel-heading { display: grid !important; gap: 5px !important; }
      .account-controls-heading p, .support-panel-heading p { margin: 0; color: #a9a1b3; font-size: 13px; line-height: 1.45; }
      .account-actions { display: grid !important; gap: 0 !important; }
      .account-action-row { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 14px; padding: 13px 0; border-top: 1px solid rgba(255,255,255,.08); }
      .account-action-row > span { min-width: 0; display: grid; gap: 3px; }
      .account-action-row strong { color: #f8f7fb; font-size: 14px; }
      .account-action-row small { color: #9f96ac; font-size: 12px; line-height: 1.4; }
      .account-action-button { min-width: 88px; min-height: 40px; border: 1px solid rgba(255,255,255,.13); border-radius: 10px; color: #f8f7fb; background: rgba(255,255,255,.055); font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; padding: 0 13px; }
      .account-action-button:hover { border-color: rgba(196,181,253,.4); background: rgba(124,58,237,.12); }
      .account-action-button:disabled { opacity: .55; cursor: wait; }
      .account-danger-row { margin-top: 4px; padding: 12px; border: 1px solid rgba(248,113,113,.2); border-radius: 12px; background: rgba(127,29,29,.08); }
      .account-actions .danger-button { color: #fecaca; background: rgba(127,29,29,.22); border-color: rgba(248,113,113,.28); }
      .account-delete-confirmation { display: grid !important; gap: 10px !important; margin-top: 10px; padding: 13px; border: 1px solid rgba(248,113,113,.24); border-radius: 12px; background: rgba(69,10,10,.2); }
      .account-delete-confirmation label { color: #e7dce9; font-size: 12px; line-height: 1.45; }
      .account-delete-confirmation label strong { color: #fecaca; letter-spacing: .08em; }
      .account-delete-confirmation input { min-height: 42px; box-sizing: border-box; padding: 0 12px; border: 1px solid rgba(248,113,113,.3); border-radius: 9px; color: #fff; background: rgba(5,5,7,.72); font: inherit; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .account-delete-confirmation input:focus-visible { outline: 2px solid #ef4444; outline-offset: 2px; }
      .account-delete-confirmation > div { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
      .account-actions p { margin: 10px 0 0; color: #94e5ff; font-size: 14px; }
      .notification-title-row { display: flex !important; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px !important; }
      .notification-title-row > div { display: grid; gap: 4px; }
      .notification-toolbar { display: flex !important; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px !important; }
      .notification-unread-pill { min-height: 32px; display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid rgba(126,234,255,.2); border-radius: 999px; color: #9eeeff; background: rgba(126,234,255,.065); font-size: 11px; font-weight: 900; }
      .notification-mark-read-button { min-height: 36px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #f5f3f8; background: rgba(255,255,255,.045); font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; padding: 0 12px; }
      .notification-mark-read-button:disabled, .notification-clear-button:disabled { opacity: .45; cursor: not-allowed; }
      .notification-list { display: grid; gap: 10px; }
      .notification-row { text-align: left; display: grid; gap: 4px; padding: 12px; border-radius: 12px; border: 1px solid rgba(126,234,255,.12); background: rgba(255,255,255,.035); color: #fff; cursor: pointer; text-decoration: none; }
      .notification-row:hover { border-color: rgba(126,234,255,.25); background: rgba(126,234,255,.06); }
      .notification-row.read { opacity: .58; }
      .notification-row span { color: #b9accd; }
      .notification-row .notification-row-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #7eeaff; font-size: 11px; }
      .notification-row-meta b { letter-spacing: .08em; text-transform: uppercase; }
      .notification-row-meta time { color: #a99fba; font-variant-numeric: tabular-nums; }
      .notification-row em { color: #7eeaff; font-size: 11px; font-style: normal; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .notification-clear-button { min-height: 38px; justify-self: end; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #c9c3d1; background: transparent; font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; padding: 0 13px; }
      .notification-panel > p { margin: 0; color: #94e5ff; font-size: 13px; }
      .support-panel form, .support-thread { display: grid; gap: 12px; }
      .support-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .support-panel input, .support-panel textarea { border-radius: 12px; border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.045); color: #fff; padding: 11px 13px; font: inherit; }
      .support-panel input { min-height: 46px; }
      .support-panel textarea { resize: vertical; }
      .support-panel button { min-height: 44px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #f8f7fb; background: rgba(255,255,255,.06); font: inherit; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .support-panel .support-send-button { border-color: rgba(196,181,253,.5); background: linear-gradient(135deg, #6d28d9, #4c1d95); box-shadow: 0 10px 24px rgba(76,29,149,.2); }
      .support-panel button:disabled { opacity: .62; cursor: wait; }
      .support-panel .support-send-button.is-sent { border: 1px solid var(--dancr-color-success-medium); color: #a7f3d0; background: var(--dancr-color-success-soft); box-shadow: inset 0 0 0 1px var(--dancr-color-success-soft), 0 0 18px var(--dancr-color-success-soft); }
      .support-thread-list { display: grid; gap: 10px; }
      .support-thread { padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-thread summary { cursor: pointer; color: #fff; font-weight: 900; }
      .support-thread summary span { display: grid; gap: 3px; }
      .support-thread small { color: #b9accd; font-size: 12px; }
      .support-message-list { display: grid; gap: 8px; }
      .support-message { display: grid; gap: 4px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-message.from-admin { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .support-message p, .support-panel p { color: #cfc5de; font-size: 14px; line-height: 1.45; }
      .customer-settings-panel form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .customer-night-panel, .customer-saved-panel, .saved-deal-panel, .customer-dashboard-grid > .notification-panel, .customer-settings-section { grid-column: 1 / -1; scroll-margin-top: 82px; }
      .customer-night-panel:focus, .customer-saved-panel:focus, .saved-deal-panel:focus, .customer-dashboard-grid > .notification-panel:focus, .customer-settings-section:focus { outline: 2px solid rgba(126,234,255,.72); outline-offset: 4px; }
      .customer-section-heading { display: grid; gap: 4px; }
      .customer-section-heading > span, .customer-section-heading > div > span, .customer-saved-head span, .notification-title-row > div > span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .customer-section-heading h2, .customer-saved-head h2, .notification-title-row h2 { margin: 0; }
      .customer-section-heading.split { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .customer-section-heading.split > div { display: grid; gap: 4px; }
      .customer-section-heading.split > strong, .notification-title-row > strong { min-width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; color: #061015; background: #7eeaff; font-size: 17px; }
      .customer-night-list { display: grid; gap: 12px !important; }
      .customer-night-card { min-width: 0; display: grid; grid-template-columns: 132px minmax(0, 1fr); overflow: hidden; border: 1px solid rgba(126,234,255,.18); border-radius: 14px; background: linear-gradient(135deg, rgba(109,40,217,.14), rgba(34,199,255,.05)); }
      .customer-night-card > .customer-saved-card-image { width: 132px; height: 100%; min-height: 172px; border-radius: 0; }
      .customer-night-copy { min-width: 0; display: grid; align-content: center; gap: 7px; padding: 16px; }
      .customer-night-copy > span, .customer-saved-card-copy > span { color: #8deeff; font-size: 11px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .customer-night-copy h3 { margin: 0; color: #fff; font-size: 24px; }
      .customer-night-copy p { color: #cfc5de; font-size: 14px; }
      .customer-saved-head { display: flex !important; align-items: center; justify-content: space-between; gap: 12px !important; }
      .customer-saved-head > div { display: grid; gap: 4px; }
      .customer-saved-head > button { min-height: 42px; padding: 0 13px; border: 1px solid rgba(126,234,255,.26); border-radius: 999px; color: #fff; background: rgba(126,234,255,.08); font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; }
      .customer-saved-head > button:disabled { opacity: .6; cursor: wait; }
      .customer-location-status { max-width: none; color: #aaf2ff; font-size: 13px; }
      .customer-saved-grid { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px !important; }
      .customer-saved-group { min-width: 0; display: grid; align-content: start; gap: 10px; padding: 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.035); }
      .customer-saved-group h3 { margin: 0; color: #fff; font-size: 15px; }
      .customer-saved-group > div { display: grid; gap: 8px; }
      .customer-saved-card { min-width: 0; overflow: hidden; border: 1px solid rgba(126,234,255,.16); border-radius: 12px; background: rgba(5,5,9,.7); }
      .customer-saved-card-image { width: 100%; height: 148px; display: grid; place-items: center; object-fit: cover; background: linear-gradient(145deg, #201338, #091927); color: #fff; font-size: 24px; font-weight: 950; }
      .customer-saved-card-copy { min-width: 0; display: grid; gap: 6px; padding: 12px; }
      .customer-saved-card-copy > a { min-width: 0; color: #fff; text-decoration: none; }
      .customer-saved-card-copy > a strong { display: block; overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
      .customer-saved-card-copy > small { overflow: hidden; color: #b9accd; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .customer-card-actions { display: flex !important; flex-wrap: wrap; gap: 7px !important; margin-top: 4px; }
      .customer-card-actions a, .customer-card-actions button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 9px; color: #fff; background: rgba(255,255,255,.06); font: inherit; font-size: 12px; font-weight: 900; text-decoration: none; cursor: pointer; }
      .customer-card-actions button:disabled { opacity: .55; cursor: wait; }
      .customer-card-actions button[aria-disabled="true"] { opacity: 1; cursor: default; }
      .customer-card-actions .customer-text-action { color: #cfc5de; background: transparent; }
      .customer-empty-state { min-height: 138px; display: grid; place-items: start; align-content: center; gap: 9px; padding: 16px; border: 1px dashed rgba(126,234,255,.24); border-radius: 12px; background: rgba(126,234,255,.035); }
      .customer-empty-state.compact { min-height: 106px; padding: 12px; }
      .customer-empty-state strong { color: #fff; }
      .customer-empty-state p { color: #b9accd; font-size: 13px; line-height: 1.45; }
      .customer-empty-state a { min-height: 38px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 9px; color: #071014; background: #7eeaff; font-size: 12px; font-weight: 950; text-decoration: none; }
      .customer-loading-state { min-height: 112px; display: grid; place-items: center; color: #b9accd; }
      .saved-deal-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .saved-deal-head > div { display: grid; gap: 4px; }
      .saved-deal-head span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .saved-deal-head h2 { margin: 0; }
      .saved-deal-head > strong { min-width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; color: #061015; background: #7eeaff; font-size: 17px; }
      .customer-nfc-guide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
      .customer-nfc-guide > div { min-width: 0; display: flex; gap: 10px; padding: 12px; border: 1px solid rgba(126,234,255,.2); border-radius: 12px; background: linear-gradient(145deg, rgba(109,40,217,.12), rgba(34,199,255,.05)); }
      .customer-nfc-guide > div > b { width: 28px; height: 28px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 50%; color: #061015; background: #7eeaff; font-size: 12px; }
      .customer-nfc-guide span { min-width: 0; display: grid; gap: 4px; }
      .customer-nfc-guide small { color: #b9accd; font-size: 11px; line-height: 1.4; }
      .saved-deal-list { display: grid; gap: 9px; margin-top: 14px; }
      .saved-deal-list > p { margin: 0; color: #b9accd; font-size: 14px; line-height: 1.45; }
      .saved-deal-item { min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid rgba(126,234,255,.3); border-radius: 10px; color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.2), rgba(34,199,255,.08)); text-decoration: none; }
      .saved-deal-item > span { min-width: 0; display: grid; gap: 4px; }
      .saved-deal-item > span > strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .saved-deal-item small { color: #b9accd; font-size: 12px; }
      .saved-deal-item em { color: #7eeaff; font-size: 12px; font-style: normal; font-weight: 950; }
      .saved-deal-item.unavailable { opacity: .62; border-color: rgba(255,255,255,.1); background: rgba(255,255,255,.035); }
      .past-deal-history { margin-top: 4px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 10px; }
      .past-deal-history summary { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #d8cfeb; font-weight: 900; cursor: pointer; list-style: none; }
      .past-deal-history summary::-webkit-details-marker { display: none; }
      .past-deal-history summary span { min-width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.08); }
      .past-deal-history > div { display: grid; gap: 8px; padding-top: 8px; }
      .customer-settings-section { display: grid; gap: var(--mydancr-dashboard-gap); padding: 16px; border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .customer-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--mydancr-dashboard-gap); }
      .customer-settings-grid > .info-panel { grid-column: auto; border-color: transparent; background: var(--mydancr-dashboard-panel-raised); }
      .customer-settings-grid > .customer-settings-panel, .customer-settings-grid > .support-panel, .customer-settings-grid > .account-controls-panel { grid-column: 1 / -1; }
      .customer-settings-panel .city-field { grid-column: span 2; }
      .venue-working-list { display: grid; gap: 9px; }
      .venue-working-list a { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.08); color: #fff; background: rgba(255,255,255,.04); text-decoration: none; }
      .venue-working-list a:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-working-identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
      .venue-working-identity > img, .venue-working-identity > i { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; object-fit: cover; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; color: #f8fafc; background: #111118; font-style: normal; font-weight: 900; }
      .venue-working-identity > span, .venue-working-verification { min-width: 0; display: grid; gap: 3px; }
      .venue-working-identity strong { overflow: hidden; color: #f8fafc; text-overflow: ellipsis; white-space: nowrap; }
      .venue-working-list small { color: var(--mydancr-dashboard-muted); font-size: 10px; }
      .venue-working-verification { justify-items: end; text-align: right; }
      .venue-working-verification > strong { color: #76f0c8; font-size: 11px; }
      .venue-analytics-period { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; padding: 5px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: #050507; }
      .venue-analytics-period button { min-height: 40px; border: 1px solid transparent; border-radius: 9px; color: var(--mydancr-dashboard-muted); background: transparent; font: inherit; font-size: 12px; font-weight: 850; cursor: pointer; }
      .venue-analytics-period button.active { border-color: rgba(124,58,237,.58); color: #f8fafc; background: #7c3aed; box-shadow: 0 0 16px rgba(124,58,237,.22); }
      .venue-analytics-period button:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-analytics-metric small { color: var(--mydancr-dashboard-muted); font-size: 9px; line-height: 1.25; }
      .venue-analytics-metric small.positive { color: #6ee7b7; }
      .venue-analytics-metric small.negative { color: #fca5a5; }
      .venue-deal-readonly { grid-column: span 3; display: grid; gap: 14px; scroll-margin-top: 120px; }
      .venue-deal-readonly:focus { outline: 2px solid rgba(124,58,237,.7); outline-offset: 3px; }
      .venue-deal-readonly-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .venue-deal-readonly-heading > div { display: grid; gap: 5px; }
      .venue-deal-readonly-heading h2, .venue-deal-readonly-heading p { margin: 0; }
      .venue-deal-readonly-heading p { max-width: 720px; color: var(--mydancr-dashboard-muted); line-height: 1.5; }
      .venue-contract-summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; overflow: hidden; padding: 0 !important; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: var(--mydancr-dashboard-border) !important; }
      .venue-contract-summary > div { min-width: 0; display: grid; align-content: start; gap: 5px; padding: 14px; background: #0d0d12; }
      .venue-contract-summary span, .venue-contract-deal-title span, .venue-contract-deal-terms > span { color: #94a3b8; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .venue-contract-summary strong { color: #f8fafc; overflow-wrap: anywhere; }
      .venue-contract-summary small { color: #94a3b8; line-height: 1.4; }
      .venue-contract-deal-list { display: grid; grid-template-columns: repeat(auto-fit,minmax(240px,1fr)); gap: 10px; }
      .venue-contract-deal-list > section { display: grid; align-content: start; gap: 11px; padding: 14px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: #0d0d12; }
      .venue-contract-deal-list > section.is-live { border-color: rgba(16,185,129,.36); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-contract-deal-title { display: grid; gap: 4px; }
      .venue-contract-deal-list > section.is-live .venue-contract-deal-title span { color: #6ee7b7; }
      .venue-contract-deal-title strong { color: #f8fafc; font-size: 19px; }
      .venue-contract-deal-list p { margin: 0; color: #cbd5e1; line-height: 1.45; }
      .venue-contract-deal-list dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1px; overflow: hidden; margin: 0; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; background: var(--mydancr-dashboard-border); }
      .venue-contract-deal-list dl > div { display: grid; gap: 3px; padding: 10px; background: #111118; }
      .venue-contract-deal-list dt { color: #94a3b8; font-size: 10px; font-weight: 850; }
      .venue-contract-deal-list dd { margin: 0; color: #f8fafc; font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .venue-contract-deal-terms { display: grid; gap: 5px; padding-top: 10px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-contract-empty { min-height: 130px; place-content: center; }
      .venue-contract-preview { width: fit-content; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 16px; border: 1px solid rgba(124,58,237,.54); border-radius: 9px; color: #f8fafc; background: #7c3aed; font-weight: 900; text-decoration: none; box-shadow: 0 0 16px rgba(124,58,237,.18); }
      .venue-contract-preview-note { width: min(100%, 620px); margin: 0; padding: 12px 14px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; color: var(--dancr-color-text-secondary); background: var(--mydancr-dashboard-panel-raised); line-height: 1.45; }
      .venue-deal-request-center { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: start; gap: 12px; padding: 15px; border: 1px solid rgba(124,58,237,.4); border-radius: 12px; background: #0d0d12; }
      .venue-deal-request-center > div:first-child { display: grid; gap: 5px; }
      .venue-deal-request-center h3, .venue-deal-request-center p { margin: 0; }
      .venue-deal-request-center > div:first-child p { max-width: 680px; color: #cbd5e1; line-height: 1.45; }
      .venue-deal-request-center > button, .venue-deal-request-center form button { min-height: 44px; padding: 0 15px; border: 1px solid rgba(124,58,237,.55); border-radius: 9px; background: #7c3aed; color: #f8fafc; font-weight: 900; }
      .venue-deal-request-center > form { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(180px,.7fr) minmax(240px,1.3fr); gap: 10px; padding-top: 12px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-request-center form label { display: grid; gap: 7px; color: #cbd5e1; font-size: 12px; font-weight: 850; }
      .venue-deal-request-center form select, .venue-deal-request-center form textarea { width: 100%; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; background: #111118; color: #f8fafc; font: inherit; }
      .venue-deal-request-center form select { min-height: 46px; padding: 0 12px; }
      .venue-deal-request-center form textarea { min-height: 104px; padding: 12px; resize: vertical; }
      .venue-deal-request-center form button { grid-column: 1 / -1; width: fit-content; }
      .venue-deal-request-center > small { grid-column: 1 / -1; color: #cbd5e1; }
      .venue-deal-request-feedback { grid-column: 1 / -1; display: grid; grid-template-columns: 34px minmax(0,1fr); align-items: center; gap: 10px; padding: 12px; border: 1px solid #334155; border-radius: 10px; color: #cbd5e1; background: #111118; }
      .venue-deal-request-feedback > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 999px; color: #f8fafc; background: #334155; font-weight: 950; }
      .venue-deal-request-feedback > div { display: grid; gap: 3px; }
      .venue-deal-request-feedback strong, .venue-deal-request-feedback p { margin: 0; }
      .venue-deal-request-feedback strong { color: #f8fafc; font-size: 13px; }
      .venue-deal-request-feedback p { color: #cbd5e1; font-size: 12px; line-height: 1.4; }
      .venue-deal-request-feedback.is-success { border-color: rgba(16,185,129,.52); background: rgba(16,185,129,.08); }
      .venue-deal-request-feedback.is-success > span { color: #050507; background: #10b981; }
      .venue-deal-request-feedback.is-error { border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.08); }
      .venue-deal-request-feedback.is-error > span { background: #ef4444; }
      .venue-deal-request-history { grid-column: 1 / -1; display: grid; gap: 8px; }
      .venue-deal-request-history article { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px 12px; padding: 11px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; background: #111118; }
      .venue-deal-request-history article.is-confirmed { border-color: rgba(16,185,129,.42); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-deal-request-history article > div { display: grid; gap: 2px; }
      .venue-deal-request-history small { color: #94a3b8; }
      .venue-deal-request-history article > span { align-self: start; padding: 5px 8px; border: 1px solid #334155; border-radius: 999px; color: #cbd5e1; font-size: 10px; font-weight: 900; }
      .venue-deal-request-history article > span[data-status="approved"] { border-color: rgba(16,185,129,.5); color: #6ee7b7; }
      .venue-deal-request-history article > span[data-status="rejected"] { border-color: rgba(239,68,68,.45); color: #fca5a5; }
      .venue-deal-request-history article > p { grid-column: 1 / -1; color: #cbd5e1; font-size: 12px; line-height: 1.45; }
      .venue-contract-history { border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: #0d0d12; }
      .venue-contract-history > summary { min-height: 48px; display: flex; align-items: center; padding: 0 14px; color: #f8fafc; font-weight: 900; cursor: pointer; }
      .venue-contract-history > div { display: grid; gap: 8px; padding: 0 14px 14px; }
      .venue-contract-history section { display: grid; grid-template-columns: minmax(150px,.7fr) minmax(180px,1.3fr) auto; gap: 10px; padding: 11px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 8px; background: #111118; }
      .venue-contract-history span, .venue-contract-history small { color: #94a3b8; }
      .venue-deal-panel { grid-column: span 3; border-color: var(--mydancr-dashboard-border); background: #111118; }
      .venue-deal-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .venue-deal-heading > div { display: grid; gap: 4px; }
      .deal-state { width: fit-content; padding: 7px 10px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #b9accd; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
      .deal-state.active { border-color: rgba(50,255,164,.42); color: #78ffc0; background: rgba(50,255,164,.1); }
      .venue-deal-panel > p, .venue-redemption-instructions p { color: #cfc5de; line-height: 1.5; }
      .venue-deal-placement-note { margin: 0; color: #94e5ff !important; font-size: 14px; font-weight: 800; }
      .venue-deal-control-card { display: grid; grid-template-columns: minmax(0,1.25fr) minmax(260px,.75fr); gap: 16px; padding: 16px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: #0d0d12; }
      .venue-deal-control-card.is-live { border-color: rgba(16,185,129,.34); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-deal-control-status { display: grid; align-content: center; gap: 5px; }
      .venue-deal-control-status > span { color: #94a3b8; font-size: 10px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .venue-deal-control-card.is-live .venue-deal-control-status > span { color: #6ee7b7; }
      .venue-deal-control-status > strong { color: #f8fafc; font-size: clamp(18px,3vw,24px); line-height: 1.15; overflow-wrap: anywhere; }
      .venue-deal-control-status > small { color: #94a3b8; line-height: 1.45; }
      .venue-deal-live-list { display: grid; gap: 7px; margin-top: 7px; }
      .venue-deal-live-list > button { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 11px; border: 1px solid rgba(16,185,129,.28); border-radius: 9px; color: #f8fafc; background: rgba(16,185,129,.07); text-align: left; cursor: pointer; }
      .venue-deal-live-list > button > span { min-width: 0; display: grid; gap: 2px; }
      .venue-deal-live-list > button strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
      .venue-deal-live-list > button small { color: #94a3b8; font-size: 10px; }
      .venue-deal-live-list > button em { color: #6ee7b7; font-size: 11px; font-style: normal; font-weight: 900; }
      .venue-deal-live-list > button:focus-visible { outline: 2px solid #10b981; outline-offset: 2px; }
      .venue-deal-control-metrics { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 11px; background: #09090d; }
      .venue-deal-control-metrics > span { min-width: 0; display: grid; gap: 5px; padding: 12px; border-left: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-control-metrics > span:first-child { border-left: 0; }
      .venue-deal-control-metrics small { color: #94a3b8; font-size: 10px; font-weight: 800; }
      .venue-deal-control-metrics strong { color: #f8fafc; font-size: 17px; overflow-wrap: anywhere; }
      .venue-deal-control-actions { display: flex; flex-wrap: wrap; align-content: center; justify-content: flex-end; gap: 9px; }
      .venue-deal-control-actions > button, .venue-deal-control-actions > a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 15px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; color: #f8fafc; background: #17171d; font-size: 13px; font-weight: 900; text-decoration: none; }
      .venue-deal-control-actions > button.venue-deal-control-primary { border-color: rgba(196,181,253,.54); background: #7c3aed; box-shadow: 0 0 16px rgba(124,58,237,.18); }
      .venue-deal-control-actions > button:focus-visible, .venue-deal-control-actions > a:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-deal-editor, .venue-deal-performance { overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: #0d0d12; }
      .venue-deal-editor { border-color: rgba(139,92,246,.44); background: linear-gradient(105deg, rgba(32,22,54,.94), rgba(13,13,18,.98) 68%); box-shadow: inset 0 0 0 1px rgba(196,181,253,.05), 0 8px 24px rgba(0,0,0,.18); }
      .venue-deal-editor > summary, .venue-deal-performance > summary { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 15px; color: #f8fafc; cursor: pointer; list-style: none; }
      .venue-deal-editor > summary { min-height: 74px; padding: 8px 14px 8px 16px; border-left: 3px solid #8b5cf6; transition: background .18s ease, border-color .18s ease; }
      .venue-deal-editor > summary:hover { background: rgba(139,92,246,.09); }
      .venue-deal-editor > summary:focus-visible { outline: 2px solid #a78bfa; outline-offset: -3px; }
      .venue-deal-editor > summary::-webkit-details-marker, .venue-deal-performance > summary::-webkit-details-marker { display: none; }
      .venue-deal-editor > summary > span, .venue-deal-performance > summary > span { display: grid; gap: 3px; }
      .venue-deal-editor > summary strong { font-size: 16px; line-height: 1.15; }
      .venue-deal-editor > summary small, .venue-deal-performance > summary small { color: #94a3b8; font-size: 11px; }
      .venue-deal-editor > summary small { color: #c2bcd0; font-size: 12px; line-height: 1.25; }
      .venue-deal-editor > summary em { padding: 6px 9px; border: 1px solid rgba(196,181,253,.23); border-radius: 999px; color: #ddd6fe; background: rgba(139,92,246,.12); font-size: 11px; font-style: normal; font-weight: 900; white-space: nowrap; }
      .venue-deal-editor > summary::after, .venue-deal-performance > summary::after { content: "+"; color: #c4b5fd; font-size: 22px; line-height: 1; }
      .venue-deal-editor > summary::after { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border: 1px solid rgba(196,181,253,.45); border-radius: 999px; background: rgba(124,58,237,.26); box-shadow: 0 0 15px rgba(124,58,237,.22); }
      .venue-deal-editor[open] > summary::after, .venue-deal-performance[open] > summary::after { content: "−"; }
      .venue-deal-editor[open] > summary { border-left-color: #c4b5fd; background: rgba(139,92,246,.11); }
      .venue-deal-editor > summary > em { margin-left: auto; }
      .venue-deal-editor-body, .venue-deal-performance-body { display: grid; gap: 14px; padding: 0 14px 14px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-editor-body > .venue-deal-placement-note, .venue-deal-performance-body > :first-child { margin-top: 14px; }
      .venue-deal-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
      .venue-deal-list > button { min-height: 92px; display: grid; align-content: center; justify-items: start; gap: 4px; padding: 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; color: #fff; background: rgba(255,255,255,.04); text-align: left; }
      .venue-deal-list > button.selected { border: 2px solid var(--dancr-color-beam-violet) !important; background: var(--dancr-color-beam-violet-soft) !important; box-shadow: inset 4px 0 0 var(--dancr-color-beam-violet) !important; }
      .venue-deal-list > button.add { border-style: dashed; color: #78ffc0; }
      .venue-deal-list span { color: #78ffc0; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .venue-deal-list strong { font-size: 14px; }
      .venue-deal-list small { color: #a99fba; font-size: 11px; }
      .venue-deal-counts { display: flex; flex-wrap: wrap; gap: 8px; }
      .venue-deal-counts span { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 1px solid rgba(255,255,255,.11); border-radius: 999px; color: #b9accd; background: rgba(255,255,255,.035); font-size: 12px; font-weight: 850; }
      .venue-deal-counts strong { color: #fff; font-size: 15px; }
      .venue-deal-builder-step legend > span:first-child { width: 26px; height: 26px; flex: 0 0 26px; display: grid; place-items: center; border-radius: 50%; color: #061015; background: #94e5ff; font-size: 12px; font-weight: 950; }
      .venue-deal-panel form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .venue-deal-builder-step { min-width: 0; grid-column: 1 / -1; display: grid; gap: 14px; margin: 0; padding: 15px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(255,255,255,.025); }
      .venue-deal-builder-step legend { display: flex; align-items: center; gap: 10px; padding: 0 8px; color: #fff; }
      .venue-deal-builder-step legend > span:last-child { display: grid; gap: 2px; }
      .venue-deal-builder-step legend strong { font-size: 15px; }
      .venue-deal-builder-step legend small { color: #a99fba; font-size: 11px; font-weight: 750; }
      .venue-deal-step-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .venue-deal-step-grid.one-column { grid-template-columns: 1fr; }
      .deal-wide-field { grid-column: 1 / -1; }
      .venue-deal-builder-step.review { border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.025); }
      .venue-deal-review { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin: 0; border: 1px solid rgba(255,255,255,.1); border-radius: 9px; background: rgba(255,255,255,.1); }
      .venue-deal-review > div { min-width: 0; display: grid; gap: 4px; padding: 11px 12px; background: #0d0c12; }
      .venue-deal-review dt { color: #9d92ad; font-size: 10px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .venue-deal-review dd { margin: 0; color: #fff; font-size: 13px; font-weight: 850; overflow-wrap: anywhere; }
      .venue-deal-rule-note { margin: 0; padding: 12px; border-left: 3px solid #94e5ff; color: #cbd5e1; background: rgba(148,229,255,.045); font-size: 12px; line-height: 1.5; }
      .venue-referral-agreement { min-width: 0; display: grid; align-content: start; gap: 7px; padding: 13px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: #111118; }
      .venue-referral-agreement > span { color: #9d92ad; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .venue-referral-agreement > strong { color: #fff; font-size: 16px; overflow-wrap: anywhere; }
      .venue-referral-agreement > small { color: #b9accd; line-height: 1.45; }
      .venue-referral-agreement > em { padding: 9px 10px; border: 1px solid rgba(255,214,102,.25); border-radius: 8px; color: #ffd666; background: rgba(255,214,102,.07); font-size: 12px; font-style: normal; font-weight: 850; line-height: 1.4; }
      .venue-referral-agreement > button { justify-self: start; min-height: 38px; }
      .venue-referral-request-panel { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(160px,.7fr) minmax(220px,1.3fr) auto; align-items: end; gap: 10px; padding: 13px; border: 1px solid rgba(148,229,255,.24); border-radius: 10px; background: rgba(148,229,255,.045); }
      .venue-referral-request-panel > button { min-height: 42px; }
      .venue-deal-panel label { display: grid; align-content: start; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-deal-panel input, .venue-deal-panel textarea, .venue-deal-panel select { width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #17151d; padding: 10px 12px; font: inherit; }
      .venue-deal-panel input, .venue-deal-panel select { min-height: 42px; }
      .venue-deal-panel textarea { resize: vertical; }
      .venue-deal-panel button { min-height: 44px; border: 0; border-radius: 8px; color: #061015; background: #78ffc0; font: inherit; font-weight: 950; cursor: pointer; padding: 0 16px; }
      .venue-deal-panel button:disabled { opacity: .62; cursor: wait; }
      .deal-booking-url { grid-column: 1 / -1; }
      .venue-deal-builder-step label > small { color: #a99fba; font-weight: 650; line-height: 1.4; }
      .deal-booking-url small { color: #94e5ff; font-weight: 650; line-height: 1.45; }
      .venue-deal-form-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .venue-deal-live-edit-note { grid-column: 1 / -1; margin: 0; padding: 11px 12px; border-left: 3px solid #78ffc0; color: #dfffee; background: rgba(50,255,164,.055); font-size: 12px; font-weight: 800; line-height: 1.45; }
      .venue-deal-unpublish-note { grid-column: 1 / -1; color: #a99fba; font-size: 11px; font-weight: 700; line-height: 1.4; }
      .venue-deal-form-actions .secondary { color: #f7f2ff; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.16); }
      .venue-deal-form-actions .danger { color: #ffccd3; background: rgba(255,86,108,.12); border: 1px solid rgba(255,86,108,.3); }
      .venue-deal-feedback { grid-column: 1 / -1; margin: 0; padding: 11px 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; color: #f8fafc !important; background: rgba(255,255,255,.06); font-size: 13px; font-weight: 850; line-height: 1.45; }
      .venue-deal-publish-status { display: grid; gap: 12px; padding: 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; background: rgba(255,255,255,.035); }
      .venue-deal-publish-status.live { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.07); box-shadow: inset 3px 0 0 rgba(50,255,164,.7); }
      .venue-deal-publish-status-heading { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; }
      .venue-deal-publish-status-heading > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: #d8cfeb; background: rgba(255,255,255,.08); font-weight: 950; }
      .venue-deal-publish-status.live .venue-deal-publish-status-heading > span { color: #061015; background: #78ffc0; }
      .venue-deal-publish-status-heading > div { display: grid; gap: 3px; }
      .venue-deal-publish-status-heading strong { color: #fff; font-size: 17px; }
      .venue-deal-publish-status-heading small { color: #b9accd; line-height: 1.4; }
      .venue-deal-publish-status ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
      .venue-deal-publish-status li { position: relative; padding-left: 24px; color: #e8fff4; font-size: 14px; font-weight: 800; }
      .venue-deal-publish-status li::before { content: "✓"; position: absolute; left: 2px; color: #78ffc0; font-weight: 950; }
      .venue-deal-nfc-status { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:16px; padding:18px; border:1px solid var(--mydancr-dashboard-border); border-radius:14px; background:#0d0d12; }
      .venue-deal-nfc-status.is-live { border-color:rgba(16,185,129,.38); box-shadow:inset 3px 0 0 rgba(16,185,129,.7),0 0 18px rgba(16,185,129,.09); }
      .venue-deal-nfc-status>div { width:62px; height:62px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.13); border-radius:50%; color:#cbd5e1; background:#17171d; font-weight:950; letter-spacing:-6px; transform:rotate(-18deg); }
      .venue-deal-nfc-status.is-live>div { border-color:rgba(16,185,129,.46); color:#ecfdf5; background:#047857; box-shadow:0 0 20px rgba(16,185,129,.18); }
      .venue-deal-nfc-status>section { display:grid; gap:7px; }.venue-deal-nfc-status h3,.venue-deal-nfc-status p{margin:0}.venue-deal-nfc-status p{color:#cbd5e1;line-height:1.48}.venue-deal-nfc-status small{color:#b9accd;line-height:1.4}
      .venue-deal-qr-generator { display: grid; grid-template-columns: 1fr; gap: 18px; align-items: center; padding: 18px; border: 1px solid rgba(124,58,237,.46); border-radius: 14px; background: radial-gradient(circle at 100% 0%, rgba(124,58,237,.16), transparent 22rem), #0a0910; box-shadow: inset 0 1px 0 rgba(248,250,252,.04); }
      .venue-deal-qr-generator.has-qr { grid-template-columns: minmax(0, 1fr) minmax(190px, 250px); }
      .venue-deal-qr-copy { display: grid; gap: 9px; }
      .venue-deal-qr-copy h3, .venue-deal-qr-copy p { margin: 0; }
      .venue-deal-qr-copy p { color: #cbd5e1; line-height: 1.48; }
      .venue-deal-qr-copy small { color: #fbbf24; font-weight: 800; }
      .venue-deal-qr-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 5px; }
      .venue-deal-qr-actions button { min-height: 42px; background: #7c3aed; color: #f8fafc; border: 1px solid rgba(196,181,253,.44); box-shadow: 0 0 18px rgba(124,58,237,.18); }
      .venue-deal-share-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 10px; border: 1px solid rgba(196,181,253,.24); border-radius: 10px; background: rgba(124,58,237,.08); }
      .venue-deal-share-options button { min-height: 44px; padding: 8px 10px; color: #f8fafc; background: #111118; border: 1px solid #334155; font-size: 12px; }
      .venue-deal-qr-preview { min-height: 210px; display: grid; align-content: center; justify-items: center; gap: 8px; padding: 12px; box-sizing: border-box; border: 1px solid #334155; border-radius: 12px; background: #050507; text-align: center; }
      .venue-deal-qr-preview img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px; background: #fff; }
      .venue-deal-qr-preview strong { color: #f8fafc; font-size: 13px; }
      .venue-deal-qr-preview small { color: #10b981; font-size: 11px; font-weight: 850; }
      .venue-deal-qr-loading { min-height: 210px; display: grid; place-items: center; border: 1px solid #334155; border-radius: 12px; color: #cbd5e1; background: #050507; font-weight: 850; text-align: center; }
      .venue-deal-how { overflow: hidden; border: 1px solid rgba(148,229,255,.2); border-radius: 10px; background: rgba(148,229,255,.035); }
      .venue-deal-how > summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 14px; color: #f7f2ff; font-weight: 950; cursor: pointer; list-style: none; }
      .venue-deal-how > summary::-webkit-details-marker { display: none; }
      .venue-deal-how > summary:focus-visible { outline: 2px solid #94e5ff; outline-offset: -3px; }
      .venue-deal-how > summary::after { content: "+"; color: #94e5ff; font-size: 22px; line-height: 1; }
      .venue-deal-how[open] > summary::after { content: "−"; }
      .venue-deal-how > div { display: grid; gap: 14px; padding: 0 14px 14px; }
      .venue-deal-how > div > p { margin: 0; color: #cfc5de; line-height: 1.5; }
      .currency-input { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; border: 1px solid rgba(50,255,164,.28); border-radius: 8px; background: rgba(50,255,164,.06); overflow: hidden; }
      .currency-input > span { padding-left: 12px; color: #78ffc0; font-weight: 950; }
      .currency-input input { border: 0; background: transparent; }
      .commission-tier-table { display: grid; border: 1px solid rgba(50,255,164,.2); border-radius: 10px; overflow: hidden; }
      .commission-tier-table > strong { padding: 12px; color: #78ffc0; background: rgba(50,255,164,.08); }
      .commission-tier-table > div { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 16px; padding: 11px 12px; border-top: 1px solid rgba(255,255,255,.08); }
      .commission-tier-table b { color: #fff; font-size: 13px; }
      .venue-deal-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .venue-redemption-instructions { display: grid; gap: 6px; padding: 14px; border: 1px solid rgba(148,229,255,.22); border-radius: 10px; background: rgba(148,229,255,.06); }
      .venue-redemption-instructions strong { color: #94e5ff; }
      .deal-panel { grid-column: span 2; }
      .deal-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 !important; overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel-raised); }
      .deal-metrics .metric { min-height: 66px; padding: 12px 14px; border-top: 0; border-left: 1px solid var(--mydancr-dashboard-border); }
      .deal-metrics .metric:first-child { border-left: 0; }
      .metric { min-height: 58px; display: grid; align-content: center; gap: 4px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .metric:first-child { border-top: 0; }
      .metric span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      .venue-verification-panel { display: grid; gap: 14px; border-color: rgba(34,211,238,.24); background: radial-gradient(circle at 100% 0%, rgba(34,211,238,.09), transparent 26rem), rgba(12,12,18,.88); }
      .venue-verification-panel > p { margin: 0; color: #cfc5de; line-height: 1.5; }
      .venue-verification-actions { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(150px, .7fr); gap: 10px; }
      .venue-verification-scan-button, .venue-verification-manual-toggle, .venue-verification-scanner button, .venue-verification-manual button { min-height: 48px; border: 1px solid var(--dancr-color-brand-primary-strong); border-radius: 8px; color: var(--dancr-color-text-primary); background: linear-gradient(135deg, var(--dancr-color-brand-primary), var(--dancr-color-brand-primary-deep)); padding: 0 16px; font: inherit; font-weight: 950; cursor: pointer; box-shadow: var(--dancr-shadow-brand-control); }
      .venue-verification-scan-button { display: flex; align-items: center; justify-content: center; gap: 12px; text-align: left; }
      .venue-verification-scan-button svg { width: 28px; height: 28px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .venue-verification-scan-button > span { display: grid; gap: 2px; }
      .venue-verification-scan-button strong { color: var(--dancr-color-text-primary); }
      .venue-verification-scan-button small { color: var(--dancr-color-brand-core); font-size: 11px; font-weight: 800; }
      .venue-verification-manual-toggle, .venue-verification-scanner button { border-color: var(--dancr-color-border-subtle); color: var(--dancr-color-text-secondary); background: var(--dancr-color-surface-soft); box-shadow: none; }
      .venue-verification-scan-button:disabled, .venue-verification-manual-toggle:disabled, .venue-verification-scanner button:disabled, .venue-verification-manual button:disabled { opacity: .55; cursor: wait; }
      .venue-verification-scan-button:focus-visible, .venue-verification-manual-toggle:focus-visible, .venue-verification-scanner button:focus-visible, .venue-verification-manual button:focus-visible, .venue-verification-manual input:focus-visible { outline: 2px solid var(--dancr-color-brand-core); outline-offset: 2px; }
      .venue-verification-scanner { display: grid; grid-template-columns: minmax(180px, 320px) minmax(0, 1fr); align-items: center; gap: 16px; padding: 14px; border: 1px solid var(--dancr-color-brand-primary-medium); border-radius: 12px; background: var(--dancr-color-background); }
      .venue-verification-video-wrap { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border: 1px solid var(--dancr-color-white-medium); border-radius: 8px; background: var(--dancr-color-background); }
      .venue-verification-video-wrap video { width: 100%; height: 100%; display: block; object-fit: cover; }
      .venue-verification-video-wrap > span { position: absolute; inset: 13%; border: 2px solid var(--dancr-color-brand-core); border-radius: 8px; box-shadow: 0 0 0 999px var(--dancr-color-black-medium), var(--dancr-shadow-beam-active); pointer-events: none; }
      .venue-verification-scanner > div:last-child { display: grid; gap: 9px; }
      .venue-verification-scanner strong { color: var(--dancr-color-text-primary); font-size: 18px; }
      .venue-verification-scanner small { color: var(--dancr-color-text-secondary); line-height: 1.45; }
      .venue-verification-manual { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--dancr-color-border-subtle); border-radius: 10px; background: var(--dancr-color-surface-soft); }
      .venue-verification-manual label { color: var(--dancr-color-text-secondary); font-size: 13px; font-weight: 900; }
      .venue-verification-manual > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; }
      .venue-verification-manual input { min-height: 48px; min-width: 0; border: 1px solid var(--dancr-color-border); border-radius: 8px; color: var(--dancr-color-text-primary); background: var(--dancr-color-surface); padding: 0 12px; font: inherit; }
      .venue-verification-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; }
      .venue-verification-controls label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-verification-controls select { min-height: 46px; width: 100%; border: 1px solid rgba(34,211,238,.28); border-radius: 8px; color: #fff; background: #11111a; padding: 0 12px; font: inherit; }
      .venue-verification-controls button, .dancer-verification-qr button, .venue-verification-preview button, .verified-affiliation-list button { min-height: 44px; border: 1px solid rgba(34,211,238,.38); border-radius: 8px; color: #061015; background: linear-gradient(135deg, #67e8f9, #c084fc); padding: 0 16px; font: inherit; font-weight: 950; cursor: pointer; }
      .venue-verification-controls button:disabled, .venue-verification-preview button:disabled, .verified-affiliation-list button:disabled { opacity: .55; cursor: wait; }
      .dancer-verification-qr { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 18px; align-items: center; padding: 16px; border: 1px solid rgba(34,211,238,.3); border-radius: 12px; background: rgba(4,8,14,.8); }
      .dancer-verification-qr > img { display: block; width: 100%; aspect-ratio: 1; border-radius: 8px; background: #fff; }
      .dancer-verification-qr > div, .venue-verification-preview > div { display: grid; gap: 8px; }
      .dancer-verification-qr strong, .venue-verification-preview strong { color: #fff; font-size: 20px; }
      .dancer-verification-qr span, .venue-verification-preview span { color: #94e5ff; font-weight: 850; }
      .dancer-verification-qr small, .venue-verification-preview small, .verified-affiliation-list small { color: #b9accd; line-height: 1.4; }
      .verified-affiliation-list { display: grid; gap: 9px; }
      .verified-affiliation-list > strong { color: #fff; }
      .verified-affiliation-list > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: rgba(255,255,255,.035); }
      .verified-affiliation-list > div > span { display: grid; gap: 3px; min-width: 0; }
      .verified-affiliation-list b { color: #78ffc0; overflow-wrap: anywhere; }
      .verified-affiliation-list button { min-height: 36px; color: #fff; background: rgba(255,255,255,.06); }
      .venue-verification-preview { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 16px; border: 1px solid rgba(50,255,164,.3); border-radius: 12px; background: rgba(50,255,164,.055); }
      .venue-verification-avatar { width: 68px; height: 68px; display: grid; place-items: center; overflow: hidden; border: 2px solid #f8fbff; border-radius: 50%; color: #fff; background: #171722; font-size: 24px; font-weight: 950; }
      .venue-verification-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .dashboard-shell-dancer { --mydancr-dashboard-panel: #09090d; --mydancr-dashboard-panel-raised: #111116; --mydancr-dashboard-border: rgba(255,255,255,.105); --mydancr-dashboard-muted: rgba(218,218,226,.68); color-scheme: dark; background: radial-gradient(circle at 14% 2%, rgba(110,54,220,.08), transparent 22rem), #050507; }
      .dashboard-shell-dancer .dashboard-head { min-height: 0; padding: 20px 22px; border-color: var(--mydancr-dashboard-border); border-radius: 22px; background: #07070a; box-shadow: 0 20px 48px rgba(0,0,0,.34); }
      .dashboard-shell-dancer .dashboard-head h1 { overflow: visible; font-size: clamp(29px,5vw,42px); text-overflow: clip; white-space: normal; }
      .dancer-onboarding-command { grid-column: 1 / -1; display: grid; gap: 18px; padding: clamp(16px,3vw,24px); border: 1px solid var(--mydancr-dashboard-border); border-radius: 20px; background: linear-gradient(145deg, #111116, #09090d 72%); box-shadow: 0 22px 54px rgba(0,0,0,.32); scroll-margin-top: 18px; }
      .dancer-payout-setup-notice { grid-column:1 / -1; display:flex; align-items:center; justify-content:space-between; gap:14px; padding:14px 16px; border:1px solid rgba(76,223,166,.25); border-radius:17px; background:linear-gradient(135deg,rgba(7,36,27,.86),rgba(12,13,18,.96)); }
      .dancer-payout-setup-notice > span { min-width:0; display:grid; gap:4px; }
      .dancer-payout-setup-notice strong { color:#fff; font-size:16px; }
      .dancer-payout-setup-notice small { color:var(--mydancr-dashboard-muted); font-size:11px; line-height:1.4; }
      .dancer-payout-setup-notice a,.dancer-payout-setup-notice > b { flex:0 0 auto; padding:10px 12px; border:1px solid rgba(76,223,166,.35); border-radius:11px; color:#70efbd; background:rgba(25,140,101,.12); font-size:11px; font-weight:900; text-decoration:none; }
      .dancer-profile-media-preview { grid-column: 1 / -1; min-width: 0; display: grid; grid-template-columns: 46px minmax(0,1fr) auto; align-items: center; gap: 13px; padding: 14px 15px; border: 1px solid rgba(126,234,255,.24); border-radius: 18px; background: radial-gradient(circle at 0 50%,rgba(34,199,255,.09),transparent 18rem),linear-gradient(135deg,rgba(21,13,39,.96),rgba(8,9,14,.98)); box-shadow: inset 3px 0 0 rgba(139,92,246,.82),0 16px 36px rgba(0,0,0,.25); }
      .dancer-profile-media-preview-icon { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid rgba(126,234,255,.28); border-radius: 50%; color: #8fe9fa; background: linear-gradient(145deg,rgba(124,58,237,.28),rgba(34,199,255,.1)); }
      .dancer-profile-media-preview-icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-profile-media-preview-copy { min-width: 0; display: grid; gap: 3px; }
      .dancer-profile-media-preview-copy .eyebrow { color: #8fe9fa; }
      .dancer-profile-media-preview-copy strong { color: #fff; font-size: 17px; line-height: 1.15; }
      .dancer-profile-media-preview-copy small { max-width: 58ch; color: var(--mydancr-dashboard-muted); font-size: 11px; line-height: 1.4; }
      .dancer-profile-media-preview-button { min-width: 132px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid rgba(126,234,255,.42); border-radius: 999px; color: #fff; background: linear-gradient(135deg,#6d28d9,#0b94c9); box-shadow: 0 10px 24px rgba(61,27,143,.28),inset 0 1px 0 rgba(255,255,255,.14); font: inherit; font-size: 11px; font-weight: 950; cursor: pointer; white-space: nowrap; }
      .dancer-profile-media-preview-button:hover { border-color: rgba(126,234,255,.7); filter: brightness(1.08); }
      .dancer-profile-media-preview-button:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .dancer-profile-editor-launch-card { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:14px; padding:16px; border:1px solid rgba(126,234,255,.22); border-radius:16px; background:radial-gradient(circle at 0 0,rgba(126,234,255,.08),transparent 16rem),linear-gradient(145deg,rgba(18,13,31,.98),rgba(7,7,11,.98)); box-shadow:inset 3px 0 0 rgba(139,92,246,.82); }
      .dancer-profile-editor-launch-card > span { min-width:0; display:grid; gap:5px; }
      .dancer-profile-editor-launch-card > span > strong { color:#fff; font-size:18px; line-height:1.15; }
      .dancer-profile-editor-launch-card > span > small { max-width:56ch; color:var(--mydancr-dashboard-muted); font-size:12px; line-height:1.45; }
      .dancer-profile-editor-launch-button { min-width:170px; min-height:46px; padding:0 16px; border:1px solid rgba(126,234,255,.42); border-radius:999px; color:#fff; background:linear-gradient(135deg,#6d28d9,#0b94c9); box-shadow:0 10px 24px rgba(61,27,143,.28); font:inherit; font-size:12px; font-weight:950; cursor:pointer; }
      .dancer-onboarding-command-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
      .dancer-onboarding-command-head > span { display: grid; gap: 7px; }
      .dancer-onboarding-command-head h2 { color: #f8f7fb; font-size: clamp(25px,4vw,34px); letter-spacing: -.025em; }
      .dancer-onboarding-command-head p { color: var(--mydancr-dashboard-muted); font-size: 14px; line-height: 1.45; }
      .dancer-onboarding-command-head > b { flex: 0 0 auto; padding: 8px 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #dad7e1; background: rgba(255,255,255,.045); font-size: 11px; }
      .dancer-onboarding-steps { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
      .dancer-onboarding-steps > li { min-width: 0; overflow: clip; border: 1px solid rgba(255,255,255,.09); border-radius: 15px; background: #0d0d12; scroll-margin-top: 18px; }
      .dancer-onboarding-steps > li > button { width: 100%; min-height: 58px; display: grid; grid-template-columns: 30px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 9px 10px; border: 0; border-radius: 14px; color: #f8f7fb; background: #0d0d12; font: inherit; text-align: left; cursor: pointer; }
      .dancer-onboarding-step-marker { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.17); border-radius: 50%; color: #d7d5dd; background: rgba(255,255,255,.045); font-size: 11px; font-weight: 950; }
      .dancer-onboarding-step-copy { min-width: 0; display: grid; gap: 3px; }
      .dancer-onboarding-step-title { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
      .dancer-onboarding-step-copy strong { font-size: 15px; }
      .dancer-onboarding-step-copy small { color: var(--mydancr-dashboard-muted); font-size: 11px; line-height: 1.35; }
      .dancer-onboarding-step-title em { padding: 2px 5px; border: 1px solid rgba(126,234,255,.2); border-radius: 999px; color: #bfefff; background: rgba(21,126,155,.08); font-size: 8px; font-style: normal; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
      .dancer-onboarding-step-control { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 0 8px; border: 1px solid rgba(139,92,246,.38); border-radius: 999px; color: #f7f1ff; background: rgba(109,40,217,.18); font-size: 10px; font-weight: 950; white-space: nowrap; }
      .dancer-onboarding-step-control-chevron, .dancer-onboarding-step-control-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-onboarding-step-control-chevron { transition: transform .18s ease; }
      .dancer-onboarding-step-control-chevron.is-open { transform: rotate(90deg); }
      .dancer-onboarding-step-control.is-locked { width: 36px; padding: 0; border-color: transparent; color: #8e8996; background: transparent; }
      .dancer-onboarding-step-control.is-complete { border-color: rgba(76,223,166,.3); color: #70efbd; background: rgba(25,140,101,.1); }
      .dancer-onboarding-step-check { font-size: 12px; line-height: 1; }
      .dancer-onboarding-steps .is-current > button { background: rgba(97,45,188,.12); box-shadow: inset 3px 0 0 #8b5cf6; }
      .dancer-onboarding-steps .is-current { border-color: rgba(139,92,246,.56); }
      .dancer-onboarding-steps .is-complete { border-color: rgba(76,223,166,.28); }
      .dancer-onboarding-steps .is-complete > button { background: rgba(25,140,101,.07); }
      .dancer-onboarding-steps .is-complete .dancer-onboarding-step-marker { border-color: rgba(76,223,166,.42); color: #70efbd; background: rgba(25,140,101,.13); }
      .dancer-onboarding-steps .is-locked > button { cursor: not-allowed; }
      .dancer-onboarding-steps .is-locked > button:disabled { opacity: 1; }
      .dancer-onboarding-steps .is-locked .dancer-onboarding-step-copy strong { color: #d5d2da; }
      .dancer-onboarding-steps .is-locked .dancer-onboarding-step-copy small { color: #918d98; }
      .dancer-onboarding-steps .is-deferred { border-color: rgba(126,234,255,.14); }
      .dancer-onboarding-steps .is-open > button { border-radius: 14px 14px 0 0; }
      .dancer-onboarding-step-panel { display: grid; gap: 14px; padding: 14px; border-top: 1px solid rgba(255,255,255,.09); background: #09090d; animation: dancer-onboarding-panel-in .18s ease-out; }
      .dancer-onboarding-step-panel[hidden] { display: none; }
      .dancer-onboarding-step-panel .dancer-onboarding-profile-workspace { margin: 0; }
      .dancer-step-one-workspace { min-width: 0; display: grid; gap: 12px; }
      .dancer-step-one-summary { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: start; gap: 12px; padding: 14px; border: 1px solid rgba(126,234,255,.17); border-radius: 14px; background: linear-gradient(145deg,rgba(17,17,24,.96),rgba(7,7,11,.98)); }
      .dancer-step-one-summary > span { min-width: 0; display: grid; gap: 5px; }
      .dancer-step-one-summary h3 { color: #fff; font-size: clamp(20px,4vw,26px); }
      .dancer-step-one-summary p { color: var(--mydancr-dashboard-muted); font-size: 12px; line-height: 1.45; }
      .dancer-step-one-summary > b { padding: 6px 9px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #d8d5df; background: rgba(255,255,255,.04); font-size: 10px; white-space: nowrap; }
      .dancer-step-one-checklist { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; }
      .dancer-step-one-checklist button { min-width: 0; min-height: 54px; display: grid; grid-template-columns: 22px minmax(0,1fr); align-items: center; gap: 2px 7px; padding: 8px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; color: #f7f5fa; background: rgba(255,255,255,.035); font: inherit; text-align: left; cursor: pointer; }
      .dancer-step-one-checklist button > span { width: 20px; height: 20px; grid-row: 1 / span 2; display: grid; place-items: center; border-radius: 50%; color: #aaa5b1; background: rgba(255,255,255,.07); font-size: 11px; font-weight: 950; }
      .dancer-step-one-checklist button strong { min-width: 0; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-step-one-checklist button small { color: #aaa5b1; font-size: 8px; font-weight: 900; letter-spacing: .03em; text-transform: uppercase; }
      .dancer-step-one-checklist button.is-complete { border-color: rgba(76,223,166,.25); background: rgba(25,140,101,.07); }
      .dancer-step-one-checklist button.is-complete > span { color: #70efbd; background: rgba(25,140,101,.17); }
      .dancer-step-one-checklist button.is-complete small { color: #70efbd; }
      .dancer-step-one-checklist button.is-checking { border-color: rgba(126,234,255,.23); }
      .dancer-step-one-checklist button.is-checking small { color: #8fe9fa; }
      .dancer-step-one-checklist button.is-replace, .dancer-step-one-checklist button.is-unsaved { border-color: rgba(235,187,91,.25); }
      .dancer-step-one-checklist button.is-replace small, .dancer-step-one-checklist button.is-unsaved small { color: #f2ce83; }
      .dancer-step-one-sections { display: grid; gap: 7px; }
      .dancer-step-one-section { min-width: 0; overflow: clip; border: 1px solid rgba(255,255,255,.09); border-radius: 13px; background: #0c0c11; }
      .dancer-step-one-section.is-complete { border-color: rgba(76,223,166,.23); }
      .dancer-step-one-section.is-checking { border-color: rgba(126,234,255,.23); }
      .dancer-step-one-section.is-replace, .dancer-step-one-section.is-unsaved { border-color: rgba(235,187,91,.28); }
      .dancer-step-one-section-button { width: 100%; min-height: 66px; display: grid; grid-template-columns: 30px minmax(0,1fr) auto 26px; align-items: center; gap: 9px; padding: 10px 11px; border: 0; color: #f8f7fb; background: #0c0c11; font: inherit; text-align: left; cursor: pointer; }
      .dancer-step-one-section-marker { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; color: #ccc8d2; background: rgba(255,255,255,.045); font-size: 11px; font-weight: 950; }
      .dancer-step-one-section-button > span:nth-child(2) { min-width: 0; display: grid; gap: 3px; }
      .dancer-step-one-section-button strong { font-size: 14px; }
      .dancer-step-one-section-button small { overflow: hidden; color: var(--mydancr-dashboard-muted); font-size: 10px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-step-one-section-button em { padding: 5px 7px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; color: #bcb8c3; background: rgba(255,255,255,.035); font-size: 8px; font-style: normal; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
      .dancer-step-one-section-button i { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; color: #f5efff; background: #301b46; font-size: 18px; font-style: normal; line-height: 1; }
      .dancer-step-one-section.is-complete .dancer-step-one-section-marker, .dancer-step-one-section.is-complete .dancer-step-one-section-button em { border-color: rgba(76,223,166,.28); color: #70efbd; background: rgba(25,140,101,.1); }
      .dancer-step-one-section.is-checking .dancer-step-one-section-button em { color: #8fe9fa; }
      .dancer-step-one-section.is-replace .dancer-step-one-section-button em, .dancer-step-one-section.is-unsaved .dancer-step-one-section-button em { color: #f2ce83; }
      .dancer-step-one-section-panel { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 10px; padding: 10px; border-top: 1px solid rgba(255,255,255,.08); background: #08080c; animation: dancer-onboarding-panel-in .18s ease-out; }
      .dancer-step-one-section-panel[hidden] { display: none; }
      .dancer-step-one-section-panel > .info-panel { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; grid-column: 1 / -1; padding: 12px; border: 0; border-radius: 10px; background: #0d0d12; }
      .dancer-step-one-section-panel > .setup-panel > h2, .dancer-step-one-section-panel > .upload-panel > h2, .dancer-step-one-section-panel > .dancer-avatar-panel > .eyebrow, .dancer-step-one-section-panel > .dancer-avatar-panel > h2 { display: none; }
      .dancer-step-one-optional-panel { grid-template-columns: 1fr; }
      .dancer-step-one-optional-panel > * { min-width: 0; }
      .dancer-step-one-section-panel form, .dancer-step-one-section-panel label, .dancer-step-one-section-panel form > *, .dancer-step-one-section-panel .photo-review-list, .dancer-step-one-section-panel .photo-review-card, .dancer-step-one-section-panel .dancer-avatar-editor { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
      .dancer-step-one-section-panel input:not([type="checkbox"]):not([type="radio"]), .dancer-step-one-section-panel select, .dancer-step-one-section-panel textarea { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
      .dancer-step-one-section-panel input[type="file"] { overflow: hidden; font-size: 12px; }
      .dancer-step-one-section-panel p, .dancer-step-one-section-panel small, .dancer-step-one-section-panel em, .dancer-step-one-section-panel strong { max-width: 100%; overflow-wrap: anywhere; }
      .dancer-step-one-optional-panel .socials-panel { gap: 10px; }
      .dancer-step-one-optional-panel .socials-panel form { gap: 9px; }
      .dancer-step-one-optional-panel .socials-panel label { gap: 5px; }
      .dancer-step-one-optional-panel .socials-panel input { height: 46px; min-height: 46px; max-height: 46px; padding: 0 11px; }
      .dancer-step-one-optional-panel .socials-panel button[type="submit"] { min-height: 46px; }
      .dancer-profile-form-actions { display: flex; align-items: center; gap: 8px; }
      .dancer-profile-form-actions button { min-height: 44px !important; padding: 0 14px !important; border-radius: 999px !important; font-size: 11px !important; white-space: nowrap; }
      .dancer-profile-form-actions .dancer-profile-save-action { flex: 1 1 auto; }
      .dancer-profile-form-actions .dancer-profile-reload-action { flex: 0 1 auto; border-color: rgba(126,234,255,.2) !important; color: #d5f8ff !important; background: rgba(126,234,255,.07) !important; box-shadow: none !important; }
      .dancer-profile-form-actions .dancer-profile-reload-action:hover { border-color: rgba(126,234,255,.48) !important; background: rgba(126,234,255,.13) !important; }
      .dancer-form-save-state { grid-column: 1 / -1; min-height: 18px; margin: 0; color: #70efbd !important; font-size: 11px !important; }
      .dancer-form-save-state.is-unsaved { color: #f2ce83 !important; }
      .dancer-step-one-footer { display: grid; grid-template-columns: minmax(0,1fr) minmax(180px,240px); align-items: center; gap: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 13px; background: #0c0c11; }
      .dancer-step-one-footer > span { display: grid; gap: 3px; }
      .dancer-step-one-footer strong { color: #fff; font-size: 13px; }
      .dancer-step-one-footer small { color: var(--mydancr-dashboard-muted); font-size: 10px; }
      .dancer-step-one-footer.is-ready { border-color: rgba(76,223,166,.3); background: rgba(25,140,101,.07); }
      .dancer-onboarding-preview-workspace { display: grid; gap: 12px; }
      .dancer-onboarding-profile-review { margin-top: 12px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.09); scroll-margin-top: calc(var(--mydancr-preview-banner-offset, 0px) + 14px); }
      .dancer-onboarding-review-action { display: grid; gap: 9px; }
      .dancer-onboarding-review-action h3 { color: #fff; font-size: 17px; }
      .dancer-onboarding-review-action p { color: var(--mydancr-dashboard-muted); font-size: 11px; line-height: 1.45; }
      .dancer-onboarding-complete-note { display: grid; gap: 4px; padding: 13px; border: 1px solid rgba(76,223,166,.28); border-radius: 12px; color: #70efbd; background: rgba(25,140,101,.09); }
      .dancer-onboarding-complete-note span { color: var(--mydancr-dashboard-muted); font-size: 11px; line-height: 1.4; }
      .dancer-activation-confirmation { grid-column: 1 / -1; position: relative; display: grid; grid-template-columns: 52px minmax(0,1fr) 42px; align-items: start; gap: 14px; padding: 18px; border: 1px solid rgba(96,255,188,.28); border-radius: var(--mydancr-dashboard-radius); background: radial-gradient(circle at 0 0,rgba(42,205,137,.14),transparent 25rem),#0a0d0c; box-shadow: 0 18px 42px rgba(0,0,0,.32); }
      .dancer-activation-check { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; color: #06110d; background: #7dffc7; font-size: 24px; font-weight: 950; }
      .dancer-activation-copy { min-width: 0; display: grid; gap: 7px; }
      .dancer-activation-copy .eyebrow { color: #8dffd0; }
      .dancer-activation-copy h2 { color: #fff; font-size: clamp(22px,5vw,30px); }
      .dancer-activation-copy p { max-width: 60ch; color: rgba(236,242,239,.76); font-size: 14px; line-height: 1.45; }
      .dancer-activation-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 4px; }
      .dancer-activation-actions a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #fff; background: rgba(255,255,255,.06); font-size: 12px; font-weight: 900; text-decoration: none; }
      .dancer-activation-actions a:first-child { border-color: rgba(96,255,188,.36); color: #07110d; background: #8dffd0; }
      .dancer-activation-confirmation > button { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; color: rgba(255,255,255,.76); background: rgba(255,255,255,.055); cursor: pointer; }
      .dancer-activation-confirmation > button svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      @keyframes dancer-onboarding-panel-in { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      .dancer-avatar-preview { overflow: hidden; display: grid; place-items: center; border: 2px solid #f8fbff; border-radius: 50%; color: #fff; background: #17171d; font-weight: 950; }
      .dancer-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
      .dancer-onboarding-preview-open { width: 100%; min-height: 46px; border: 1px solid rgba(126,234,255,.34); border-radius: 12px; color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.8), rgba(11,148,201,.58)); font: inherit; font-size: 13px; font-weight: 950; cursor: pointer; }
      .dancer-onboarding-preview-open:disabled { opacity: .48; cursor: not-allowed; }
      .dancer-profile-preview-overlay { position: fixed; z-index: 1498; inset: var(--mydancr-preview-banner-offset,0px) 0 0; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow-x: hidden; overflow-y: auto; overscroll-behavior-x: none; overscroll-behavior-y: contain; color: #f7f2ff; background: #050507; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.28) transparent; }
      .dancer-profile-preview-overlay *, .dancer-profile-preview-overlay *::before, .dancer-profile-preview-overlay *::after { box-sizing:border-box; }
      .dancer-profile-preview-overlay::-webkit-scrollbar { width: 4px; }
      .dancer-profile-preview-overlay::-webkit-scrollbar-track { background: transparent; }
      .dancer-profile-preview-overlay::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(255,255,255,.28); }
      .dancer-profile-preview-shell { width: 100%; max-width: 100%; min-width: 0; min-height: 100dvh; box-sizing: border-box; overflow-x: hidden; padding: 0 clamp(18px,4vw,56px) max(130px,calc(env(safe-area-inset-bottom) + 110px)); background: radial-gradient(circle at 78% 8%,rgba(139,92,246,.22),transparent 28rem),linear-gradient(180deg,#090911,#050507 62%); }
      .dancer-profile-preview-overlay .profile-titlebar { position: sticky; z-index: 10; top: 0; width: min(100%,760px); max-width: 100%; min-width: 0; min-height: 64px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; margin: 0 auto; padding: max(8px,env(safe-area-inset-top)) 52px 8px 0; background: radial-gradient(circle at 14% 0%,rgba(126,234,255,.055),transparent 11rem),linear-gradient(180deg,rgba(5,5,8,.98),rgba(5,5,8,.92)); box-shadow: 0 8px 24px rgba(0,0,0,.2); backdrop-filter: blur(22px); }
      .dancer-profile-preview-overlay .profile-titlebar-avatar { position: relative; width: 42px; height: 42px; display: grid; flex: 0 0 42px; place-items: center; overflow: hidden; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: linear-gradient(145deg,rgba(124,58,237,.72),rgba(34,199,255,.35)); box-shadow: 0 10px 26px rgba(0,0,0,.36),0 0 18px rgba(124,58,237,.15); font-size: 13px; font-weight: 950; }
      .dancer-profile-preview-overlay .profile-titlebar-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; filter: brightness(1.14) contrast(1.03); }
      .dancer-profile-preview-overlay .profile-titlebar-identity { min-width: 0; display: grid; flex: 1 1 auto; gap: 6px; }
      .dancer-profile-preview-overlay .profile-titlebar-identity > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
      .dancer-profile-preview-overlay .profile-titlebar h1 { margin: 0; overflow: hidden; font-size: clamp(20px,4vw,26px); line-height: 1.05; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-titlebar-context { max-width: 100%; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; overflow: hidden; }
      .dancer-profile-preview-overlay .profile-titlebar-city { min-height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border: 1px solid rgba(180,169,196,.14); border-radius: 999px; color: #c8bfd6; background: rgba(255,255,255,.035); font-size: 9px; font-weight: 850; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-verified { width:20px; height:20px; flex:0 0 20px; display:inline-grid; place-items:center; border-radius:50%; color:#051019; background:#7eeaff; box-shadow:0 0 15px rgba(126,234,255,.3); font-size:12px; font-weight:950; }
      .dancer-profile-preview-overlay .public-profile-close { position: absolute; top: max(8px,env(safe-area-inset-top)); right: 0; width: 40px; min-width: 40px; max-width: 40px; height: 40px; min-height: 40px; max-height: 40px; display: inline-grid; flex: 0 0 40px; place-items: center; padding: 0; border: 1px solid rgba(180,169,196,.2); border-radius: 50% !important; color: #fff; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.04),0 10px 24px rgba(0,0,0,.28); font-size: 0; line-height: 0; cursor: pointer; }
      .dancer-profile-preview-overlay .public-profile-close svg { width:20px; height:20px; display:block; overflow:visible; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; transform:none; }
      .dancer-profile-preview-overlay .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13),0 0 22px rgba(34,199,255,.18); }
      .dancer-profile-preview-overlay .profile-overview, .dancer-profile-preview-overlay .profile-social-section, .dancer-profile-preview-overlay .live-actions, .dancer-profile-preview-overlay .profile-deal-availability, .dancer-profile-preview-overlay .profile-media-section, .dancer-profile-preview-overlay .profile-schedule-section, .dancer-profile-preview-overlay .profile-tonight-card { width: min(100%,760px); max-width: 100%; min-width: 0; box-sizing: border-box; margin-inline: auto; }
      .dancer-profile-preview-overlay .profile-media-section { display: grid; gap: 12px; margin-top: 12px; }
      .dancer-profile-preview-overlay .profile-media-tabs { width: min(100%,360px); display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); justify-self: center; gap: 4px; padding: 4px; border: 1px solid rgba(255,255,255,.1); border-radius: 15px; background: rgba(255,255,255,.035); }
      .dancer-profile-preview-overlay .profile-media-tabs button { position: relative; min-width: 0; min-height: 46px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid transparent; border-radius: 11px; color: #a59aae; background: transparent; box-shadow: none; cursor: pointer; }
      .dancer-profile-preview-overlay .profile-media-tabs button::before { content: none; }
      body.dancr-button-system .dancer-profile-preview-overlay .profile-media-tabs button { border: 1px solid transparent !important; border-radius: 11px !important; color: #a59aae !important; background: transparent !important; box-shadow: none !important; }
      body.dancr-button-system .dancer-profile-preview-overlay .profile-media-tabs button.active { border-color: rgba(126,234,255,.34) !important; color: #fff !important; background: linear-gradient(135deg,rgba(109,40,217,.72),rgba(11,148,201,.34)) !important; box-shadow: var(--dancr-shadow-beam-active) !important; }
      .dancer-profile-preview-overlay .profile-media-tab-label { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-media-tab-count { min-width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: #d9d2e2; background: rgba(0,0,0,.24); font-size: 10px; font-weight: 950; line-height: 1; }
      .dancer-profile-preview-overlay .profile-media-tabs button:disabled { opacity: .42; cursor: default; }
      .dancer-profile-preview-overlay .profile-media-tab-icon { width: 18px; height: 18px; display: block; flex: 0 0 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-profile-preview-overlay .profile-media-tab-play { fill: currentColor; stroke: none; }
      .dancer-profile-preview-overlay .profile-media-grid { width: 100%; max-width: 100%; min-width: 0; min-height: 108px; box-sizing: border-box; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }
      .dancer-profile-preview-overlay .profile-media-grid-item { position: relative; width: 100%; min-width: 0; aspect-ratio: 4 / 5; display: block; padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.1); border-radius: 11px; color: #fff; background: #0b0b10; box-shadow: none; cursor: pointer; }
      .dancer-profile-preview-overlay .profile-media-grid-item img, .dancer-profile-preview-overlay .profile-media-grid-item video { width: 100%; height: 100%; display: block; object-fit: cover; background: #000; pointer-events: none; }
      .dancer-profile-preview-overlay .profile-media-grid-item img { filter: brightness(1.14) contrast(1.03); }
      .dancer-profile-preview-overlay .profile-media-grid-item:focus-visible { z-index:1; outline:2px solid #7eeaff; outline-offset:2px; }
      .dancer-profile-preview-overlay .profile-media-play { position:absolute; top:50%; left:50%; width:34px; aspect-ratio:1; box-sizing:border-box; border:1px solid rgba(255,255,255,.38); border-radius:50%; background:rgba(5,5,9,.62); box-shadow:0 6px 18px rgba(0,0,0,.38); transform:translate(-50%,-50%); pointer-events:none; -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); }
      .dancer-profile-preview-overlay .profile-media-play::after { content:""; position:absolute; top:50%; left:54%; border-top:6px solid transparent; border-bottom:6px solid transparent; border-left:9px solid #fff; transform:translate(-50%,-50%); }
      .dancer-profile-preview-overlay .profile-media-empty { grid-column:1 / -1; min-height:108px; display:grid; place-items:center; color:#8f849c; text-align:center; }
      .dancer-profile-preview-overlay .profile-media-viewer { position:fixed; z-index:2200; inset:0; display:grid; grid-template-rows:minmax(0,1fr) auto; overflow:hidden; color:#fff; background:rgba(0,0,0,.98); overscroll-behavior:none; touch-action:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-close { position:fixed; z-index:3; top:max(12px,env(safe-area-inset-top)); right:max(12px,env(safe-area-inset-right)); width:50px; height:50px; display:grid; place-items:center; padding:0; border:1px solid rgba(126,234,255,.42); border-radius:50%; color:#fff; background:rgba(10,10,14,.78); font-size:30px; cursor:pointer; backdrop-filter:blur(12px); }
      .dancer-profile-preview-overlay .profile-media-viewer-stage { position:relative; width:100%; height:100%; min-height:0; display:block; overflow-x:hidden; overflow-y:auto; overscroll-behavior-y:contain; scroll-snap-type:y mandatory; scroll-behavior:smooth; scrollbar-width:none; touch-action:pan-y; }
      .dancer-profile-preview-overlay .profile-media-viewer-stage::-webkit-scrollbar { display:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide { position:relative; width:100%; height:100%; min-height:100%; max-height:100%; display:grid; place-items:center; overflow:hidden; background:#000; scroll-snap-align:start; scroll-snap-stop:always; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide > img, .dancer-profile-preview-overlay .profile-media-viewer-slide > video { width:100%; height:100%; max-height:100%; display:block; object-fit:cover; background:#000; user-select:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide > img { filter:brightness(1.14) contrast(1.03); }
      .dancer-profile-preview-overlay .profile-media-viewer-previous, .dancer-profile-preview-overlay .profile-media-viewer-next { position:fixed; top:50%; width:46px; height:58px; display:grid; place-items:center; padding:0; border:1px solid rgba(255,255,255,.18); border-radius:999px; color:#fff; background:rgba(5,5,8,.58); font-size:34px; transform:translateY(-50%); cursor:pointer; backdrop-filter:blur(8px); }
      .dancer-profile-preview-overlay .profile-media-viewer-previous { left:12px; }
      .dancer-profile-preview-overlay .profile-media-viewer-next { right:12px; }
      .dancer-profile-preview-overlay .profile-media-viewer-previous:disabled, .dancer-profile-preview-overlay .profile-media-viewer-next:disabled { opacity:0; pointer-events:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-footer { min-height:68px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px max(18px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left)); border-top:1px solid rgba(255,255,255,.1); background:#07070a; }
      .dancer-profile-preview-overlay .profile-media-viewer-copy { min-width:0; display:grid; gap:3px; }
      .dancer-profile-preview-overlay .profile-media-viewer-copy span, .dancer-profile-preview-overlay .profile-media-viewer-hint { color:#aaa0b8; font-size:11px; font-weight:800; }
      .dancer-profile-preview-overlay .profile-media-viewer-actions { min-width:92px; display:grid; justify-items:end; gap:3px; }
      .dancer-profile-preview-overlay .profile-media-viewer-share { min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:0 15px; border:1px solid rgba(255,255,255,.2); border-radius:999px; color:#fff; background:rgba(255,255,255,.08); font-size:12px; font-weight:900; cursor:pointer; }
      .dancer-profile-preview-overlay .profile-media-viewer-share svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.9; }
      .dancer-profile-preview-overlay .profile-media-viewer-share-status { min-height:14px; color:#a7f3d0; font-size:10px; font-weight:800; text-align:right; }
      .dancer-profile-preview-overlay .profile-social-section { display: grid; margin-top: 20px; margin-bottom: 8px; padding: 15px 14px 14px; border: 1px solid rgba(126,234,255,.18); border-radius: 18px; background: radial-gradient(circle at 50% 0%,rgba(126,234,255,.08),transparent 11rem),rgba(13,10,23,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.035),0 16px 38px rgba(0,0,0,.2); }
      .dancer-profile-preview-overlay .social-links-control { display: grid; justify-items: center; gap: 12px; text-align: center; }
      .dancer-profile-preview-overlay .social-list-heading { display: grid; justify-items: center; gap: 3px; }
      .dancer-profile-preview-overlay .social-list-heading > span { color: #94e5ff; font-size: 9px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .dancer-profile-preview-overlay .social-list-heading h2 { margin: 0; font-size: 15px; line-height: 1.1; }
      .dancer-profile-preview-overlay .social-list-heading p { max-width:420px; margin:3px 0 0; color:#a9a1b5; font-size:10px; font-weight:760; line-height:1.35; }
      .dancer-profile-preview-overlay .social-list { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
      .dancer-profile-preview-overlay .social-list :is(a,button) { width: 48px; min-width: 48px; height: 48px; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 48px; padding: 0; border: 1px solid rgba(139,92,246,.34); border-radius: 50%; color: #fff; background: linear-gradient(135deg,rgba(139,92,246,.14),rgba(34,199,255,.06)); box-shadow: inset 0 1px 0 rgba(255,255,255,.045); text-decoration: none; transition: border-color .16s ease,background .16s ease,box-shadow .16s ease,transform .16s ease; }
      .dancer-profile-preview-overlay .social-list :is(a,button):hover { border-color: rgba(126,234,255,.56); background: linear-gradient(135deg,rgba(139,92,246,.22),rgba(34,199,255,.12)); box-shadow: 0 0 18px rgba(34,199,255,.1); transform: translateY(-1px); }
      .dancer-profile-preview-overlay .social-list :is(a,button):focus-visible { border-color: #7eeaff; outline: 2px solid rgba(126,234,255,.72); outline-offset: 3px; }
      .dancer-profile-preview-overlay .social-list :is(a,button) svg { width: 23px; height: 23px; display: block; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-profile-preview-overlay .social-list :is(.social-link-instagram,.social-link-x) svg { fill: none; }
      .dancer-profile-preview-overlay .social-list :is(a,button) .logo-cutout { fill: #0d0a17; stroke: none; }
      .dancer-profile-preview-overlay .profile-schedule-section { display: grid; gap: 14px; margin-top: 24px; padding: 18px; border: 1px solid rgba(139,92,246,.27); border-radius: 18px; background: rgba(10,10,16,.84); }
      .dancer-profile-preview-overlay .profile-schedule-section .eyebrow { color:#f7f2ff; }
      .dancer-profile-preview-overlay .profile-section-heading { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .dancer-profile-preview-overlay .profile-section-heading > div { min-width: 0; display: grid; gap: 5px; }
      .dancer-profile-preview-overlay .profile-section-heading h2 { max-width: 100%; margin: 0; overflow-wrap: anywhere; color: #fff; font-size: clamp(22px,5vw,32px); line-height: 1.05; }
      .dancer-profile-preview-overlay .profile-section-heading > span { align-self: start; color: #9487a5; font-size: 11px; font-weight: 850; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-schedule-section > p { margin:0; color:#cfc5de; font-size:13px; line-height:1.45; }
      .dancer-profile-preview-overlay .profile-deal-availability { margin-top:12px; border:0; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .venue-qr-unavailable { width:100%; min-height:140px; display:grid; grid-template-columns:minmax(0,1fr) 128px; align-items:center; justify-self:stretch; gap:14px; padding:14px 15px; border:1px solid rgba(148,163,184,.13); border-radius:18px; color:rgba(203,196,214,.76); background:rgba(17,17,24,.82); box-shadow:none; text-align:left; }
      .dancer-profile-preview-overlay .profile-tonight-card { margin-top:12px; overflow:hidden; border:1px solid rgba(139,92,246,.24); border-radius:15px; background:linear-gradient(145deg,rgba(13,11,21,.94),rgba(6,7,11,.98)); box-shadow:0 12px 32px rgba(0,0,0,.26); }
      .dancer-profile-preview-overlay .profile-tonight-card > .profile-schedule-section { width:100%; margin:0; padding:14px; border:0; border-radius:0; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .profile-tonight-deal { padding:5px; border-top:1px solid rgba(255,255,255,.08); }
      .dancer-profile-preview-overlay .profile-tonight-deal .venue-qr-unavailable { min-height:76px; padding:6px 8px; border:0; border-radius:0; background:transparent; }
      .dancer-profile-preview-overlay .profile-deal-availability::before, .dancer-profile-preview-overlay .profile-deal-availability::after, .dancer-profile-preview-overlay .venue-qr-unavailable::before, .dancer-profile-preview-overlay .venue-qr-unavailable::after { content:none !important; display:none !important; background:none !important; box-shadow:none !important; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon { width:128px; min-width:128px; min-height:112px; display:grid; grid-template-rows:42px auto; place-items:center; align-content:center; gap:8px; padding:12px 10px; border:1px solid rgba(148,163,184,.18); border-radius:14px; color:rgba(203,196,214,.58); background:rgba(255,255,255,.035); box-shadow:inset 0 1px 0 rgba(255,255,255,.03); opacity:1; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon > svg { width:42px; height:42px; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon .qr-finder { fill:none; stroke:currentColor; stroke-width:2; stroke-linejoin:miter; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon .qr-module { fill:currentColor; stroke:none; }
      .dancer-profile-preview-overlay .venue-qr-unavailable-copy { min-width:0; display:grid; justify-items:start; gap:7px; }
      .dancer-profile-preview-overlay .venue-qr-unavailable-label { color:rgba(203,196,214,.76); font-size:clamp(18px,5vw,23px); font-weight:950; letter-spacing:-.015em; line-height:1.05; }
      .dancer-profile-preview-overlay .venue-qr-unavailable-copy small { color:rgba(203,196,214,.7); font-size:11px; font-weight:800; line-height:1.3; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-copy { display:grid; gap:2px; text-align:center; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-copy strong { color:rgba(203,196,214,.7); font-size:12px; font-weight:950; line-height:1.08; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-copy small { color:rgba(203,196,214,.64); font-size:9px; font-weight:850; line-height:1.12; }
      .dancer-profile-preview-overlay .live-actions { position:relative; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); column-gap:4px; row-gap:0; padding:3px 0 0; }
      .dancer-profile-preview-overlay .live-actions > button, .dancer-profile-preview-overlay .profile-action-share-slot .profile-share button { width:100%; min-height:48px; display:inline-flex; align-items:center; justify-content:center; padding:7px 10px; border:1px solid rgba(148,229,255,.24); border-radius:12px; color:#fff; background:rgba(148,229,255,.075); cursor:pointer; font-size:12px; font-weight:900; text-align:center; }
      .dancer-profile-preview-overlay .live-actions > button:disabled { opacity:.66; cursor:default; }
      .dancer-profile-preview-overlay .live-actions .profile-action-going { flex-direction:column; gap:2px; }
      .dancer-profile-preview-overlay .live-actions .profile-action-primary { border-color:rgba(126,234,255,.48); background:linear-gradient(135deg,rgba(109,40,217,.86),rgba(11,148,201,.74)); box-shadow:0 12px 30px rgba(49,46,129,.2),0 0 18px rgba(34,199,255,.08); }
      .dancer-profile-preview-overlay .live-actions .profile-action-primary.profile-action-unavailable { border-color:rgba(148,137,166,.3); color:#bdb4ca; background:rgba(255,255,255,.055); }
      .dancer-profile-preview-overlay .live-actions .profile-action-unavailable { flex-direction:column; gap:1px; border-color:rgba(148,137,166,.22); color:#958b9f; background:rgba(255,255,255,.03); box-shadow:none; }
      .dancer-profile-preview-overlay .live-actions .profile-action-unavailable .profile-action-requirement { color:#83798d; }
      .dancer-profile-preview-overlay .profile-action-requirement { color:#c7bbd8; font-size:8px; font-weight:850; line-height:1.1; }
      .dancer-profile-preview-overlay .profile-action-requires-account { flex-direction:column; gap:1px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-main { display:inline-flex; align-items:center; justify-content:center; gap:7px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame { width:15px; height:15px; display:inline-grid; flex:0 0 15px; place-items:center; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-preview-icon { --profile-icon-offset-x:0px; --profile-icon-offset-y:0px; width:15px; height:15px; display:block; fill:none; stroke:currentColor; stroke-width:2.1; stroke-linecap:round; stroke-linejoin:round; transform:translate(var(--profile-icon-offset-x), var(--profile-icon-offset-y)); transform-origin:center; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="personPlus"] .profile-action-preview-icon { width:16.25px; height:16.25px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="bell"] .profile-action-preview-icon { width:13.75px; height:13.75px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="clock"] .profile-action-preview-icon { width:15.25px; height:15.25px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="share"] .profile-action-preview-icon { width:13px; height:13px; }
      .dancer-profile-preview-overlay .live-actions > button.profile-action-icon-control, .dancer-profile-preview-overlay .profile-action-share-slot .profile-share > button.profile-action-icon-control { min-height:54px; align-self:stretch; flex-direction:column; justify-content:flex-start; gap:1px; padding:2px; border:0; border-radius:0; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .profile-action-icon-control .profile-action-main { flex-direction:column; gap:2px; overflow:visible; }
      .dancer-profile-preview-overlay .profile-action-icon-control .profile-action-main > span { overflow:visible; color:#ded8e7; font-size:10px; line-height:1.05; text-overflow:clip; white-space:nowrap; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame { width:24px; height:24px; flex-basis:24px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon { width:24px; height:24px; padding:0; border:0; border-radius:0; color:#d9d2e2; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon-personPlus { --profile-icon-offset-x:.5px; --profile-icon-offset-y:-.5px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon-bell { --profile-icon-offset-y:-1px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon-clock { --profile-icon-offset-x:-.5px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="personPlus"] .profile-action-preview-icon { width:26px; height:26px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="bell"] .profile-action-preview-icon { width:22px; height:22px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="clock"] .profile-action-preview-icon { width:24px; height:24px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control.profile-action-going:not(.profile-action-unavailable) .profile-action-preview-icon { color:#a78bfa; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .live-actions > button.profile-action-icon-control.profile-action-unavailable:disabled { color:#766e7f; background:transparent; opacity:1; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control.profile-action-unavailable .profile-action-preview-icon { border:0; color:#756d7d; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .profile-action-icon-control .profile-action-requirement { max-width:100%; overflow:hidden; color:#8e8498; font-size:7px; text-overflow:ellipsis; white-space:nowrap; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-preview-static:disabled { opacity:1; cursor:default; }
      .dancer-profile-preview-overlay .profile-action-share-slot, .dancer-profile-preview-overlay .profile-action-overflow { position:relative; min-width:0; }
      .dancer-profile-preview-overlay .profile-action-share-slot { grid-column:auto; }
      .dancer-profile-preview-overlay .profile-action-share-slot .profile-share { display:block; min-height:54px; }
      .dancer-profile-preview-overlay .profile-action-share-slot .profile-share button { gap:6px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions > button:not(.profile-action-icon-control):not(.profile-report-action), .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-share-slot .profile-share button.profile-action-preview-share { display:grid; grid-template-rows:18px 9px; align-content:center; justify-items:center; row-gap:1px; column-gap:0; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions > button:not(.profile-action-icon-control):not(.profile-report-action) .profile-action-main, .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-share-slot .profile-share button .profile-action-main { grid-row:1; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions > button:not(.profile-action-icon-control):not(.profile-report-action) .profile-action-requirement { grid-row:2; }
      .dancer-profile-preview-overlay .profile-action-overflow-toggle { width:100%; min-height:48px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:7px 10px; border:1px solid rgba(148,229,255,.18); border-radius:12px; color:#d8d0e4; background:rgba(255,255,255,.04); cursor:default; font-size:12px; font-weight:900; }
      .dancer-profile-preview-overlay .profile-action-overflow-toggle > span:first-child { color:#9fefff; font-size:15px; letter-spacing:.08em; line-height:1; }
      .dancer-profile-preview-overlay .profile-overview { display:block; margin-top:0; padding:2px 0 0; border:0; }
      .dancer-profile-preview-overlay .profile-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin:0; }
      .dancer-profile-preview-overlay .profile-metrics > div { min-width:0; display:grid; gap:3px; justify-items:center; padding:6px 4px; }
      .dancer-profile-preview-overlay .profile-metrics dd { margin:0; color:#eee9f5; font-size:clamp(19px,3.75vw,24px); font-weight:900; letter-spacing:.01em; line-height:1.08; }
      .dancer-profile-preview-overlay .profile-metrics dt { color:#8f849c; font-size:clamp(9px,2.1vw,11px); font-weight:850; line-height:1.25; text-align:center; }
      .dancer-profile-preview-overlay .dancer-profile-preview-status > p { color: #cfc5de; font-size: 13px; line-height: 1.45; }
      .dancer-profile-preview-overlay.is-editor { z-index:1510; }
      .dancer-profile-preview-overlay.is-editor .dancer-profile-preview-shell { padding-bottom: max(156px,calc(env(safe-area-inset-bottom) + 136px)); }
      .dancer-profile-builder-avatar-control { width:48px; display:grid; flex:0 0 48px; justify-items:center; gap:3px; }
      .dancer-profile-builder-avatar-control > small { color:#a9a1b5; font-size:8px; font-weight:850; letter-spacing:.04em; line-height:1; }
      .dancer-profile-builder-avatar { width:42px; min-width:42px; max-width:42px; height:42px; min-height:42px; max-height:42px; aspect-ratio:1; appearance:none; padding:0; line-height:0; cursor:pointer; }
      .dancer-profile-builder-avatar.is-empty { overflow:visible !important; border-style:solid !important; color:#c9f7ff !important; background:linear-gradient(145deg,rgba(124,58,237,.34),rgba(34,199,255,.13)) !important; }
      .dancer-profile-builder-avatar-add { width:22px; height:22px; display:block; fill:none; stroke:currentColor; stroke-width:2.25; stroke-linecap:round; }
      .dancer-profile-builder-avatar > i { position:absolute; z-index:3; right:-4px; bottom:-4px; width:18px; min-width:18px; max-width:18px; height:18px; min-height:18px; max-height:18px; display:grid; place-items:center; padding:0; border:1px solid rgba(126,234,255,.52); border-radius:50%; color:#fff; background:#5b20c8; box-shadow:0 4px 12px rgba(0,0,0,.48); font-size:10px; font-style:normal; font-weight:950; line-height:1; }
      .dancer-profile-builder-avatar > i svg { width:12px; height:12px; display:block; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
      body.dancr-button-system .dancer-profile-builder-avatar { width:42px !important; min-width:42px !important; max-width:42px !important; height:42px !important; min-height:42px !important; max-height:42px !important; padding:0 !important; border-radius:50% !important; box-shadow:0 10px 26px rgba(0,0,0,.36),0 0 0 2px rgba(126,234,255,.08),0 0 18px rgba(124,58,237,.15) !important; }
      .dancer-profile-builder-identity { min-width:0; display:inline-flex; align-items:center; gap:7px; padding:0; border:0; color:#fff; background:transparent; font:inherit; text-align:left; cursor:pointer; }
      .dancer-profile-builder-name { max-width:min(52vw,440px); overflow:hidden; font-size:clamp(20px,4vw,26px); font-weight:950; line-height:1.05; letter-spacing:-.025em; text-overflow:ellipsis; white-space:nowrap; }
      .dancer-profile-builder-identity > span:last-child { width:18px; height:18px; display:grid; flex:0 0 18px; place-items:center; border:1px solid rgba(126,234,255,.25); border-radius:50%; color:#bff7ff; background:rgba(34,199,255,.09); font-size:10px; font-weight:950; }
      .dancer-profile-builder-city { gap:5px; border-color:rgba(126,234,255,.3) !important; color:#d8f8ff !important; cursor:pointer; }
      .dancer-profile-builder-city span { font-size:10px; font-weight:950; }
      body.dancr-button-system .dancer-profile-builder-identity { min-height:0 !important; padding:0 !important; border:0 !important; border-radius:0 !important; background:transparent !important; box-shadow:none !important; }
      body.dancr-button-system .dancer-profile-builder-city { min-height:22px !important; padding:0 8px !important; border-radius:999px !important; background:rgba(255,255,255,.035) !important; box-shadow:none !important; }
      .dancer-profile-builder-empty-slots button { width:100%; min-width:0; aspect-ratio:4 / 5; display:grid; place-items:center; padding:0; border:1px dashed rgba(126,234,255,.27); border-radius:11px; color:#d8f8ff; background:rgba(126,234,255,.045); font:inherit; font-size:24px; cursor:pointer; }
      body.dancr-button-system .dancer-profile-builder-empty-slots button { min-height:0 !important; padding:0 !important; border-radius:11px !important; background:rgba(126,234,255,.045) !important; box-shadow:none !important; }

      .dancer-profile-builder-media-slots { width:min(100%,760px); max-width:100%; display:grid; gap:16px; margin:10px auto 0; }
      .dancer-profile-builder-slot-group { min-width:0; display:grid; gap:9px; }
      .dancer-profile-builder-slot-group > header { display:flex; align-items:end; justify-content:space-between; gap:12px; padding:0 2px; }
      .dancer-profile-builder-slot-group > header > span { min-width:0; display:grid; gap:2px; }
      .dancer-profile-builder-slot-group > header strong { color:#fff; font-size:17px; line-height:1.15; }
      .dancer-profile-builder-slot-group > header small { color:#a9a1b5; font-size:10px; font-weight:760; line-height:1.25; }
      .dancer-profile-builder-slot-group > header b { flex:0 0 auto; color:#c9c3d2; font-size:11px; line-height:1; }
      .dancer-profile-builder-slot-grid { min-width:0; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }
      .dancer-profile-builder-slot { position:relative; isolation:isolate; min-width:0; min-height:0; aspect-ratio:4 / 5; display:grid; place-items:center; overflow:hidden; padding:0; border:1px solid rgba(255,255,255,.1); border-radius:8px; color:#e9e5ee; background:#0b0a0f; box-shadow:none; cursor:pointer; }
      .dancer-profile-builder-slot::after { position:absolute; z-index:1; inset:auto 0 0; height:42%; content:""; pointer-events:none; background:linear-gradient(180deg,transparent,rgba(0,0,0,.82)); }
      .dancer-profile-builder-slot > img, .dancer-profile-builder-slot > video { position:absolute; z-index:0; inset:0; width:100%; height:100%; display:block; object-fit:cover; background:#08080b; }
      .dancer-profile-builder-slot > span { position:relative; z-index:2; width:31px; height:31px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.18); border-radius:50%; color:#fff; background:rgba(255,255,255,.07); font-size:22px; line-height:1; }
      .dancer-profile-builder-slot > i { position:relative; z-index:2; width:34px; height:34px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.22); border-radius:50%; color:#fff; background:rgba(0,0,0,.52); font-size:13px; font-style:normal; }
      .dancer-profile-builder-slot > small { position:absolute; z-index:2; right:6px; bottom:6px; left:6px; overflow:hidden; color:#fff; font-size:9px; font-weight:900; line-height:1.1; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
      .dancer-profile-builder-slot.is-empty { border-style:dashed; border-color:rgba(255,255,255,.18); background:rgba(255,255,255,.035); }
      .dancer-profile-builder-slot.is-more { align-content:center; gap:5px; padding:10px; border-style:solid; border-color:rgba(139,92,246,.32); background:linear-gradient(145deg,rgba(124,58,237,.14),rgba(255,255,255,.035)); }
      .dancer-profile-builder-slot.is-more::after { display:none; }
      .dancer-profile-builder-slot.is-more > strong { position:relative; z-index:2; color:#fff; font-size:11px; line-height:1.1; }
      .dancer-profile-builder-slot.is-more > small { position:relative; inset:auto; color:#aaa2b5; font-size:8px; text-align:center; white-space:normal; }
      .dancer-profile-builder-slot:hover, .dancer-profile-builder-slot:focus-visible { z-index:2; border-color:rgba(255,255,255,.42); outline:none; }
      body.dancr-button-system .dancer-profile-builder-slot { min-height:0 !important; padding:0 !important; border-radius:8px !important; background:#0b0a0f !important; box-shadow:none !important; }
      body.dancr-button-system .dancer-profile-builder-slot.is-empty { background:rgba(255,255,255,.035) !important; }
      body.dancr-button-system .dancer-profile-builder-slot.is-more { padding:10px !important; background:linear-gradient(145deg,rgba(124,58,237,.14),rgba(255,255,255,.035)) !important; }
      .dancer-profile-builder-media-actions { width:min(100%,760px); max-width:100%; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; margin:10px auto 0; }
      .dancer-profile-builder-media-actions button { min-height:46px; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid rgba(126,234,255,.24); border-radius:12px; color:#effcff; background:linear-gradient(145deg,rgba(124,58,237,.14),rgba(34,199,255,.06)); font:inherit; font-size:12px; font-weight:900; cursor:pointer; }
      .dancer-profile-builder-media-actions button span { width:21px; height:21px; display:grid; place-items:center; border-radius:50%; background:rgba(126,234,255,.12); }
      .dancer-profile-builder-social-platform { position:relative; cursor:pointer; }
      .dancer-profile-builder-social-platform > svg { position:relative; z-index:1; }
      .dancer-profile-builder-social-platform > span { position:absolute; z-index:2; top:-2px; right:-2px; width:18px; height:18px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.34); border-radius:50%; color:#fff; background:#5b20c8; box-shadow:0 3px 9px rgba(0,0,0,.5); font-size:12px; font-weight:950; line-height:1; }
      .dancer-profile-builder-social-platform.is-added { border-color:rgba(64,220,148,.58) !important; background:rgba(36,176,112,.1) !important; }
      .dancer-profile-builder-social-platform.is-added > span { border-color:rgba(139,255,199,.55); background:#168558; }
      body.dancr-button-system .public-profile-shell .dancer-profile-builder-social-platform { width:48px !important; min-width:48px !important; height:48px !important; min-height:48px !important; flex:0 0 48px !important; padding:0 !important; border-radius:50% !important; }
      .dancer-social-link-modal-backdrop { position:fixed; z-index:35; inset:0; display:grid; align-items:end; justify-items:center; padding:12px max(12px,env(safe-area-inset-right)) max(12px,calc(92px + env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left)); background:rgba(0,0,0,.66); backdrop-filter:blur(4px); }
      .dancer-profile-builder-panel.dancer-social-link-modal { position:relative; z-index:1; inset:auto; left:auto; bottom:auto; width:min(100%,460px); max-height:min(72dvh,440px); grid-template-rows:auto minmax(0,1fr); padding:0; border:1px solid rgba(139,92,246,.34); border-radius:20px; background:linear-gradient(180deg,rgba(16,13,25,.995),rgba(7,7,11,.998)); box-shadow:0 24px 80px rgba(0,0,0,.68),0 0 30px rgba(124,58,237,.16); transform:none; }
      .dancer-profile-builder-panel.dancer-social-link-modal > header { position:static; gap:12px; padding:14px 14px 12px; border-bottom:1px solid rgba(255,255,255,.08); background:transparent; }
      .dancer-profile-builder-panel.dancer-social-link-modal > header > button { width:42px; min-width:42px; height:42px; min-height:42px; flex:0 0 42px; }
      .dancer-profile-builder-panel.dancer-social-link-modal > div { overflow-x:hidden; overflow-y:auto; padding:14px; scroll-padding-bottom:16px; }
      .dancer-social-link-modal-heading { min-width:0; display:flex; align-items:center; gap:11px; }
      .dancer-social-link-modal-heading > span { width:40px; height:40px; display:grid; flex:0 0 40px; place-items:center; border:1px solid rgba(139,92,246,.36); border-radius:50%; color:#fff; background:rgba(124,58,237,.1); }
      .dancer-social-link-modal-heading > span svg { width:21px; height:21px; display:block; fill:currentColor; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .dancer-social-link-modal-heading.is-instagram > span { color:#ff6b9a; }
      .dancer-social-link-modal-heading.is-tiktok > span { color:#48e8ed; }
      .dancer-social-link-modal-heading.is-snapchat > span { color:#ffe84a; }
      .dancer-social-link-modal-heading.is-x > span { color:#f4f1f8; }
      .dancer-social-link-modal-heading.is-onlyfans > span { color:#46c7ed; }
      .dancer-social-link-modal-heading.is-instagram svg,
      .dancer-social-link-modal-heading.is-x svg { fill:none; }
      .dancer-social-link-modal-heading .logo-cutout { fill:#0b0a11; stroke:none; }
      .dancer-profile-builder-panel.dancer-social-link-modal > header h2 { min-width:0; overflow-wrap:anywhere; font-size:clamp(19px,5vw,23px); line-height:1.1; }
      .dancer-social-link-form { display:grid !important; grid-template-columns:1fr !important; gap:11px !important; align-items:stretch !important; }
      .dancer-social-link-form > label { min-width:0; display:grid; gap:7px; color:#d9d4e1; font-size:12px; font-weight:900; line-height:1.2; }
      .dancer-social-link-form input { width:100%; min-width:0; min-height:50px; box-sizing:border-box; padding:0 14px; border:1px solid rgba(148,163,184,.42); border-radius:13px; outline:none; color:#f8fafc; background:#111118; font:inherit; font-size:16px; }
      .dancer-social-link-form input::placeholder { color:#94a3b8; opacity:.78; }
      .dancer-social-link-form input:focus { border-color:#7c3aed; box-shadow:0 0 0 3px rgba(124,58,237,.2); }
      .dancer-social-link-form .dancer-form-save-state { min-height:0; margin:0; color:#cbd5e1; font-size:11px; line-height:1.35; }
      .dancer-social-link-form .dancer-form-save-state.is-unsaved { color:#fda4af; }
      .dancer-social-link-save,
      .dancer-social-link-remove { width:100%; min-height:48px; border-radius:13px; font:inherit; font-size:14px; font-weight:950; cursor:pointer; }
      .dancer-social-link-save { border:1px solid rgba(196,181,253,.5); color:#fff; background:#7c3aed; box-shadow:0 0 18px rgba(124,58,237,.18); }
      .dancer-social-link-remove { min-height:42px; border:1px solid rgba(239,68,68,.32); color:#fecaca; background:rgba(239,68,68,.08); box-shadow:none; }
      .dancer-social-link-save:disabled,
      .dancer-social-link-remove:disabled,
      .dancer-profile-builder-panel.dancer-social-link-modal > header > button:disabled { cursor:wait; opacity:.58; }
      body.dancr-button-system .dancer-social-link-save { min-height:48px !important; border-color:rgba(196,181,253,.5) !important; border-radius:13px !important; color:#fff !important; background:#7c3aed !important; box-shadow:0 0 18px rgba(124,58,237,.18) !important; }
      body.dancr-button-system .dancer-social-link-remove { min-height:42px !important; border-color:rgba(239,68,68,.32) !important; border-radius:13px !important; color:#fecaca !important; background:rgba(239,68,68,.08) !important; box-shadow:none !important; }
      .dancer-profile-builder-panel { position:fixed; z-index:30; left:50%; bottom:0; width:min(calc(100% - 24px),760px); max-height:min(88dvh,780px); box-sizing:border-box; display:grid; grid-template-rows:auto minmax(0,1fr); overflow:hidden; padding:0 max(12px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); border:1px solid rgba(126,234,255,.28); border-bottom:0; border-radius:22px 22px 0 0; outline:none; color:#f7f2ff; background:linear-gradient(180deg,rgba(15,12,25,.995),rgba(5,5,8,.998)); box-shadow:0 -24px 80px rgba(0,0,0,.72),0 0 36px rgba(109,40,217,.2); transform:translateX(-50%); }
      .dancer-profile-builder-panel[hidden] { display:none; }
      .dancer-profile-builder-panel > header { position:sticky; z-index:2; top:0; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 2px 9px; border-bottom:1px solid rgba(255,255,255,.09); background:rgba(14,11,23,.98); }
      .dancer-profile-builder-panel > header h2 { margin:0; font-size:clamp(20px,5vw,28px); line-height:1.05; }
      .dancer-profile-builder-panel > header button { width:40px; min-width:40px; height:40px; min-height:40px; display:grid; place-items:center; padding:0; border:1px solid rgba(255,255,255,.14); border-radius:50%; color:#fff; background:rgba(255,255,255,.06); font-size:24px; cursor:pointer; }
      .dancer-profile-builder-panel > header button svg { width:22px; height:22px; display:block; overflow:visible; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
      .dancer-profile-builder-panel > div { min-width:0; max-width:100%; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; padding:10px 0 max(28px,env(safe-area-inset-bottom)); scroll-padding-bottom:max(28px,env(safe-area-inset-bottom)); scrollbar-width:thin; }
      .dancer-profile-builder-panel > div > * { width:100%; max-width:100%; min-width:0; box-sizing:border-box; }
      .dancer-profile-builder-panel .info-panel { grid-column:1 / -1; max-width:100%; box-sizing:border-box; overflow:hidden; padding:12px; }
      .dancer-profile-builder-panel .upload-panel > h2 { display:none; }
      .dancer-profile-builder-panel .photo-upload-heading { justify-content:flex-end; }
      .dancer-profile-builder-panel .photo-upload-heading > span { display:none; }
      .dancer-profile-builder-panel .photo-slot-summary { justify-content:center; }
      .dancer-profile-builder-panel .photo-slot-summary > span { display:none; }
      .dancer-profile-builder-panel[data-section="photos"] > div { padding-top:7px; padding-bottom:max(12px,env(safe-area-inset-bottom)); scroll-padding-bottom:max(12px,env(safe-area-inset-bottom)); }
      .dancer-profile-builder-panel[data-section="photos"] .upload-panel { gap:8px; padding:8px; border-radius:14px; }
      .dancer-profile-builder-panel[data-section="photos"] .dancer-photo-upload-form { grid-template-columns:auto auto; align-items:center; justify-content:center; gap:8px 12px; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-upload-heading { display:none; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-primary-choice,
      .dancer-profile-builder-panel[data-section="photos"] .photo-upload-status { grid-column:1 / -1; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-source-grid { margin:0; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-slot-summary { width:auto; justify-content:flex-start; white-space:nowrap; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-review-list:empty,
      .dancer-profile-builder-panel[data-section="photos"] .photo-review-list > p:only-child { display:none; }
      .dancer-profile-builder-panel .photo-source-grid,
      .dancer-profile-builder-panel .tv-video-source-grid { width:fit-content !important; max-width:100%; grid-template-columns:repeat(2,58px) !important; grid-auto-rows:58px !important; justify-content:center; gap:14px; margin-inline:auto; }
      .dancer-profile-builder-panel .photo-source-action,
      .dancer-profile-builder-panel .tv-video-source-action { width:58px !important; min-width:58px !important; max-width:58px !important; height:58px !important; min-height:58px !important; max-height:58px !important; display:grid !important; grid-template-columns:1fr !important; place-items:center; gap:0 !important; overflow:hidden; padding:0 !important; border-radius:50% !important; text-align:center; }
      .dancer-profile-builder-panel .photo-source-icon,
      .dancer-profile-builder-panel .tv-video-source-icon { width:100%; height:100%; border-radius:50%; background:rgba(34,199,255,.08); }
      .dancer-profile-builder-panel .photo-source-icon svg,
      .dancer-profile-builder-panel .tv-video-source-icon svg { width:26px; height:26px; }
      .dancer-profile-builder-panel .photo-source-copy,
      .dancer-profile-builder-panel .photo-source-cta,
      .dancer-profile-builder-panel .tv-video-source-copy,
      .dancer-profile-builder-panel .tv-video-source-cta { display:none; }
      .dancer-profile-builder-panel .tv-studio-embedded-head { justify-content:flex-end; margin-bottom:8px; }
      .dancer-profile-builder-panel .tv-studio-embedded-head > div { display:none; }
      .dancer-profile-builder-panel .tv-upload-form { width:100%; max-width:100%; box-sizing:border-box; gap:10px; padding:12px; overflow:hidden; }
      .dancer-profile-builder-panel .tv-upload-permissions strong { font-size:13px; }
      .dancer-profile-builder-panel .tv-upload-requirements { line-height:1.35; overflow-wrap:anywhere; }
      .dancer-avatar-source-grid { width:100%; }
      .dancer-profile-preview-overlay.is-editor .dancer-profile-editor-footer { position:fixed; z-index:18; left:50%; bottom:0; width:min(calc(100% - 24px),760px); margin:0; transform:translateX(-50%); }
      .dancer-profile-editor-tools { width:min(100%,760px); max-width:100%; min-width:0; box-sizing:border-box; display:grid; gap:14px; margin:24px auto 0; padding:18px; border:1px solid rgba(139,92,246,.3); border-radius:20px; background:linear-gradient(180deg,rgba(13,10,23,.96),rgba(7,7,11,.98)); box-shadow:0 24px 70px rgba(0,0,0,.34),inset 3px 0 0 rgba(139,92,246,.72); }
      .dancer-profile-editor-tools > header { display:grid; gap:6px; padding:0 2px 4px; }
      .dancer-profile-editor-tools > header h2,.dancer-profile-editor-tools > header p { margin:0; }
      .dancer-profile-editor-tools > header h2 { color:#fff; font-size:clamp(24px,5vw,34px); line-height:1.05; }
      .dancer-profile-editor-tools > header p { color:#b9accd; font-size:13px; line-height:1.45; }
      .dancer-profile-editor-grid { min-width:0; }
      .dancer-profile-editor-grid > .info-panel { grid-column:1 / -1; }
      .dancer-profile-editor-footer { position:sticky; z-index:12; bottom:0; width:min(100%,760px); max-width:100%; min-width:0; box-sizing:border-box; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; margin:18px auto 0; padding:12px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); border:1px solid rgba(126,234,255,.2); border-bottom:0; border-radius:18px 18px 0 0; background:rgba(7,7,11,.94); box-shadow:0 -16px 42px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.04); backdrop-filter:blur(22px); }
      .dancer-profile-editor-footer p { margin:0; color:#b9accd; font-size:11px; line-height:1.4; }
      .dancer-profile-editor-footer button { min-width:230px; min-height:48px; padding:0 18px; border:1px solid rgba(126,234,255,.5); border-radius:13px; color:#fff; background:linear-gradient(135deg,#7c2be8,#087fae); box-shadow:0 10px 28px rgba(79,30,174,.3); font:inherit; font-size:13px; font-weight:950; cursor:pointer; }
      .dancer-profile-editor-footer button:disabled { opacity:.62; cursor:wait; }
      .dancer-onboarding-primary { width: 100%; min-height: 52px; border: 1px solid rgba(196,122,255,.72); border-radius: 14px; color: #fff; background: linear-gradient(135deg, #8b20ef, #6d19d6); box-shadow: 0 10px 25px rgba(117,28,215,.2); font: inherit; font-weight: 950; cursor: pointer; }
      .dancer-onboarding-primary:disabled { opacity: .58; cursor: wait; }
      .dancer-onboarding-steps button:focus-visible, .dancer-onboarding-primary:focus-visible, .dancer-avatar-panel button:focus-visible, .dancer-avatar-panel input:focus-visible { outline: 2px solid #7eeaff; outline-offset: -3px; }
      .dancer-onboarding-announcement { min-height: 20px; color: #bfefff; font-size: 12px; font-weight: 760; line-height: 1.4; }
      .dancer-onboarding-payout-workspace { display:grid; gap:12px; }
      .dancer-onboarding-payout-card { display:grid; gap:11px; padding:15px; border:1px solid rgba(76,223,166,.22); border-radius:16px; background:linear-gradient(145deg,rgba(8,30,24,.72),#0d0d12 76%); }
      .dancer-onboarding-payout-card h3 { margin:0; color:#fff; font-size:20px; }
      .dancer-onboarding-payout-card p { margin:0; color:var(--mydancr-dashboard-muted); font-size:12px; line-height:1.5; }
      .dancer-onboarding-payout-state { width:fit-content; padding:7px 9px; border:1px solid rgba(126,234,255,.28); border-radius:999px; color:#bfefff; background:rgba(21,126,155,.11); font-size:10px; text-transform:uppercase; }
      .dancer-onboarding-payout-state.is-active { border-color:rgba(76,223,166,.36); color:#70efbd; background:rgba(25,140,101,.12); }
      .dancer-onboarding-payout-form { margin-top:2px; }
      .dancer-onboarding-payout-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .dancer-onboarding-payout-actions > :only-child { grid-column:1 / -1; }
      .dancer-onboarding-secondary { min-height:52px; border:1px solid rgba(255,255,255,.14); border-radius:14px; color:#f4f2f7; background:#24242c; font:inherit; font-weight:900; cursor:pointer; }
      .dancer-avatar-panel { grid-column: span 3; display: grid; gap: 13px; }
      .dancer-avatar-editor { display: grid; grid-template-columns: 78px minmax(0,1fr); align-items: center; gap: 14px; }
      .dancer-avatar-preview { width: 74px; height: 74px; font-size: 26px; }
      .dancer-avatar-editor > span:last-child { display: grid; gap: 5px; }
      .dancer-avatar-editor strong { color: #fff; }
      .dancer-avatar-editor small { color: var(--mydancr-dashboard-muted); line-height: 1.4; }
      .dancer-avatar-upload-controls { display: grid; grid-template-columns: minmax(0,1fr) auto auto; align-items: end; gap: 10px; }
      .dancer-avatar-upload-controls progress { width: 100%; height: 8px; grid-column: 1 / -1; accent-color: #7eeaff; }
      .dancer-avatar-panel label { display: grid; gap: 7px; color: #d7d5dd; font-size: 13px; font-weight: 850; }
      .dancer-avatar-panel input { min-height: 48px; box-sizing: border-box; padding: 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #fff; background: #16161b; }
      .dancer-avatar-panel button { min-height: 48px; padding: 0 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #fff; background: #17171d; font: inherit; font-weight: 900; cursor: pointer; }
      .dancer-avatar-panel p { color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .dashboard-shell-venue { --mydancr-dashboard-panel: #09090d; --mydancr-dashboard-panel-raised: #111116; --mydancr-dashboard-border: rgba(255,255,255,.105); --mydancr-dashboard-muted: rgba(218,218,226,.68); color-scheme: dark; background: #050507; }
      .dashboard-shell .dashboard-head { border-color: var(--mydancr-dashboard-border); background: #07070a; }
      .dashboard-shell-venue .venue-command-primary,
      .dashboard-shell .venue-dashboard-section,
      .dashboard-shell-venue .venue-dashboard-metrics { border-color: var(--mydancr-dashboard-border); background: var(--mydancr-dashboard-panel); }
      .dashboard-shell-venue .venue-command-primary { background: var(--mydancr-dashboard-panel-raised); }
      .dashboard-shell .venue-dashboard-section[open] > summary { background: rgba(255,255,255,.022); }
      .dashboard-shell .venue-dashboard-section-badge { border-color: rgba(255,255,255,.13); color: #d7d5dd; background: rgba(255,255,255,.045); }
      .dashboard-shell-dancer #dancer-performance .venue-dashboard-section-badge { border-color: rgba(245,158,11,.42); color: #fde68a; background: rgba(245,158,11,.12); box-shadow: 0 0 16px rgba(245,158,11,.08); }
      .dashboard-shell .venue-dashboard-section-body > .info-panel,
      .dashboard-shell .venue-dashboard-inner-grid > .info-panel { border-color: transparent; background: var(--mydancr-dashboard-panel-raised); }
      .dashboard-shell-venue .venue-working-list span { color: #76f0c8; }
      .dashboard-shell-venue .venue-deal-panel,
      .dashboard-shell-venue .venue-verification-panel { border-color: var(--mydancr-dashboard-border); background: var(--mydancr-dashboard-panel-raised); }
      .dashboard-shell-venue .venue-deal-placement-note { color: var(--mydancr-dashboard-muted) !important; }
      .dashboard-shell-venue .venue-deal-list > button { border-color: var(--mydancr-dashboard-border); color: #f8f7fb; background: #141419; }
      .dashboard-shell-venue .venue-deal-list > button.add { border-style: dashed; color: #d7d5dd; }
      .dashboard-shell-venue .venue-deal-list span { color: #aaa6b2; }
      .dashboard-shell-venue .venue-deal-list small { color: #aaa6b2; }
      .dashboard-shell-venue .venue-deal-list small.is-live { color: #78ffc0; }
      .dashboard-shell-venue .venue-deal-builder-step,
      .dashboard-shell-venue .venue-deal-review,
      .dashboard-shell-venue .venue-deal-qr-generator,
      .dashboard-shell-venue .venue-deal-how,
      .dashboard-shell-venue .venue-redemption-instructions,
      .dashboard-shell-venue .commission-tier-table { border-color: var(--mydancr-dashboard-border); background: #0d0d12; box-shadow: none; }
      .dashboard-shell-venue .venue-deal-builder-step legend > span:first-child { border: 1px solid rgba(196,122,255,.8); color: #fff; background: linear-gradient(135deg, #a020f0, #6d19d6); box-shadow: 0 0 0 3px rgba(139,92,246,.12), 0 0 18px rgba(139,92,246,.36); }
      .dashboard-shell-venue .venue-deal-rule-note,
      .dashboard-shell-venue .venue-redemption-instructions { border-color: rgba(255,255,255,.18); color: #c9c7d0; background: rgba(255,255,255,.035); }
      .dashboard-shell-venue .venue-deal-panel label { color: #d7d5dd; }
      .dashboard-shell-venue .venue-deal-panel input,
      .dashboard-shell-venue .venue-deal-panel textarea,
      .dashboard-shell-venue .venue-deal-panel select { border-color: rgba(255,255,255,.14); color: #f8f7fb; background: #16161b; }
      .dashboard-shell-venue .venue-deal-panel button { border: 1px solid rgba(255,255,255,.14); color: #f8f7fb; background: #17171d; box-shadow: none; }
      .dashboard-shell-venue .venue-deal-live-list > button { border-color: rgba(16,185,129,.28); background: rgba(16,185,129,.07); }
      .dashboard-shell-venue .venue-deal-control-actions > button.venue-deal-control-primary { border-color: rgba(196,181,253,.54); color: #fff; background: #7c3aed; box-shadow: 0 0 16px rgba(124,58,237,.18); }
      .dashboard-shell-venue .venue-deal-form-actions .primary { border-color: rgba(196,122,255,.72); color: #fff; background: linear-gradient(135deg, #8b20ef, #6d19d6); }
      .dashboard-shell-venue .venue-deal-form-actions .secondary { color: #f8f7fb; background: #17171d; }
      .dashboard-shell-venue .venue-deal-form-actions .danger { border-color: rgba(255,86,108,.3); color: #ffccd3; background: rgba(255,86,108,.12); }
      .dashboard-shell-venue .venue-deal-share-options { border-color: var(--mydancr-dashboard-border); background: rgba(255,255,255,.025); }
      .dashboard-shell-venue .venue-deal-share-options button { border-color: rgba(255,255,255,.14); color: #f8f7fb; background: #17171d; }
      .dashboard-shell-venue .venue-deal-how > summary::after { color: #c4b5fd; }
      .dashboard-shell-venue .currency-input { border-color: rgba(255,255,255,.14); background: #16161b; }
      .dashboard-shell-venue .currency-input > span,
      .dashboard-shell-venue .commission-tier-table > strong { color: #d7d5dd; }
      .dashboard-shell-venue .commission-tier-table > strong { background: rgba(255,255,255,.04); }
      @media (max-width: 720px) { .venue-deal-control-card, .venue-contract-summary { grid-template-columns: 1fr; } .venue-deal-control-actions { justify-content: flex-start; } .venue-deal-control-actions > button, .venue-deal-control-actions > a { flex: 1 1 140px; } .venue-contract-history section { grid-template-columns: 1fr; } }
      @media (max-width: 680px) {
        .dancer-performance-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .dancer-performance-summary .metric { min-height: 70px; padding: 11px 12px; }
        .dancer-performance-summary .metric:nth-child(odd) { border-left: 0; }
        .dancer-performance-summary .metric:nth-child(n + 3) { border-top: 1px solid var(--mydancr-dashboard-border); }
        .dancer-performance-detail > summary { grid-template-columns: minmax(0, 1fr) 36px; min-height: 76px; padding: 13px 14px; }
        .dancer-performance-detail > summary > b { grid-column: 1; grid-row: 2; }
        .dancer-performance-detail > summary > i { grid-column: 2; grid-row: 1 / span 2; }
        .dancer-performance-detail-body { padding: 13px; }
        .weekly-result-summary { align-items: flex-start; flex-direction: column; gap: 8px; }
        .earnings-history-tabs button { padding: 5px 8px; }
      }
      @media (max-width: 860px) { .dashboard-grid, .venue-dashboard-overview-grid, .venue-dashboard-account-grid, .setup-panel form, .upload-panel form, .verification-panel form, .shift-panel form, .shift-checkin-card, .dashboard-shift, .billing-grid, .customer-settings-panel form, .notification-head, .socials-panel form, .share-grid, .impact-grid, .deal-metrics, .customer-saved-grid, .customer-settings-grid, .venue-deal-panel form, .venue-deal-metrics, .venue-deal-qr-generator, .venue-deal-qr-generator.has-qr, .venue-verification-controls, .dancer-verification-qr, .venue-verification-preview, .venue-verification-scanner { grid-template-columns: 1fr; } .setup-panel, .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .deal-panel, .saved-deal-panel, .customer-saved-panel, .locked-analytics-panel, .visibility-panel, .venue-working-panel, .venue-deal-panel, .venue-verification-panel, .customer-settings-panel .city-field, .setup-panel label:nth-of-type(4), .venue-dashboard-account-grid > .support-panel, .venue-dashboard-account-grid > .account-controls-panel { grid-column: auto; grid-row: auto; } .venue-deal-qr-preview { width: min(100%, 320px); justify-self: center; } .commission-tier-table > div { grid-template-columns: 1fr; gap: 4px; } }
      @media (max-width: 620px) { .dashboard-shell { padding-left: 12px; padding-right: 12px; } .venue-command-links { grid-template-columns: 1fr; } .venue-dashboard-section > summary { min-height: 96px; grid-template-columns: minmax(0, 1fr) auto; padding: 15px; } .venue-dashboard-section-badge { grid-column: 1; grid-row: 2; } .venue-dashboard-section-toggle { grid-column: 2; grid-row: 1 / span 2; } .venue-dashboard-section-body { padding: 10px; } .venue-deal-step-grid, .venue-deal-review, .venue-deal-share-options, .venue-verification-actions, .venue-verification-manual > div, .customer-nfc-guide { grid-template-columns: 1fr; } .venue-deal-readonly-heading { flex-direction: column; } .venue-contract-deal-list, .venue-contract-deal-list dl, .venue-deal-request-center, .venue-deal-request-center > form { grid-template-columns: 1fr; } .venue-deal-request-center > button, .venue-deal-request-center form button { width: 100%; } .venue-deal-request-history article { grid-template-columns: 1fr; } .customer-dashboard-tabs { grid-template-columns: repeat(5, minmax(78px, 1fr)); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; } .customer-dashboard-tabs::-webkit-scrollbar { display: none; } .customer-dashboard-tabs a { padding: 0 6px; font-size: 12px; } .customer-night-card { grid-template-columns: 96px minmax(0, 1fr); } .customer-night-card > .customer-saved-card-image { width: 96px; min-height: 154px; } .customer-night-copy { padding: 13px; } .customer-night-copy h3 { font-size: 20px; } .customer-saved-head, .customer-section-heading.split { align-items: flex-start; flex-direction: column; } .customer-section-heading.split > strong, .notification-title-row > strong { min-width: 36px; width: 36px; height: 36px; font-size: 14px; } .customer-card-actions a, .customer-card-actions button, .customer-empty-state a { min-height: 42px; } .customer-settings-section { padding: 12px; } .deal-metrics .metric { border-left: 0; border-top: 1px solid var(--mydancr-dashboard-border); } .deal-metrics .metric:first-child { border-top: 0; } }
      @media (max-width: 620px) { .dancer-nats-signup-callout { grid-template-columns: 1fr; gap: 13px; padding: 15px; } .dancer-nats-signup-actions { display: grid; grid-template-columns: 1fr; justify-content: stretch; } .dancer-nats-signup-actions > a, .dancer-nats-signup-actions > button, .dancer-nats-signup-actions > b { width: 100%; min-height: 46px; } }
      @media (max-width: 520px) { .dashboard-head { padding: 10px 12px 14px; border-radius: 16px; } .dashboard-head-row { gap: 10px; } .dashboard-head h1, h1 { font-size: clamp(21px, 6vw, 26px); } .dashboard-close { flex-basis: 42px; } .notification-title-row { align-items: flex-start; } }
      @media (max-width: 520px) { .notification-toolbar { width: 100%; justify-content: flex-start; } .notification-mark-read-button { margin-left: auto; } .support-panel .support-send-button { width: 100%; } .account-action-row { gap: 10px; } .account-action-button { min-width: 78px; padding-inline: 10px; } }
      @media (max-width: 860px) { .dancer-avatar-upload-controls { grid-template-columns: 1fr; } .dancer-avatar-panel { grid-column: auto; } }
      @media (max-width: 620px) { .dashboard-shell-dancer { padding-bottom: max(40px, calc(env(safe-area-inset-bottom) + 24px)); } .dashboard-shell-dancer .dashboard-head { padding: 17px; border-radius: 20px; } .dashboard-shell-dancer .dashboard-head-title-row { align-items:flex-start; flex-direction:column; gap:7px; } .dashboard-shell-dancer .dashboard-section-summary > summary { min-height: 62px; padding: 12px 14px; } .dashboard-shell-dancer .dashboard-section-primary > summary { min-height: 74px; padding: 14px; } .dashboard-shell-dancer .dashboard-section-secondary > summary { min-height: 68px; padding: 13px 14px; } .dashboard-shell-dancer .dashboard-section-utility > summary { min-height: 60px; padding: 11px 14px; } .dancer-status-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } .dashboard-shell-dancer .dancer-status-metrics .metric { min-height: 64px; padding: 9px 10px; } .dancer-activation-confirmation { grid-template-columns: 44px minmax(0,1fr) 38px; gap: 10px; padding: 14px; } .dancer-activation-check { width: 42px; height: 42px; font-size: 21px; } .dancer-activation-confirmation > button { width: 38px; height: 38px; } .dancer-activation-actions { display:grid; grid-template-columns:1fr; } .dancer-profile-media-preview { grid-template-columns: 42px minmax(0,1fr); gap: 9px 11px; padding: 13px; } .dancer-profile-media-preview-icon { width: 40px; height: 40px; } .dancer-profile-media-preview-button { grid-column: 1 / -1; width: 100%; min-height: 46px; } .dancer-onboarding-command { padding: 14px; border-radius: 18px; } .dancer-onboarding-command-head { flex-direction: column; gap: 11px; } .dancer-onboarding-steps button { min-height: 82px; grid-template-columns: 34px minmax(0,1fr) 28px; gap: 5px 10px; } .dancer-onboarding-step-state { grid-column: 2; width: fit-content; min-width: 0; padding: 4px 7px; } .dancer-onboarding-step-toggle { grid-column: 3; grid-row: 1 / span 2; } .dancer-onboarding-step-panel { padding: 10px; } .dancer-onboarding-primary { position: static; } .dancer-avatar-panel button, .dancer-avatar-panel input, .setup-panel button, .setup-panel input, .setup-panel select, .socials-panel button, .socials-panel input, .upload-panel button, .upload-panel input { min-height: 48px; } .dancer-onboarding-preview-card { grid-template-columns: 58px minmax(0,1fr); } .dancer-onboarding-preview-card > b { grid-column: 2; } .dancer-profile-preview-shell { padding-inline: max(12px,env(safe-area-inset-left)) max(12px,env(safe-area-inset-right)); } .dancer-profile-preview-overlay .profile-titlebar { min-height: 64px; } .dancer-profile-preview-overlay .profile-titlebar-avatar { width: 48px; height: 48px; flex-basis: 48px; } .dancer-profile-preview-overlay .profile-media-feature { aspect-ratio: 4 / 5; border-radius: 17px; } .dancer-profile-preview-overlay .profile-schedule-section { padding: 15px; } .dancer-profile-preview-overlay .profile-section-heading { gap: 10px; } }
      @media (max-width: 620px) { .dashboard-shell-dancer { padding-bottom: max(128px, calc(env(safe-area-inset-bottom) + 104px)); } .dancer-onboarding-steps > li > button { min-height: 60px; grid-template-columns: 30px minmax(0,1fr) auto; gap: 8px; padding: 9px 10px; } .dancer-onboarding-step-control { grid-column: 3; grid-row: 1; } }
      @media (max-width: 620px) { .dancer-profile-preview-overlay .profile-media-tabs { width:100%; } .dancer-profile-preview-overlay .profile-media-tabs button { padding-inline:9px; } .dancer-profile-preview-overlay .profile-media-grid { gap:4px; } .dancer-profile-preview-overlay .profile-media-viewer-previous, .dancer-profile-preview-overlay .profile-media-viewer-next { width:40px; height:50px; font-size:30px; } }
      @media (max-width: 620px) { .dancer-profile-editor-launch-card { grid-template-columns:1fr; padding:14px; } .dancer-profile-editor-launch-button { width:100%; min-width:0; } .dancer-profile-editor-tools { margin-top:18px; padding:12px; border-radius:17px; } .dancer-profile-editor-footer { grid-template-columns:1fr; gap:8px; } .dancer-profile-editor-footer button { width:100%; min-width:0; } .dancer-profile-preview-overlay .live-actions { grid-template-columns:repeat(3,minmax(0,1fr)); } .dancer-profile-preview-overlay.is-editor .dancer-profile-preview-shell { padding-bottom:max(244px,calc(env(safe-area-inset-bottom) + 224px)); } .dancer-profile-builder-panel { bottom:calc(88px + env(safe-area-inset-bottom)); width:calc(100% - 16px); max-height:min(66dvh,620px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 104px - env(safe-area-inset-bottom))); padding-bottom:10px; border-bottom:1px solid rgba(126,234,255,.28); border-radius:20px; } .dancer-profile-preview-overlay.is-editor .dancer-profile-editor-footer { bottom:max(8px,env(safe-area-inset-bottom)); width:calc(100% - 16px); border-bottom:1px solid rgba(126,234,255,.2); border-radius:18px; } }
      @media (max-width: 620px) { .dancer-social-link-modal-backdrop { align-items:end; padding:10px max(10px,env(safe-area-inset-right)) max(10px,calc(92px + env(safe-area-inset-bottom))) max(10px,env(safe-area-inset-left)); } .dancer-profile-builder-panel.dancer-social-link-modal { inset:auto; left:auto; bottom:auto; width:100%; max-height:min(58dvh,360px,calc(100dvh - 118px - env(safe-area-inset-bottom))); padding:0; border-bottom:1px solid rgba(139,92,246,.34); border-radius:18px; transform:none; } .dancer-profile-builder-panel.dancer-social-link-modal > header { padding:12px 12px 10px; } .dancer-profile-builder-panel.dancer-social-link-modal > div { padding:12px; } .dancer-social-link-form input { min-height:48px; } }
      @media (max-width: 340px) { .dancer-profile-preview-overlay .venue-qr-unavailable { grid-template-columns:minmax(0,1fr) 112px; } .dancer-profile-preview-overlay .venue-qr-placeholder-icon { width:112px; min-width:112px; } }
      @media (max-width: 620px) { .dancer-onboarding-payout-actions { grid-template-columns:1fr; } }
      @media (max-width: 620px) { .dancer-step-one-workspace { padding-bottom: 28px; } .dancer-step-one-summary { grid-template-columns: 1fr; padding: 12px; } .dancer-step-one-summary > b { width: fit-content; } .dancer-step-one-checklist { grid-template-columns: 1fr; } .dancer-step-one-checklist button { min-height: 48px; grid-template-columns: 22px minmax(0,1fr); gap: 2px 7px; } .dancer-step-one-section-button { min-height: 72px; grid-template-columns: 30px minmax(0,1fr) 26px; gap: 7px; } .dancer-step-one-section-button em { grid-column: 2; width: fit-content; } .dancer-step-one-section-button i { grid-column: 3; grid-row: 1 / span 2; } .dancer-step-one-section-button small { white-space: normal; } .dancer-step-one-section-panel { padding: 6px; } .dancer-step-one-section-panel > .info-panel { padding: 10px; } .photo-source-grid { grid-template-columns: 1fr; } .dancer-step-one-section-panel .photo-upload-queue .photo-review-card { grid-template-columns: 72px minmax(0,1fr); gap: 10px; padding: 10px; } .dancer-step-one-section-panel .photo-upload-queue .photo-preview { width: 72px; } .dancer-step-one-section-panel .photo-review-list { grid-template-columns: repeat(2, minmax(0,1fr)); } .dancer-step-one-section-panel .photo-review-list .photo-review-card { min-height: 284px; gap: 8px; padding: 8px; } .dancer-step-one-section-panel .photo-review-list .photo-preview { width: 100%; } .dancer-step-one-section-panel .photo-delete-button { max-width: 100%; } .dancer-step-one-footer { grid-template-columns: 1fr; } .dancer-step-one-footer .dancer-onboarding-primary { width: 100%; } }
      @media (max-width: 620px) { .photo-upload-heading { align-items: flex-start; } .photo-source-action { min-height: 70px; } .photo-slot-summary { align-items: flex-start; flex-direction: column; gap: 2px; } .dancer-step-one-section-panel .photo-review-list { grid-template-columns: 1fr; } .dancer-step-one-section-panel .photo-review-list .photo-review-card { grid-template-columns: 92px minmax(0,1fr); align-items: start; min-height: 0; gap: 10px; padding: 10px; } .dancer-step-one-section-panel .photo-review-list .photo-preview { width: 92px; } }
      @media (max-width: 620px) { .shift-end-confirmation { grid-template-columns: 1fr; } .shift-end-confirmation > div { grid-template-columns: 1fr; } }
      @media (max-width: 620px) {
        .dashboard-shell-venue { padding-bottom: max(132px, calc(env(safe-area-inset-bottom) + 104px)); }
        .dashboard-shell-venue .dashboard-head { padding: 18px; border-radius: 20px; }
        .dashboard-shell-venue .dashboard-head h1 { font-size: clamp(30px,9vw,38px); }
        .venue-command-panel { gap: var(--mydancr-dashboard-gap); padding: 16px; }
        .venue-command-status { grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 11px; }
        .venue-refresh-control { grid-column: 1 / -1; width: 100%; display: flex; align-items: center; justify-content: space-between; }
        .venue-live-pill.is-inactive { font-size: 9px; }
        .venue-publication-panel { padding: 15px; }
        .venue-publication-actions { display: grid; grid-template-columns: 1fr; }
        .venue-publication-actions > button, .venue-publication-actions > a { width: 100%; min-height: 48px; }
        .venue-review-completion .venue-publication-actions { grid-template-columns: 1fr; gap: 10px; }
        .venue-review-package { padding: 12px; }
        .venue-review-package-heading { grid-template-columns: 60px minmax(0,1fr); gap: 11px; }
        .venue-review-logo { width: 60px; height: 60px; border-radius: 14px; }
        .venue-review-package dl > div { grid-template-columns: 1fr; gap: 4px; }
        .venue-workspace-tabs { top: max(6px,env(safe-area-inset-top)); gap: 3px; padding: 4px; border-radius: 14px; }
        .venue-workspace-tabs button { min-height: 76px; padding-inline: 5px; }
        .venue-workspace-tabs strong { font-size: 12px; }
        .venue-workspace-tabs small { font-size: 8px; }
        .venue-workspace-tab-status { font-size: 7.5px; }
        .venue-tonight-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .venue-tonight-metrics .metric:nth-child(odd) { border-left: 0; }
        .venue-tonight-metrics .metric:nth-child(n + 3) { border-top: 1px solid var(--mydancr-dashboard-border); }
        .venue-dashboard-metrics .metric { min-height: 62px; padding: 12px 10px; text-align: center; }
        .venue-dashboard-section > summary { min-height: 70px; padding: 14px; }
        .venue-referral-request-panel { grid-template-columns: 1fr; }
        .venue-referral-request-panel > button { width: 100%; }
        .venue-working-list a { align-items: flex-start; flex-direction: column; }
        .venue-working-verification { justify-items: start; text-align: left; padding-left: 58px; }
      }

      /* Compact profile editors share the social-link modal shell without duplicating editor logic. */
      .dancer-profile-editor-modal-backdrop { position:fixed; z-index:34; inset:0; display:grid; align-items:end; justify-items:center; padding:12px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); background:rgba(0,0,0,.66); backdrop-filter:blur(4px); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal { position:relative; z-index:1; inset:auto; left:auto; bottom:auto; width:min(100%,480px); max-height:min(82dvh,680px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 24px)); grid-template-rows:auto minmax(0,1fr) auto; padding:0; border:1px solid rgba(139,92,246,.34); border-radius:20px; background:linear-gradient(180deg,rgba(16,13,25,.995),rgba(7,7,11,.998)); box-shadow:0 24px 80px rgba(0,0,0,.68),0 0 30px rgba(124,58,237,.16); transform:none; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"],
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] { width:min(100%,680px); max-height:min(88dvh,760px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 24px)); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > header { position:static; padding:14px 14px 12px; border-bottom:1px solid rgba(255,255,255,.08); background:transparent; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > header h2 { min-width:0; overflow-wrap:anywhere; font-size:clamp(19px,5vw,23px); line-height:1.1; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > header > button { width:42px; min-width:42px; height:42px; min-height:42px; flex:0 0 42px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > .dancer-profile-editor-modal-body { overflow-x:hidden; overflow-y:auto; padding:14px; scroll-padding-bottom:18px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .info-panel { display:grid; gap:12px; overflow:visible; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
      .dancer-profile-editor-modal-actions { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(132px,190px); align-items:center; gap:12px; padding:12px 14px max(12px,env(safe-area-inset-bottom)); border-top:1px solid rgba(255,255,255,.08); background:rgba(9,8,14,.96); }
      .dancer-profile-editor-modal-actions > p { margin:0; color:#fda4af; font-size:11px; line-height:1.35; }
      .dancer-profile-editor-modal-actions > button { width:100%; min-height:48px; border:1px solid rgba(196,181,253,.5); border-radius:13px; color:#fff; background:#7c3aed; box-shadow:0 0 18px rgba(124,58,237,.18); font:inherit; font-size:14px; font-weight:950; cursor:pointer; }
      .dancer-profile-editor-modal-actions > button:disabled { cursor:wait; opacity:.58; }
      body.dancr-button-system .dancer-profile-editor-modal-actions > button { min-height:48px !important; border-color:rgba(196,181,253,.5) !important; border-radius:13px !important; color:#fff !important; background:#7c3aed !important; box-shadow:0 0 18px rgba(124,58,237,.18) !important; }

      .dancer-profile-editor-intro,
      .dancer-avatar-guidance { margin:0; color:#c5bdce !important; font-size:13px !important; line-height:1.4; }
      .dancer-profile-identity-editor .dancer-profile-identity-form { display:grid; grid-template-columns:1fr; gap:12px; }
      .dancer-profile-identity-editor .dancer-profile-identity-form > label { display:grid; gap:7px; color:#d9d4e1; font-size:12px; font-weight:900; line-height:1.2; }
      .dancer-profile-identity-editor .dancer-profile-identity-form input,
      .dancer-profile-identity-editor .dancer-profile-identity-form select { width:100%; min-width:0; min-height:50px; height:50px; box-sizing:border-box; padding:0 14px; border:1px solid rgba(148,163,184,.42); border-radius:13px; outline:none; color:#f8fafc; background:#111118; font:inherit; font-size:16px; }
      .dancer-profile-identity-editor .dancer-profile-identity-form input:focus,
      .dancer-profile-identity-editor .dancer-profile-identity-form select:focus { border-color:#7c3aed; box-shadow:0 0 0 3px rgba(124,58,237,.2); }
      .dancer-profile-identity-editor .dancer-profile-identity-form label small { color:#9f97aa; font-size:11px; font-weight:700; line-height:1.35; }
      .dancer-profile-identity-editor .dancer-form-save-state { min-height:0; margin:0; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel { justify-items:center; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel > * { width:100%; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-editor { position:relative; width:112px; display:grid; grid-template-columns:1fr; justify-items:center; gap:0; margin:2px auto; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-preview { width:108px; height:108px; font-size:36px; }
      .dancer-avatar-state { position:absolute; right:-7px; bottom:2px; width:auto !important; padding:5px 7px; border:1px solid rgba(255,255,255,.18); border-radius:999px; color:#f8fafc; background:#18171f; box-shadow:0 4px 14px rgba(0,0,0,.52); font-size:9px; font-weight:950; letter-spacing:.08em; line-height:1; text-transform:uppercase; }
      .dancer-avatar-state.is-approved { border-color:rgba(52,211,153,.4); color:#86efc0; background:#0e251d; }
      .dancer-avatar-state.is-checking { border-color:rgba(34,199,255,.4); color:#9aefff; background:#0b2027; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-upload-controls { display:grid; grid-template-columns:1fr; gap:10px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-guidance { text-align:center; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel > p[role="status"] { margin:0; color:#b9eff8; font-size:11px; line-height:1.4; text-align:center; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel button { width:100%; min-height:42px; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-grid,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-grid { width:100% !important; max-width:100%; grid-template-columns:repeat(2,minmax(0,1fr)) !important; grid-auto-rows:1fr !important; justify-content:stretch; gap:10px; margin:0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-action,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-action { width:100% !important; min-width:0 !important; max-width:none !important; height:auto !important; min-height:52px !important; max-height:none !important; display:grid !important; grid-template-columns:36px minmax(0,1fr) !important; align-items:center; justify-items:start; gap:9px !important; padding:8px 10px !important; border-radius:12px !important; text-align:left; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-icon,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-icon { width:36px; height:36px; border-radius:9px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-icon svg,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-icon svg { width:21px; height:21px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-copy,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-copy { display:grid; gap:1px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-copy strong,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-copy strong { font-size:12px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-copy small,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-copy small { font-size:9px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-cta,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-cta { display:none; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .upload-panel { gap:12px; padding:0; border-radius:0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .dancer-photo-upload-form { display:grid; grid-template-columns:1fr; align-items:stretch; justify-content:stretch; gap:10px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-heading { display:block; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-heading > span { display:block; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-heading strong { color:#c5bdce; font-size:13px; font-weight:750; line-height:1.4; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-primary-choice,
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-status { grid-column:auto; }
      .dancer-media-manager-title { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:3px; border-top:1px solid rgba(255,255,255,.08); }
      .dancer-media-manager-title strong { color:#fff; font-size:15px; }
      .dancer-media-manager-title span { color:#aaa2b5; font-size:11px; font-weight:800; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-review-list { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-review-list .photo-review-card { min-height:0; gap:8px; padding:8px; border-radius:12px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-review-list .photo-preview { width:100%; aspect-ratio:4 / 5; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-review-card em { font-size:10px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-card-actions { gap:5px !important; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-studio-embedded { overflow:visible; padding:0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-studio-embedded-head { display:block; margin:0 0 12px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-studio-embedded-head p { margin:0; color:#c5bdce; font-size:13px; line-height:1.4; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-form { display:grid; grid-template-columns:1fr; gap:10px; overflow:visible; padding:0; border:0; border-radius:0; background:transparent; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-form > * { grid-column:auto !important; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-permissions strong { font-size:13px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-check { min-height:0; grid-template-columns:20px minmax(0,1fr) !important; align-items:start; gap:9px; padding:10px; border:1px solid rgba(255,255,255,.09); border-radius:11px; background:rgba(255,255,255,.035); font-size:12px; font-weight:700; letter-spacing:normal; line-height:1.45; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-check input { width:18px; height:18px; margin:1px 0 0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-requirements { color:#9f97aa; font-size:10px; font-weight:700; line-height:1.4; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-video-manager { margin-top:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,.08); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-manager-title h3 { font-size:15px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-manager-title span { min-height:0; padding:0; color:#aaa2b5; background:transparent; font-size:11px; }

      @media (max-width:620px) {
        .dancer-profile-editor-modal-backdrop { align-items:end; padding:8px max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left)); }
        .dancer-profile-builder-panel.dancer-profile-editor-modal,
        .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"],
        .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] { inset:auto; left:auto; bottom:auto; width:100%; max-height:min(88dvh,720px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 16px)); padding:0; border-bottom:1px solid rgba(139,92,246,.34); border-radius:18px; transform:none; }
        .dancer-profile-builder-panel.dancer-profile-editor-modal > header { padding:12px 12px 10px; }
        .dancer-profile-builder-panel.dancer-profile-editor-modal > .dancer-profile-editor-modal-body { padding:12px; }
        .dancer-profile-editor-modal-actions { grid-template-columns:1fr; gap:7px; padding:10px 12px max(10px,env(safe-area-inset-bottom)); }
        .dancer-profile-editor-modal-actions > span:empty { display:none; }
        .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-review-list { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
    `}</style>
  );
}
