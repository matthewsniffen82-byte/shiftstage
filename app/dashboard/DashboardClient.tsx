"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import { PasswordField } from "@/app/components/PasswordField";
import DancerAgreementLink from "@/app/components/DancerAgreementLink";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { captureBrowserAuthSessionGuard } from "@/src/lib/dancr/browser-session";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import { DancerDashboardAvatar, DancerDashboardIcon } from "./DancerDashboardIdentity";
import "./dancer-dashboard.css";
import { CustomerDashboardAvatar, CustomerDashboardIcon } from "./CustomerDashboardIdentity";
import "./customer-dashboard.css";
import "./venue-dashboard.css";
import "./dashboard-polish.css";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import { isAffiliatedDancerWorkingNow } from "@/src/lib/dancr/venue-roster";
import { loadCustomerDashboard } from "./customer-dashboard-loader";
import { loadDancerDashboard } from "./dancer-dashboard-loader";
import CustomerAccountPanel from "./CustomerAccountPanel";
import { DEVICE_SAVED_DEALS_KEY, DEVICE_SAVED_DEALS_CHANGED_EVENT, mergeCustomerSavedClubDeals, readDeviceSavedClubDeals, type DeviceSavedClubDeal } from "@/src/lib/dancr/customer-device-deals";
import { DASHBOARD_SESSION_KEY as SESSION_KEY, DashboardDataRequestError, dashboardLoadErrorMessage, persistDashboardSession, readSession, requestAccountJson, requestDashboardJson, requestOptionalDashboardJson, requestVenueDashboardJson, storedSessionAccount, storedSessionIsFresh, type DashboardSessionAccount } from "./dashboard-session";
import type { DashboardRole, CustomerDashboardSection, LoadState, CustomerSavedState } from "./dashboard-types";
import { dashboardName, SupportInboxPanel, DashboardLoadingState, InfoPanel, DashboardSection, NotificationPanel, AccountControlsPanel, AccountSummaryPanel } from "./DashboardShared";
import { DashboardStyles } from "./DashboardStyles";
import { AgentDashboardShortcut, CustomerWelcomeCard, CustomerDashboardNav, CustomerPanel, CustomerPreferencesPanel } from "./CustomerDashboardPanels";
import dynamic from "next/dynamic";
const VenuePanel = dynamic(() => import("./VenueDashboardPanels").then(module => module.VenuePanel));

const DancerPanel = dynamic(() => import("./DancerDashboardPanels").then(module => module.DancerPanel));


function warmDashboardRoleTools(role: DashboardRole) {
  const tools = role === "dancer"
    ? [import("./DancerNfcPanel"), import("./DancerShiftManager")]
    : role === "venue"
      ? [import("./VenueNfcTagPanel"), import("./VenueTeamPanel"), import("./VenueTvPanel")]
      : [];
  // Warming must never block authentication or private data loading. React's
  // dynamic component still owns rendering and normal chunk error handling.
  void Promise.allSettled(tools);
}


export default function DashboardClient({
  role,
  initialSection,
  showCustomerWelcome = false,
}: {
  role: DashboardRole;
  initialSection?: CustomerDashboardSection;
  showCustomerWelcome?: boolean;
}) {
  const [state, setState] = useState<LoadState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [customerSavedLoading, setCustomerSavedLoading] = useState(true);
  const [deviceSavedDeals, setDeviceSavedDeals] = useState<DeviceSavedClubDeal[]>([]);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"tonight" | "7d" | "30d">("30d");
  const [isVenueRefreshing, setIsVenueRefreshing] = useState(false);
  const [venueRefreshStatus, setVenueRefreshStatus] = useState("");
  const [customerAlertCount, setCustomerAlertCount] = useState(0);
  const [customerSupportCount, setCustomerSupportCount] = useState(0);
  const venueRefreshAbortRef = useRef<AbortController | null>(null);
  const venueRefreshRequestRef = useRef(0);
  const initialSectionTargetRef = useRef("");
  const supportReady = state.supportThreads !== undefined;

  useEffect(() => {
    if (role !== "customer") return;
    const refreshDeviceDeals = () => {
      try {
        setDeviceSavedDeals(readDeviceSavedClubDeals(window.localStorage));
      } catch {
        // Account saves remain available when the browser blocks device storage.
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(`${DEVICE_SAVED_DEALS_KEY}:`) || event.key === SESSION_KEY || event.key === null) refreshDeviceDeals();
    };
    refreshDeviceDeals();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", refreshDeviceDeals);
    window.addEventListener("focus", refreshDeviceDeals);
    window.addEventListener(DEVICE_SAVED_DEALS_CHANGED_EVENT, refreshDeviceDeals);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", refreshDeviceDeals);
      window.removeEventListener("focus", refreshDeviceDeals);
      window.removeEventListener(DEVICE_SAVED_DEALS_CHANGED_EVENT, refreshDeviceDeals);
    };
  }, [role, state.account?.id]);

  const customerSaved = useMemo<CustomerSavedState>(() => ({
    ...state.saved,
    dealSaves: mergeCustomerSavedClubDeals(state.saved?.dealSaves || [], deviceSavedDeals),
  }), [state.saved, deviceSavedDeals]);

  const retryDashboard = useCallback(() => {
    setState((current) => role === "customer"
      ? { ...current, error: undefined, signInRequired: false, accountError: undefined, savedError: undefined }
      : { account: current.account });
    setIsLoading(true);
    setCustomerSavedLoading(true);
    setLoadAttempt((current) => current + 1);
  }, [role]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    function requestOptionalPanel<T>(path: string, fallback: T) {
      return requestOptionalDashboardJson(path, fallback, {
        signal: controller.signal,
        timeoutMs: role === "customer" ? 8000 : undefined,
      });
    }

    async function load() {
      const session = readSession();
      if (!session?.accessToken) {
        setState({ error: "Sign in to open this dashboard.", signInRequired: true });
        setIsLoading(false);
        return;
      }

      const cachedAccount = storedSessionAccount(session);
      warmDashboardRoleTools(role);
      if (cachedAccount) {
        setState((current) => ({ ...current, account: cachedAccount }));
      }

      if (role === "customer") {
        try {
          await loadCustomerDashboard(controller.signal, (panel, data) => {
            if (cancelled) return;
            if (panel === "redirect") {
              window.location.replace(data);
            } else if (panel === "account") {
              setState((current) => ({ ...current, account: data, accountError: undefined }));
              setIsLoading(false);
            } else if (panel === "accountError") {
              setState((current) => ({ ...current, accountError: data }));
              setIsLoading(false);
            } else if (panel === "saved" || panel === "savedError") {
              setState((current) => ({ ...current, ...(panel === "saved" ? { savedError: undefined } : {}), [panel]: data }));
              setCustomerSavedLoading(false);
            } else {
              const key = panel === "support" ? "supportThreads" : panel;
              setState((current) => ({ ...current, [key]: data }));
            }
          });
        } catch (error) {
          if (!cancelled) {
            controller.abort();
            setState((current) => ({ ...current, error: dashboardLoadErrorMessage(error), signInRequired: error instanceof DashboardDataRequestError && error.status === 401 }));
            setIsLoading(false);
          }
        }
        return;
      }

      if (role === "dancer") {
        try {
          await loadDancerDashboard(controller.signal, (panel, data) => {
            if (cancelled) return;
            setState((current) => panel === "ready"
              ? { ...current, ...data }
              : { ...current, [panel]: data });
            if (panel === "ready") setIsLoading(false);
          });
        } catch (error) {
          if (!cancelled) {
            controller.abort();
            setState((current) => ({ account: current.account, error: dashboardLoadErrorMessage(error) }));
            setIsLoading(false);
          }
        }
        return;
      }

      const loadDashboardPanels = async () => {
        return Promise.all([
          requestOptionalPanel("/api/venue/profile", { profile: null }),
          requestOptionalPanel("/api/venue/dashboard?period=30d", {}),
          requestOptionalPanel("/api/support", { threads: [] }),
        ]);
      };

      try {
        const accountRequest = requestAccountJson({
          cache: "no-store", fallbackMessage: "Unable to load account.", signal: controller.signal,
        });
        // Refresh expiring credentials once before starting concurrent reads.
        if (!storedSessionIsFresh(session)) await accountRequest;
        if (cancelled) return;
        const requestStatusResult = requestDashboardJson("/api/venue/signup-requests", {
          method: "GET", expectedRole: "venue", signal: controller.signal, timeoutMs: 12000,
          fallbackMessage: "Unable to check your club request.",
        }).then(data => ({ ok: true as const, data }), error => ({ ok: false as const, error }));
        const account = await accountRequest;
        if (cancelled) return;
        // Paused accounts can manage their login even though venue APIs reject
        // them. Do not let those failures or slow support hide recovery controls.
        if (account.account?.role === "venue" && account.account.accountState === "disabled") {
          setState({ account: account.account });
          setIsLoading(false);
          const support = await requestOptionalPanel("/api/support", { threads: [] });
          if (!cancelled) setState((current) => ({ ...current, supportThreads: support.threads || [] }));
          return;
        }
        const requestResult = await requestStatusResult;
        if (!requestResult.ok) throw requestResult.error;
        if (cancelled) return;
        const requestStatus = requestResult.data;
        if (requestStatus.request && requestStatus.request.status !== "approved") {
          const support = await requestOptionalPanel("/api/support", { threads: [] });
          if (cancelled) return;
          setState({ account: account.account, venueRequest: requestStatus.request, supportThreads: support.threads || [] });
          setIsLoading(false);
          return;
        }
        const [panels, agentAccess] = await Promise.all([
          loadDashboardPanels(),
          requestOptionalPanel("/api/agent/commissions?access=1", { access: { active: false } }),
        ]);
        const [profile, secondary, support] = panels;

        if (!cancelled) {
          setState({
            account: account.account,
            profile: profile.profile,
            saved: secondary.saved || null,
            analytics: secondary.analytics || null,
            deals: secondary.deals || null,
            supportThreads: support.threads || [],
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
          controller.abort();
          setState((current) => ({ account: current.account, error: dashboardLoadErrorMessage(error) }));
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadAttempt, role]);

  useEffect(() => {
    const initialAccountId = readSession()?.account?.id;
    const leaveDeletedSessionDashboard = () => {
      const currentSession = readSession();
      if (!currentSession?.accessToken) window.location.replace("/");
      else if (currentSession.account?.id !== initialAccountId) window.location.reload();
    };
    const handleSessionStorage = (event: StorageEvent) => {
      if (event.key === SESSION_KEY || event.key === null) leaveDeletedSessionDashboard();
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
    venueRefreshAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = venueRefreshRequestRef.current + 1;
    venueRefreshAbortRef.current = controller;
    venueRefreshRequestRef.current = requestId;
    const isCurrentRequest = () => (
      venueRefreshAbortRef.current === controller
      && venueRefreshRequestRef.current === requestId
      && !controller.signal.aborted
    );
    setIsVenueRefreshing(showStatus);
    if (showStatus) {
      setVenueRefreshStatus("Refreshing live venue data…");
    } else {
      setVenueRefreshStatus("");
    }
    try {
      const secondary = await requestVenueDashboardJson(analyticsPeriod, {
        cache: "no-store",
        fallbackMessage: "Unable to refresh live venue data.",
        signal: controller.signal,
      });
      if (!isCurrentRequest()) return;
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
      if (isCurrentRequest() && showStatus) {
        setVenueRefreshStatus(error instanceof Error ? error.message : "Unable to refresh live venue data.");
      }
    } finally {
      if (isCurrentRequest()) {
        venueRefreshAbortRef.current = null;
        if (showStatus) setIsVenueRefreshing(false);
      }
    }
  }, [analyticsPeriod, role]);

  useEffect(() => {
    if (role !== "venue" || isLoading || state.error || state.venueRequest || state.account?.accountState === "disabled") return;
    void refreshVenueDashboard(false);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refreshVenueDashboard(false); };
    const timer = window.setInterval(refreshWhenVisible, 45_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      venueRefreshAbortRef.current?.abort();
      venueRefreshAbortRef.current = null;
      venueRefreshRequestRef.current += 1;
    };
  }, [analyticsPeriod, isLoading, refreshVenueDashboard, role, state.error, state.venueRequest, state.account?.accountState]);

  useEffect(() => {
    if (isLoading || state.error) return;
    const initialSectionId = role === "customer" && initialSection
      ? initialSection === "offers" ? "customer-saved-deals" : "customer-followed-dancers"
      : "";
    const hashSectionId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    const sectionId = role === "venue" && hashSectionId === "venue-working-now"
      ? "venue-dancer-roster"
      : initialSectionId || hashSectionId;
    if (!sectionId || initialSectionTargetRef.current === sectionId) return;
    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById(sectionId);
      // Paused venues show account recovery before their messaging panel loads.
      if (!section) return;
      if (section instanceof HTMLDetailsElement) section.open = true;
      let parent = section.parentElement;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      section.focus({ preventScroll: true });
      initialSectionTargetRef.current = sectionId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection, isLoading, role, state.error, supportReady]);

  const updateProfile = useCallback((profile: Record<string, unknown> | null | undefined) => {
    if (!profile) return;
    setState((current) => ({ ...current, profile }));
  }, []);

  const updateAccountDetails = useCallback((account: DashboardSessionAccount) => {
    const session = readSession();
    if (!account.id || account.id !== session?.account?.id) return;
    persistDashboardSession({ ...session, account: { ...session.account, ...account } });
    setState((current) => ({ ...current, account: { ...current.account, ...account } }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refreshDeletedMedia = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (role !== "dancer" || detail?.dancerId !== state.profile?.id) return;
      void requestOptionalDashboardJson("/api/dancer/profile", { profile: null }, { signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted) updateProfile(data.profile); })
        .catch(() => {});
    };
    window.addEventListener("dancr:profile-media-deleted", refreshDeletedMedia);
    return () => {
      controller.abort();
      window.removeEventListener("dancr:profile-media-deleted", refreshDeletedMedia);
    };
  }, [role, state.profile?.id, updateProfile]);

  const updateSaved = useCallback((update: (saved: CustomerSavedState) => CustomerSavedState) => {
    setState((current) => ({ ...current, saved: update(current.saved || {}) }));
  }, []);

  const title = useMemo(() => {
    if (role === "dancer") return "Dancer dashboard";
    if (role === "venue") return "Venue dashboard";
    return "Customer dashboard";
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
    role === "customer" ? "Customer dashboard" : role === "venue" ? "Venue dashboard" : "Dancer dashboard";
  const dancerAccountPaused = role === "dancer" && state.account?.accountState === "disabled";
  const venueAccountPaused = role === "venue" && state.account?.accountState === "disabled";
  const dashboardHeading = isLoading
    ? resolvedDisplayName || title
    : role === "dancer" && (state.error || dancerAccountPaused) ? profileDisplayName || title : displayName;
  const dashboardDescription = state.error || state.accountError || "";
  const dancerProfileStatus = role === "dancer"
    ? effectiveDancerProfileStatus(state.profile, state.account?.accountState)
    : "";
  const dancerProfileIsLive = !isLoading && !state.error && Boolean(state.profile)
    && dancerProfileStatus === "approved"
    && state.profile?.is_public !== false
    && state.profile?.isPublic !== false;

  if (role === "dancer" && isLoading && !state.error) {
    return <main className="dashboard-shell dashboard-shell-dancer" aria-busy="true">
      <DashboardStyles />
      <span className="dashboard-sr-only" role="status">Loading dancer dashboard</span>
    </main>;
  }

  if (role === "venue" && state.venueRequest && !isLoading) {
    return <main className="dashboard-shell dashboard-shell-venue">
      <DashboardStyles />
      <section className="dashboard-head">
        <div className="dashboard-head-row">
          <div className="dashboard-head-copy"><span className="eyebrow">Club request</span><h1>{state.venueRequest.venueName}</h1></div>
          <DashboardCloseButton fallbackHref={dashboardCloseHref} label="Close club request" />
        </div>
      </section>
      <article className="info-panel">
        <h2>{state.venueRequest.status === "rejected" ? "Request not approved" : "Waiting for approval"}</h2>
        <p>{state.venueRequest.status === "rejected" ? "Your club request was reviewed and was not approved. Contact support if you need help with the decision." : "Your manager login is saved. We’ll email you when your club is approved. Your dashboard will unlock with this same account—no new password or access code needed."}</p>
        <div className="action-row"><button type="button" onClick={retryDashboard}>Check approval status</button><a href="#venue-support">Contact support</a></div>
      </article>
      <SupportInboxPanel initialThreads={state.supportThreads || []} panelId="venue-support" />
    </main>;
  }

  return (
    <main className={`dashboard-shell dashboard-shell-${role}`}>
      <DashboardStyles />
      <section className={`dashboard-head dashboard-head-${role}`} aria-busy={isLoading || undefined}>
        <div className="dashboard-head-row">
          {role === "dancer" ? <DancerDashboardAvatar avatarUrl={String(state.profile?.avatarPhotoUrl || "")} name={profileDisplayName} /> : null}
          {role === "customer" ? <CustomerDashboardAvatar name={dashboardHeading} /> : null}
          <div className="dashboard-head-copy">
            <span className="eyebrow">{dashboardEyebrow}</span>
            <div className="dashboard-head-title-row">
              <h1>{dashboardHeading}</h1>
              {dancerProfileIsLive ? <span className="dashboard-live-status"><i aria-hidden="true" /> Public</span> : null}
            </div>
            {dashboardDescription ? <p>{dashboardDescription}</p> : null}
            {role === "customer" && !dashboardDescription ? <p className="customer-dashboard-intro">Your favorites, plans, and updates.</p> : null}
          </div>
          <DashboardCloseButton
            fallbackHref={dashboardCloseHref}
            label={`Close ${role} dashboard and return to MyDancr`}
          />
        </div>
        {state.error && (role === "venue" || role === "dancer") ? (
          <DashboardSignInRecovery role={role} onSignedIn={retryDashboard} />
        ) : state.error || state.accountError ? (
          <div className="action-row">
            <button className="primary-link" type="button" onClick={retryDashboard}>Try again</button>
            {state.signInRequired ? <Link
              className="primary-link"
              href={`/account?role=${role}`}
            >
              Sign in
            </Link> : null}
          </div>
        ) : null}
      </section>

      {isLoading && !state.error && role !== "customer" ? (
        <DashboardLoadingState role={role} />
      ) : !state.error && (role === "customer" || !isLoading) ? (
        <section className={`dashboard-grid ${role}-dashboard-grid`}>
          {!dancerAccountPaused && !venueAccountPaused && state.agentAccess?.active ? <AgentDashboardShortcut /> : null}
          {role === "customer" ? (
            <>
              <CustomerWelcomeCard
                accountKey={String(state.account?.id || state.account?.email || "guest")}
                show={showCustomerWelcome}
              />
              <CustomerDashboardNav saved={customerSaved} />
              {state.savedError ? (
                <InfoPanel title="Saved activity">
                  <p role="alert">{state.savedError}</p>
                  <button className="primary-link" type="button" onClick={retryDashboard}>Try again</button>
                </InfoPanel>
              ) : null}
              <CustomerPanel
                saved={customerSaved}
                onSavedChange={updateSaved}
                isLoading={customerSavedLoading && !state.saved}
                accountSavedUnavailable={Boolean(state.savedError && !state.saved)}
              />
              <DashboardSection
                count={customerAlertCount}
                description="Your updates, notification preferences, and delivery options."
                id="customer-alerts"
                icon={<CustomerDashboardIcon section="customer-alerts" />}
                toggleAffordance="chevron"
                title="Alerts"
              >
                {isLoading ? <p role="status">Loading your alerts…</p> : <NotificationPanel saved={state.saved} customerMode panelId="customer-alerts-panel" onCountChange={setCustomerAlertCount} />}
                {state.profile ? <CustomerPreferencesPanel profile={state.profile} onProfileChange={updateProfile} /> : (
                  <p role="status">{state.profile === null ? "Notification preferences are unavailable right now." : "Loading your notification preferences…"}</p>
                )}
              </DashboardSection>
              <DashboardSection
                count={customerSupportCount}
                badgeLabel={`${customerSupportCount} support ${customerSupportCount === 1 ? "conversation" : "conversations"}`}
                description="Email, password, support messages, and account status."
                id="customer-account"
                icon={<CustomerDashboardIcon section="customer-account" />}
                toggleAffordance="chevron"
                title="Account"
              >
                {isLoading ? <p role="status">Loading your account…</p> : <div className="venue-dashboard-inner-grid customer-settings-grid">
                  <CustomerAccountPanel account={state.account || {}} onAccountChange={updateAccountDetails} />
                  <SupportInboxPanel initialThreads={state.supportThreads || []} panelId="customer-support" onCountChange={setCustomerSupportCount} />
                  <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
                </div>}
              </DashboardSection>
            </>
          ) : null}
          {role === "dancer" ? (
            <>
              {dancerAccountPaused ? (
                <InfoPanel title="Account paused">
                  <p>Your dancer tools are unavailable while your account is paused. Manage your account or contact support below.</p>
                </InfoPanel>
              ) : <DancerPanel
                accountState={state.account?.accountState}
                analytics={state.analytics}
                affiliations={state.affiliations || []}
                nfc={state.nfc}
                profile={state.profile}
                onProfileChange={updateProfile}
              />}
              <DashboardSection
                description="Messages, notifications, and account settings."
                defaultOpen={dancerAccountPaused}
                emphasis="utility"
                id="dancer-account"
                icon={<DancerDashboardIcon section="account" />}
                title={effectiveDancerProfileStatus(state.profile, state.account?.accountState) === "approved" ? "Account & support" : "Help & Account"}
                toggleAffordance="chevron"
              >
                <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
                  <CustomerAccountPanel account={state.account || {}} accountRole="dancer" onAccountChange={updateAccountDetails} />
                  <NotificationPanel dancerMode />
                  <SupportInboxPanel initialThreads={state.supportThreads || []} panelId="dancer-support" />
                  {dancerProfileStatus === "approved" ? <article className="info-panel dancer-agreement-panel">
                    <h2>Dancer Agreement</h2>
                    <DancerAgreementLink className="secondary-action">Read agreement</DancerAgreementLink>
                  </article> : null}
                  <AccountControlsPanel accountRole="dancer" accountState={String(state.account?.accountState || "active")} />
                </div>
              </DashboardSection>
            </>
          ) : null}
          {role === "venue" ? (
            <>
              {venueAccountPaused ? <>
                <InfoPanel title="Account paused">
                  <p>Your venue tools are unavailable while your account is paused. Manage your account or contact support below.</p>
                </InfoPanel>
                <DashboardSection defaultOpen id="venue-account" title="Account & support" description="Account status, recovery, and help from MyDancr." icon={<VenueDashboardIcon section="account" />} toggleAffordance="chevron">
                  <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
                    <AccountSummaryPanel accountState={String(state.account?.accountState)} email={String(state.account?.email || "Private")} role="venue" />
                    {state.supportThreads ? <SupportInboxPanel initialThreads={state.supportThreads} panelId="venue-support" /> : <p role="status">Loading support…</p>}
                    <AccountControlsPanel accountRole="venue" accountState={String(state.account?.accountState)} />
                  </div>
                </DashboardSection>
              </> : <VenuePanel
                  account={state.account || null}
                  analytics={state.analytics}
                  deal={state.deal}
                   venueDeals={state.venueDeals || []}
                   dealRequests={state.dealRequests || []}
                  profile={state.profile}
                  workingNow={state.workingNow || []}
                  initialAffiliations={state.affiliations || []}
                  venueAccess={state.venueAccess || null}
                  refreshedAt={state.refreshedAt || null}
                  supportThreads={state.supportThreads || []}
                  analyticsPeriod={analyticsPeriod}
                  isRefreshing={isVenueRefreshing}
                  refreshStatus={venueRefreshStatus}
                  onAnalyticsPeriodChange={setAnalyticsPeriod}
                  onRefresh={() => void refreshVenueDashboard(true)}
                  onCheckInEnded={(shiftId) => {
                    venueRefreshAbortRef.current?.abort();
                    venueRefreshRequestRef.current += 1;
                    setIsVenueRefreshing(false);
                    setState((current) => ({
                      ...current,
                      workingNow: (current.workingNow || []).filter((shift) => shift.shiftId !== shiftId),
                    }));
                    void refreshVenueDashboard(false);
                  }}
                  onAccessRemoved={(affiliation) => {
                    venueRefreshAbortRef.current?.abort();
                    venueRefreshRequestRef.current += 1;
                    setIsVenueRefreshing(false);
                    setState((current) => ({
                      ...current,
                      affiliations: (current.affiliations || []).map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item),
                      workingNow: (current.workingNow || []).filter((shift) => !isAffiliatedDancerWorkingNow(affiliation, [shift])),
                    }));
                    void refreshVenueDashboard(false);
                  }}
                  onProfileChange={updateProfile}
                   onPublicationChange={(publication) => setState((current) => ({ ...current, publication }))}
                   onDealRequestsChange={(dealRequests) => setState((current) => ({ ...current, dealRequests }))}
                />}
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
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
  const mountedRef = useRef(false);
  const signInSequenceRef = useRef(0);
  const signInAbortRef = useRef<AbortController | null>(null);
  const signInInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      signInSequenceRef.current += 1;
      signInAbortRef.current?.abort();
      signInAbortRef.current = null;
      signInInFlightRef.current = false;
    };
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mountedRef.current || signInInFlightRef.current) return;
    const isSessionUnchanged = captureBrowserAuthSessionGuard();

    signInInFlightRef.current = true;
    const requestId = ++signInSequenceRef.current;
    signInAbortRef.current?.abort();
    const controller = new AbortController();
    signInAbortRef.current = controller;
    setIsSubmitting(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "login", role, email: email.trim(), password }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!mountedRef.current || controller.signal.aborted || requestId !== signInSequenceRef.current) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (data.account?.role !== role || !data.session?.accessToken || !data.session?.refreshToken) {
        throw new Error(`Use a ${role} account to open this dashboard.`);
      }

      if (!isSessionUnchanged()) throw new Error("Your sign-in changed in another window. Please try again if you still want to switch accounts.");
      if (!persistDashboardSession({ ...data.session, account: data.account })) {
        throw new Error("Unable to save your dashboard session in this browser.");
      }
      setStatus(`Signed in. Opening your ${role} dashboard...`);
      onSignedIn();
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted && requestId === signInSequenceRef.current) {
        setStatus(error instanceof Error ? error.message : "Unable to sign in.");
      }
    } finally {
      if (requestId === signInSequenceRef.current) {
        signInAbortRef.current = null;
        signInInFlightRef.current = false;
        if (mountedRef.current) setIsSubmitting(false);
      }
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
          disabled={isSubmitting}
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <PasswordField
        label="Password"
        autoComplete="current-password"
        disabled={isSubmitting}
        onChange={(event) => setPassword(event.target.value)}
        required
        value={password}
      />
      <button className="primary-link" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Signing in..." : `Sign in to ${role} dashboard`}
      </button>
      {status ? <p className="venue-sign-in-status" role="status">{status}</p> : null}
    </form>
  );
}
