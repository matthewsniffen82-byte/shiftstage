"use client";

import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import {
  CLUB_DEAL_OFFER_PRESETS,
  defaultClubDealOfferPreset,
} from "@/src/lib/dancr/club-deal-presets";
import type { AdminOperationsCenter } from "@/src/lib/dancr/admin-operations";
import type { AdminDancerRosterItem, AdminDancerRosterResult } from "@/src/lib/dancr/admin-dancers";
import AdminDmcaPanel from "./AdminDmcaPanel";
import AdminNfcInventoryPanel from "./AdminNfcInventoryPanel";
import AdminPilotAnalytics from "./AdminPilotAnalytics";
import AdminSalesAgentPanel from "./AdminSalesAgentPanel";
import AdminTvPanel from "./AdminTvPanel";
import {
  clearAdminSession,
  isAdminAuthenticationError,
  persistAdminSession,
  readAdminAccessToken as readToken,
  readAdminJson as readJson,
  requestAdminJson,
} from "./admin-session";

type AdminState = {
  monitoring?: Record<string, unknown> | null;
  queue?: Array<Record<string, unknown>>;
  dancerTotal?: number;
  venues?: Array<Record<string, unknown>>;
  venueClaimCodes?: Array<Record<string, unknown>>;
  venueSignupRequests?: Array<Record<string, unknown>>;
  subscriptions?: unknown[];
  reports?: Array<Record<string, unknown>>;
  deals?: Array<Record<string, unknown>>;
  clubDeals?: Array<Record<string, unknown>>;
  dealRequests?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  imageModeration?: Array<Record<string, unknown>>;
  operations?: AdminOperationsCenter | null;
  finance?: Record<string, unknown> | null;
  referralFees?: Record<string, unknown> | null;
  authRequired?: boolean;
  warnings?: string[];
  error?: string;
};

type AdminActionNotice = {
  id: number;
  message: string;
};

const OPEN_APPROVALS_SESSION_KEY = "dancrAdminOpenApprovalsV1";
type AdminWorkspace = "home" | "approvals" | "people" | "clubs" | "money" | "more";

const ADMIN_WORKSPACES: Array<{ id: AdminWorkspace; label: string }> = [
  { id: "home", label: "Home" },
  { id: "approvals", label: "Approvals" },
  { id: "people", label: "People" },
  { id: "clubs", label: "Clubs" },
  { id: "money", label: "Money" },
  { id: "more", label: "More" },
];

type AdminDataSection = {
  label: string;
  path: string;
  apply: (data: any) => Partial<AdminState>;
};

function adminSectionsForWorkspace(workspace: AdminWorkspace): AdminDataSection[] {
  if (workspace === "home") {
    return [
      { label: "Monitoring", path: "/api/admin/monitoring", apply: (data) => ({ monitoring: data.monitoring }) },
      { label: "Live operations", path: "/api/admin/operations", apply: (data) => ({ operations: data.operations }) },
    ];
  }
  if (workspace === "approvals") {
    return [
      {
        label: "Dancer approvals",
        path: "/api/admin/approvals",
        apply: (data) => ({ queue: data.queue || [], dancerTotal: Number(data.dancerTotal || 0) }),
      },
      {
        label: "Image moderation",
        path: "/api/admin/image-moderation?decision=review",
        apply: (data) => ({ imageModeration: data.records || [] }),
      },
      { label: "Reports", path: "/api/admin/reports", apply: (data) => ({ reports: data.reports || [] }) },
    ];
  }
  if (workspace === "people") {
    return [
      {
        label: "Subscriptions",
        path: "/api/admin/subscriptions",
        apply: (data) => ({ subscriptions: data.subscriptions || [] }),
      },
    ];
  }
  if (workspace === "clubs") {
    return [
      {
        label: "Venues",
        path: "/api/admin/venues",
        apply: (data) => ({ venues: data.venues || [], venueClaimCodes: data.claimCodes || [] }),
      },
      {
        label: "Venue signup requests",
        path: "/api/admin/venue-signup-requests",
        apply: (data) => ({ venueSignupRequests: data.requests || [] }),
      },
      {
        label: "Club Deals",
        path: "/api/admin/deals",
        apply: (data) => ({ deals: data.activity || [], clubDeals: data.clubDeals || [], dealRequests: data.dealRequests || [] }),
      },
      {
        label: "Referral fee agreements",
        path: "/api/admin/referral-fees",
        apply: (data) => ({ referralFees: data.referralFees }),
      },
    ];
  }
  if (workspace === "money") {
    return [
      { label: "QR finance", path: "/api/admin/finance", apply: (data) => ({ finance: data.finance }) },
      {
        label: "Referral fee agreements",
        path: "/api/admin/referral-fees",
        apply: (data) => ({ referralFees: data.referralFees }),
      },
      {
        label: "Deal activity",
        path: "/api/admin/deals",
        apply: (data) => ({ deals: data.activity || [], clubDeals: data.clubDeals || [], dealRequests: data.dealRequests || [] }),
      },
      {
        label: "Venues",
        path: "/api/admin/venues",
        apply: (data) => ({ venues: data.venues || [], venueClaimCodes: data.claimCodes || [] }),
      },
    ];
  }
  return [
    { label: "Support inbox", path: "/api/admin/support", apply: (data) => ({ supportThreads: data.threads || [] }) },
  ];
}

export default function AdminClient() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [state, setState] = useState<AdminState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [actionNotice, setActionNotice] = useState<AdminActionNotice | null>(null);
  const [openApprovalIds, setOpenApprovalIds] = useState<Record<string, boolean>>({});
  const [workspace, setWorkspace] = useState<AdminWorkspace>("home");
  const [loadedWorkspaces, setLoadedWorkspaces] = useState<Partial<Record<AdminWorkspace, boolean>>>({});
  const [loadingWorkspace, setLoadingWorkspace] = useState<AdminWorkspace | null>(null);
  const openApprovalIdsRef = useRef<Record<string, boolean>>({});
  const pendingWorkspaceLoadsRef = useRef<Set<AdminWorkspace>>(new Set());

  useEffect(() => {
    loadAdmin();
  }, []);

  useEffect(() => {
    const persistedOpenApprovals = readPersistedOpenApprovals();
    openApprovalIdsRef.current = persistedOpenApprovals;
    setOpenApprovalIds(persistedOpenApprovals);
  }, []);

  useEffect(() => {
    if (!actionNotice) return;
    const timeout = window.setTimeout(() => {
      setActionNotice((current) => (current?.id === actionNotice.id ? null : current));
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [actionNotice]);

  function confirmAdminAction(message: string) {
    setActionNotice({ id: Date.now(), message });
  }

  function openWorkspace(nextWorkspace: AdminWorkspace) {
    setWorkspace(nextWorkspace);
    void loadWorkspaceData(nextWorkspace);
    window.requestAnimationFrame(() => {
      document.querySelector(".admin-workspace-nav")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function setApprovalOpen(dancerId: string, open: boolean) {
    if (!dancerId || Boolean(openApprovalIdsRef.current[dancerId]) === open) return;
    const next = { ...openApprovalIdsRef.current };
    if (open) next[dancerId] = true;
    else delete next[dancerId];
    openApprovalIdsRef.current = next;
    persistOpenApprovals(next);
    setOpenApprovalIds(next);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setState({});

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, role: "admin", username, password, adminCode }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (!data.session?.accessToken) throw new Error("Admin sign in requires a live session.");

      persistAdminSession(data.session, data.account);
      await loadAdmin();
    } catch (error) {
      setState({
        authRequired: true,
        error: error instanceof Error ? error.message : "Unable to sign in.",
      });
    } finally {
      setIsSigningIn(false);
    }
  }

  async function sendPasswordReset() {
    if (!username.trim()) {
      setState({ authRequired: true, error: "Enter your admin username first, then tap Forgot password." });
      return;
    }

    setIsResettingPassword(true);
    setState({});

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "reset_password",
          role: "admin",
          username,
          emailRedirectTo:
            typeof window === "undefined"
              ? undefined
              : `${window.location.origin}/auth/callback?dancr_reset=1&role=admin&return_to=${encodeURIComponent("/admin")}`,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to send reset email.");
      setState({
        authRequired: true,
        error: "Password reset email sent. Open the newest Mydancr email to continue.",
      });
    } catch (error) {
      setState({
        authRequired: true,
        error: error instanceof Error ? error.message : "Unable to send reset email.",
      });
    } finally {
      setIsResettingPassword(false);
    }
  }

  function signOut() {
    setIsSigningOut(true);
    clearAdminSession();
    window.sessionStorage.removeItem(OPEN_APPROVALS_SESSION_KEY);
    openApprovalIdsRef.current = {};
    setOpenApprovalIds({});
    setUsername("");
    setPassword("");
    setAdminCode("");
    setShowPassword(false);
    setWorkspace("home");
    setLoadedWorkspaces({});
    setLoadingWorkspace(null);
    pendingWorkspaceLoadsRef.current.clear();
    setActionNotice(null);
    setState({ authRequired: true, error: "Admin session ended. Sign in to continue." });
    setIsSigningOut(false);
  }

  async function loadWorkspaceData(nextWorkspace: AdminWorkspace) {
    if (nextWorkspace === "home" || loadedWorkspaces[nextWorkspace] || pendingWorkspaceLoadsRef.current.has(nextWorkspace)) return;
    const token = readToken();
    if (!token) {
      clearAdminSession();
      setState({ authRequired: true, error: "Admin sign in required." });
      return;
    }

    const sections = adminSectionsForWorkspace(nextWorkspace);
    pendingWorkspaceLoadsRef.current.add(nextWorkspace);
    setLoadingWorkspace(nextWorkspace);

    try {
      const headers = { authorization: `Bearer ${token}` };
      const results = await Promise.allSettled(sections.map((section) => readJson(section.path, headers)));
      const authenticationFailure = results.find(
        (result) => result.status === "rejected" && isAdminAuthenticationError(result.reason),
      );
      if (authenticationFailure?.status === "rejected") {
        clearAdminSession();
        setState({
          authRequired: true,
          error: authenticationFailure.reason instanceof Error
            ? authenticationFailure.reason.message
            : "Admin sign in required.",
        });
        return;
      }

      const update: Partial<AdminState> = { authRequired: false };
      const warnings: string[] = [];
      results.forEach((result, index) => {
        const section = sections[index];
        if (result.status === "fulfilled") {
          Object.assign(update, section.apply(result.value));
          return;
        }
        warnings.push(`${section.label}: ${result.reason instanceof Error ? result.reason.message : "This section could not be loaded."}`);
      });

      setState((current) => ({
        ...current,
        ...update,
        warnings: [
          ...(current.warnings || []).filter((warning) => !sections.some((section) => warning.startsWith(`${section.label}:`))),
          ...warnings,
        ],
      }));
      setLoadedWorkspaces((current) => ({ ...current, [nextWorkspace]: true }));
    } catch (error) {
      setState((current) => ({
        ...current,
        warnings: [
          ...(current.warnings || []).filter((warning) => !warning.startsWith(`${labelize(nextWorkspace)}:`)),
          `${labelize(nextWorkspace)}: ${error instanceof Error ? error.message : "Unable to load this workspace."}`,
        ],
      }));
      setLoadedWorkspaces((current) => ({ ...current, [nextWorkspace]: true }));
    } finally {
      pendingWorkspaceLoadsRef.current.delete(nextWorkspace);
      setLoadingWorkspace((current) => (current === nextWorkspace ? null : current));
    }
  }

  async function loadAdmin() {
    setIsLoading(true);
    setWorkspace("home");
    setLoadedWorkspaces({});
    setLoadingWorkspace(null);
    pendingWorkspaceLoadsRef.current.clear();
    const token = readToken();
    if (!token) {
      setState({ authRequired: true, error: "Admin sign in required." });
      setIsLoading(false);
      return;
    }

    try {
      const headers = { authorization: `Bearer ${token}` };
      const sections = adminSectionsForWorkspace("home");
      const results = await Promise.allSettled(
        sections.map((section) => readJson(section.path, headers)),
      );
      const authenticationFailure = results.find(
        (result) => result.status === "rejected" && isAdminAuthenticationError(result.reason),
      );

      if (authenticationFailure?.status === "rejected") {
        clearAdminSession();
        setState({
          authRequired: true,
          error: authenticationFailure.reason instanceof Error
            ? authenticationFailure.reason.message
            : "Admin sign in required.",
        });
        return;
      }

      const nextState: AdminState = {
        authRequired: false,
        monitoring: null,
        operations: null,
        finance: null,
        referralFees: null,
        queue: [],
        dancerTotal: 0,
        venues: [],
        venueClaimCodes: [],
        venueSignupRequests: [],
        subscriptions: [],
        deals: [],
        clubDeals: [],
        dealRequests: [],
        supportThreads: [],
        imageModeration: [],
        reports: [],
      };
      const warnings: string[] = [];

      results.forEach((result, index) => {
        const section = sections[index];
        if (result.status === "fulfilled") {
          Object.assign(nextState, section.apply(result.value));
          return;
        }

        const message = result.reason instanceof Error
          ? result.reason.message
          : "This section could not be loaded.";
        warnings.push(`${section.label}: ${message}`);
      });

      nextState.warnings = warnings;
      setState(nextState);
      setLoadedWorkspaces({ home: true });
    } catch (error) {
      setState({
        authRequired: false,
        warnings: [error instanceof Error ? error.message : "Unable to load admin dashboard."],
      });
    } finally {
      setIsLoading(false);
    }
  }

  const needsSignIn = state.authRequired === true;
  const dashboardWarnings = state.warnings || [];
  const pendingDancerApprovalCount = state.queue?.length || 0;
  const dashboardDescription = isLoading
    ? "Loading live operations..."
    : needsSignIn
      ? state.error || "Admin sign in required."
      : dashboardWarnings.length
        ? `${dashboardWarnings.length} dashboard ${dashboardWarnings.length === 1 ? "section is" : "sections are"} temporarily unavailable. All other admin tools are ready.`
        : "Live approvals, revenue, accounts, activity, and platform health.";

  return (
    <main className="admin-shell dashboard-shell-admin">
      <AdminStyles />
      {actionNotice ? (
        <div className="admin-action-toast" role="status" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">✓</span>
          <strong>{actionNotice.message}</strong>
          <button type="button" aria-label="Dismiss confirmation" onClick={() => setActionNotice(null)}>×</button>
        </div>
      ) : null}
      <section className="dashboard-head admin-dashboard-head" aria-busy={isLoading || undefined}>
        <div className="dashboard-head-row">
          <div className="dashboard-head-copy">
            <span className="eyebrow">Platform operations</span>
            <h1>Admin dashboard</h1>
            <p>{dashboardDescription}</p>
          </div>
          <DashboardCloseButton
            fallbackHref={homeDiscoveryHref("tonight")}
            label="Close admin dashboard and return to MyDancr"
          />
        </div>
        {!isLoading && !needsSignIn ? (
          <div className="admin-dashboard-session">
            <span><i aria-hidden="true" />Admin session active</span>
            <button className="admin-logout" type="button" onClick={signOut} disabled={isSigningOut}>
              {isSigningOut ? "Logging out..." : "Log out"}
            </button>
          </div>
        ) : null}
      </section>

      {isLoading ? (
        <AdminDashboardLoadingState />
      ) : needsSignIn ? (
        <form className="admin-panel sign-in" onSubmit={signIn}>
          <div className="segmented" aria-label="Admin auth mode">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>
              Sign in
            </button>
            <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => setMode("signup")}>
              Create
            </button>
          </div>
          <label>
            Admin username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <span className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                type="button"
                onClick={() => setShowPassword((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </span>
          </label>
          {mode === "signup" ? (
            <label>
              Admin code
              <input
                type="password"
                value={adminCode}
                onChange={(event) => setAdminCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
          ) : null}
          {mode === "login" ? (
            <button className="forgot-password" type="button" onClick={sendPasswordReset} disabled={isResettingPassword}>
              {isResettingPassword ? "Sending reset email..." : "Forgot password?"}
            </button>
          ) : null}
          <button type="submit" disabled={isSigningIn}>
            {isSigningIn ? "Working..." : mode === "signup" ? "Create admin account" : "Sign in"}
          </button>
        </form>
      ) : (
        <>
          {dashboardWarnings.length ? (
            <aside className="admin-warning" role="status" aria-live="polite">
              <div>
                <strong>Some admin data needs attention.</strong>
                <ul>
                  {dashboardWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
              <button type="button" onClick={() => loadAdmin()}>Retry unavailable sections</button>
            </aside>
          ) : null}
          <nav className="admin-workspace-nav" aria-label="Admin workspaces">
            {ADMIN_WORKSPACES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={workspace === item.id ? "active" : ""}
                aria-current={workspace === item.id ? "page" : undefined}
                onClick={() => openWorkspace(item.id)}
              >
                {item.label}
                {item.id === "approvals" && state.operations?.attention.total
                  ? <span>{state.operations.attention.total}</span>
                  : null}
              </button>
            ))}
          </nav>
          {workspace === "home" ? (
            <>
              <OperationsOverview
                operations={state.operations || null}
                monitoring={state.monitoring || null}
                onOpenWorkspace={openWorkspace}
              />
              <ActivityTimeline operations={state.operations || null} />
            </>
          ) : null}

          {workspace !== "home" && loadingWorkspace === workspace && !loadedWorkspaces[workspace]
            ? <AdminWorkspaceLoadingState workspace={workspace} />
            : null}

          {workspace === "approvals" && loadedWorkspaces.approvals ? (
            <>
              <WorkspaceHeader
                eyebrow="Review queues"
                title="Approvals"
                description="Review profiles, media, safety reports, and TV submissions from one focused queue. Open a record only when you are ready to act."
              />
              <section className="admin-grid">
                <Panel
                  title="Dancer approvals"
                  badge={`${pendingDancerApprovalCount} needed`}
                  defaultOpen
                >
                  <Metric label="Dancers needing approval" value={String(pendingDancerApprovalCount)} />
                  <Metric label="Profiles in roster" value={String(state.dancerTotal || 0)} />
                  <ApprovalQueue
                    items={state.queue || []}
                    openById={openApprovalIds}
                    onToggleOpen={(dancerId) =>
                      setApprovalOpen(dancerId, !Boolean(openApprovalIdsRef.current[dancerId]))
                    }
                    onKeepOpen={(dancerId) => setApprovalOpen(dancerId, true)}
                    onSocialReviewed={(dancerId, targetId, status, notes) =>
                      setState((current) => ({
                        ...current,
                        queue: (current.queue || []).map((item) =>
                          asText(item.id) === dancerId
                            ? withReviewedSocial(item, targetId, status, notes)
                            : item
                        ),
                      }))
                    }
                    onProfileUpdated={(profile) =>
                      setState((current) => ({
                        ...current,
                        queue: (current.queue || []).map((item) =>
                          asText(item.id) === asText(profile.id) ? { ...item, ...profile } : item
                        ),
                      }))
                    }
                    onActionConfirmed={confirmAdminAction}
                    onReviewed={(dancerId) => {
                      setState((current) => ({
                        ...current,
                        queue: (current.queue || []).filter((item) => String(item.id) !== dancerId),
                      }));
                      setApprovalOpen(dancerId, false);
                    }}
                  />
                </Panel>
                <Panel title="Reports" badge={`${state.reports?.length || 0} open`}>
                  <ReportManager
                    reports={state.reports || []}
                    onReportsChange={(reports) => setState((current) => ({ ...current, reports }))}
                  />
                </Panel>
                <Panel
                  title="Image moderation"
                  badge={`${state.imageModeration?.filter((item) => String(item.decision) === "review").length || 0} to review`}
                >
                  <ImageModerationQueue
                    records={state.imageModeration || []}
                    onRecordsChange={(imageModeration) => setState((current) => ({ ...current, imageModeration }))}
                    onActionConfirmed={confirmAdminAction}
                  />
                </Panel>
                <Panel title="MyDancr TV moderation">
                  <AdminTvPanel />
                </Panel>
              </section>
            </>
          ) : null}

          {workspace === "people" && loadedWorkspaces.people ? (
            <>
              <WorkspaceHeader
                eyebrow="Accounts"
                title="People"
                description="Find dancers, customers, agents, and admins. Open a person to see their complete record and available actions."
              />
              <AccountOverview operations={state.operations || null} />
              <section className="admin-grid">
                <Panel title="Dancer management" badge={`${state.dancerTotal || 0} profiles`} defaultOpen>
                  <DancerDirectory
                    onActionConfirmed={confirmAdminAction}
                    onProfileUpdated={(profile) => {
                      setState((current) => ({
                        ...current,
                        queue: (current.queue || []).map((item) =>
                          asText(item.id) === asText(profile.id) ? { ...item, ...profile } : item
                        ),
                      }));
                    }}
                    onDeleted={(dancerId) => {
                      setState((current) => ({
                        ...current,
                        queue: (current.queue || []).filter((item) => asText(item.id) !== dancerId),
                        dancerTotal: Math.max(0, Number(current.dancerTotal || 0) - 1),
                      }));
                      setApprovalOpen(dancerId, false);
                    }}
                  />
                </Panel>
                <Panel title="Customer subscriptions" badge={`${state.subscriptions?.length || 0} tracked`}>
                  <ListPreview items={state.subscriptions} empty="No customer subscriptions returned." />
                </Panel>
              </section>
              <AdminSalesAgentPanel onActionConfirmed={confirmAdminAction} />
            </>
          ) : null}

          {workspace === "clubs" && loadedWorkspaces.clubs ? (
            <>
              <WorkspaceHeader
                eyebrow="Venue operations"
                title="Clubs"
                description="Manage club accounts, signup requests, dancer affiliations, published deals, and MyDancr-programmed NFC inventory."
              />
              <section className="admin-grid">
                <Panel title="Club accounts" badge={`${state.venues?.length || 0} managed`} defaultOpen>
                  <VenueSignupRequestQueue
                    requests={state.venueSignupRequests || []}
                    venues={state.venues || []}
                    onRequestsChange={(venueSignupRequests) => setState((current) => ({ ...current, venueSignupRequests }))}
                    onVenuesChange={(venues) => setState((current) => ({ ...current, venues }))}
                    onClaimCodesChange={(venueClaimCodes) => setState((current) => ({ ...current, venueClaimCodes }))}
                    claimCodes={state.venueClaimCodes || []}
                    onActionConfirmed={confirmAdminAction}
                  />
                  <VenueManager
                    venues={state.venues || []}
                    claimCodes={state.venueClaimCodes || []}
                    onVenuesChange={(venues) => setState((current) => ({ ...current, venues }))}
                    onClaimCodesChange={(venueClaimCodes) => setState((current) => ({ ...current, venueClaimCodes }))}
                  />
                </Panel>
                <Panel title="NFC sticker inventory">
                  <AdminNfcInventoryPanel />
                </Panel>
              </section>
              <AdminClubDealManager
                venues={state.venues || []}
                clubDeals={state.clubDeals || []}
                dealRequests={state.dealRequests || []}
                referralFees={state.referralFees || null}
                onClubDealsChange={(clubDeals) => setState((current) => ({ ...current, clubDeals }))}
                onDealRequestsChange={(dealRequests) => setState((current) => ({ ...current, dealRequests }))}
                onActionConfirmed={confirmAdminAction}
              />
            </>
          ) : null}

          {workspace === "money" && loadedWorkspaces.money ? (
            <>
              <WorkspaceHeader
                eyebrow="Financial operations"
                title="Money"
                description="Review referral fees, club receivables, dancer commissions, settlements, reversals, and payout status."
              />
              <FinanceManager
                finance={state.finance || null}
                onFinanceChange={(finance) => setState((current) => ({ ...current, finance }))}
                onActionConfirmed={confirmAdminAction}
              />
              <ReferralFeeManager
                venues={state.venues || []}
                referralFees={state.referralFees || null}
                onReferralFeesChange={(referralFees) => setState((current) => ({ ...current, referralFees }))}
                onActionConfirmed={confirmAdminAction}
              />
              <section className="admin-grid">
                <Panel title="Deal attribution" badge={`${state.deals?.length || 0} redemptions`}>
                  <DealActivityManager
                    activity={state.deals || []}
                    onActivityChange={(deals) => setState((current) => ({ ...current, deals }))}
                  />
                </Panel>
              </section>
            </>
          ) : null}

          {workspace === "more" && loadedWorkspaces.more ? (
            <>
              <WorkspaceHeader
                eyebrow="Platform tools"
                title="More"
                description="Open infrequent operational tools only when needed: support, legal requests, pilot analytics, rankings, and system status."
              />
              <section className="admin-grid">
                <Panel title="Support Inbox" badge={`${state.supportThreads?.filter((thread) => String(thread.status) === "open").length || 0} open`} defaultOpen>
                  <AdminSupportInbox
                    threads={state.supportThreads || []}
                    onThreadsChange={(supportThreads) => setState((current) => ({ ...current, supportThreads }))}
                  />
                </Panel>
                <Panel title="Copyright / DMCA">
                  <AdminDmcaPanel />
                </Panel>
                <Panel title="Monitoring">
                  {Object.entries(state.monitoring || {}).slice(0, 6).map(([key, value]) => (
                    <Metric key={key} label={labelize(key)} value={formatValue(value)} />
                  ))}
                  {!state.monitoring ? <Metric label="Status" value="Ready" /> : null}
                </Panel>
                <Panel title="Rankings">
                  <RankingManager />
                </Panel>
              </section>
              <AdminPilotAnalytics
                venues={state.venues || []}
                onActionConfirmed={confirmAdminAction}
              />
            </>
          ) : null}
        </>
      )}
    </main>
  );
}

function AdminDashboardLoadingState() {
  return (
    <section className="admin-dashboard-loading" aria-busy="true" aria-label="Loading admin dashboard">
      <span className="dashboard-sr-only">Loading admin dashboard</span>
      <div className="admin-dashboard-loading-command">
        <span className="admin-dashboard-loading-pill" />
        <div className="admin-dashboard-loading-copy">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="admin-dashboard-loading-actions">
        <span />
        <span />
      </div>
      <div className="admin-dashboard-loading-metrics">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function AdminWorkspaceLoadingState({ workspace }: { workspace: AdminWorkspace }) {
  return (
    <section className="admin-workspace-loading" aria-busy="true" aria-live="polite">
      <span className="dashboard-sr-only">Loading {labelize(workspace)} workspace</span>
      <header>
        <span className="admin-workspace-loading-line wide" />
        <span className="admin-workspace-loading-line" />
      </header>
      <div>
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function applyFinanceMutationResponse(
  data: Record<string, unknown>,
  onFinanceChange: (finance: Record<string, unknown>) => void,
  successMessage: string,
) {
  const finance = data.finance;
  if (finance && typeof finance === "object" && !Array.isArray(finance)) {
    onFinanceChange(finance as Record<string, unknown>);
  }
  return data.financeRefreshRequired === true
    ? `${successMessage} Refresh dashboard totals to display the latest balances.`
    : successMessage;
}

function FinanceManager({
  finance,
  onFinanceChange,
  onActionConfirmed,
}: {
  finance: Record<string, unknown> | null;
  onFinanceChange: (finance: Record<string, unknown>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [paymentTotal, setPaymentTotal] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const metrics = (finance?.metrics || {}) as Record<string, unknown>;
  const invoices = Array.isArray(finance?.invoices) ? finance.invoices as Array<Record<string, unknown>> : [];
  const payouts = Array.isArray(finance?.payouts) ? finance.payouts as Array<Record<string, unknown>> : [];
  const earnings = Array.isArray(finance?.earnings) ? finance.earnings as Array<Record<string, unknown>> : [];
  const earningsByVenue = Array.isArray(finance?.earningsByVenue) ? finance.earningsByVenue as Array<Record<string, unknown>> : [];
  const earningsByDancer = Array.isArray(finance?.earningsByDancer) ? finance.earningsByDancer as Array<Record<string, unknown>> : [];
  const payoutSettings = (finance?.settings || {}) as Record<string, unknown>;
  const nats = (finance?.nats || {}) as Record<string, unknown>;
  const natsAccounts = Array.isArray(nats.accounts) ? nats.accounts as Array<Record<string, unknown>> : [];
  const natsExports = Array.isArray(nats.exports) ? nats.exports as Array<Record<string, unknown>> : [];
  const natsSelected = nats.selected === true;
  const [provider, setProvider] = useState("stripe");
  const [payoutMode, setPayoutMode] = useState("manual_cashout");
  const [holdDays, setHoldDays] = useState("7");
  const [minimumPayout, setMinimumPayout] = useState("20.00");
  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  useEffect(() => {
    setProvider(asText(payoutSettings.payment_provider) || "stripe");
    setPayoutMode(asText(payoutSettings.payout_mode) || "manual_cashout");
    setHoldDays(String(payoutSettings.earnings_hold_days ?? 7));
    setMinimumPayout((Number(payoutSettings.minimum_payout_cents || 2000) / 100).toFixed(2));
    setPayoutsEnabled(payoutSettings.payouts_enabled === true);
  }, [payoutSettings.payment_provider, payoutSettings.payout_mode, payoutSettings.earnings_hold_days, payoutSettings.minimum_payout_cents, payoutSettings.payouts_enabled]);
  const openInvoices = invoices.filter((invoice) => ["open", "overdue"].includes(asText(invoice.status)));

  async function runAction(action: "run_automation" | "process_payouts") {
    setIsRunning(true);
    setStatus(action === "run_automation" ? "Reconciling club invoices and dancer payouts..." : "Processing payable dancer commissions...");
    try {
      const data = await requestAdminJson("/api/admin/finance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        fallbackMessage: "Finance operation failed.",
      });
      const errors = Array.isArray(data.result?.errors) ? data.result.errors.length : 0;
      const baseMessage = errors ? `Finance run completed with ${errors} item requiring attention.` : "Finance reconciliation completed.";
      const message = applyFinanceMutationResponse(data, onFinanceChange, baseMessage);
      setStatus(message);
      onActionConfirmed(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Finance operation failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalPaidCents = Math.round(Number(paymentTotal) * 100);
    if (!invoiceId || !Number.isInteger(totalPaidCents) || totalPaidCents <= 0 || !paymentReference.trim()) {
      return setStatus("Choose an invoice and enter the cumulative paid total plus a bank or check reference.");
    }
    setIsRunning(true);
    setStatus("Reconciling external payment...");
    try {
      const data = await requestAdminJson("/api/admin/finance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "record_manual_payment", invoiceId, totalPaidCents, reference: paymentReference.trim() }),
        fallbackMessage: "Unable to record payment.",
      });
      const message = applyFinanceMutationResponse(data, onFinanceChange, "External club payment reconciled.");
      setInvoiceId("");
      setPaymentTotal("");
      setPaymentReference("");
      setStatus(message);
      onActionConfirmed(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to record payment.");
    } finally {
      setIsRunning(false);
    }
  }

  async function savePayoutSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const minimumPayoutCents = adminPayoutDollarsToCents(minimumPayout);
    if (minimumPayoutCents === null) return setStatus("Enter a valid minimum payout between $0.01 and $100,000.00.");
    setIsRunning(true);
    setStatus("Saving audited payout settings...");
    try {
      const data = await requestAdminJson("/api/admin/finance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update_payout_settings", payoutsEnabled, paymentProvider: provider, payoutMode, earningsHoldDays: Number(holdDays), minimumPayoutCents }),
        fallbackMessage: "Unable to save payout settings.",
      });
      setStatus(applyFinanceMutationResponse(data, onFinanceChange, "Payout settings saved and audited."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save payout settings.");
    } finally { setIsRunning(false); }
  }

  async function manageEarning(earningId: string, earningAction: "hold" | "release" | "reverse") {
    const reason = window.prompt(`Required audit reason to ${earningAction} this earning:`)?.trim();
    if (!reason) return;
    setIsRunning(true);
    try {
      const data = await requestAdminJson("/api/admin/finance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "manage_earning", earningId, earningAction, reason }),
        fallbackMessage: "Unable to update earning.",
      });
      setStatus(applyFinanceMutationResponse(data, onFinanceChange, `Earning ${earningAction} action recorded.`));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to update earning."); }
    finally { setIsRunning(false); }
  }

  async function retryPayout(payoutId: string) {
    const reason = window.prompt("Required audit reason to retry this failed payout:")?.trim();
    if (!reason) return;
    setIsRunning(true);
    try {
      const data = await requestAdminJson("/api/admin/finance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry_payout", payoutId, reason }),
        fallbackMessage: "Unable to retry payout.",
      });
      setStatus(applyFinanceMutationResponse(data, onFinanceChange, "Safe payout retry reserved for processing."));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to retry payout."); }
    finally { setIsRunning(false); }
  }

  async function manageNats(action: "verify_nats_affiliate" | "disable_nats_affiliate" | "retry_nats_export" | "reconcile_nats_export", targetId: string, resolution?: "confirmed_exported" | "confirmed_not_exported") {
    const promptLabel = action === "verify_nats_affiliate"
      ? "Confirm you matched this login ID to the correct dancer in NATS. Enter an audit note:"
      : action === "reconcile_nats_export"
        ? "Confirm you checked the affiliate's manual invoices in NATS. Enter an audit note:"
        : "Enter the required audit reason:";
    const reason = window.prompt(promptLabel)?.trim();
    if (!reason) return;
    setIsRunning(true);
    setStatus("Updating the NATS commission ledger...");
    try {
      const data = await requestAdminJson("/api/admin/finance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action.includes("affiliate") ? { dancerId: targetId } : { exportId: targetId }),
          ...(resolution ? { resolution } : {}),
          reason,
        }),
        fallbackMessage: "Unable to update the NATS commission ledger.",
      });
      const message = applyFinanceMutationResponse(data, onFinanceChange, "NATS commission ledger updated.");
      setStatus(message);
      onActionConfirmed(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update the NATS commission ledger.");
    } finally {
      setIsRunning(false);
    }
  }
  return (
    <section className="operations-center" aria-labelledby="finance-operations-heading">
      <Panel title="QR finance operations">
        <span className="eyebrow">Receivables and payouts</span>
        <h2 id="finance-operations-heading">Commission settlement</h2>
        <div className="operations-metrics">
          <Metric label="Club receivables" value={formatAdminCents(Number(metrics.outstandingReceivablesCents || 0))} />
          <Metric label="Overdue" value={formatAdminCents(Number(metrics.overdueReceivablesCents || 0))} />
          <Metric label="Club payments received" value={formatAdminCents(Number(metrics.paidClubRevenueCents || 0))} />
          <Metric label="Dancer pending" value={formatAdminCents(Number(metrics.dancerPendingCents || 0))} />
          <Metric label="Dancer available" value={formatAdminCents(Number(metrics.dancerAvailableCents || 0))} />
          <Metric label="Payout processing" value={formatAdminCents(Number(metrics.dancerProcessingCents || 0))} />
          <Metric label="Dancer paid" value={formatAdminCents(Number(metrics.dancerPaidCents || 0))} />
          <Metric label="Reversed earnings" value={formatAdminCents(Number(metrics.reversedEarningsCents || 0))} />
          <Metric label="MyDancr net revenue" value={formatAdminCents(Number(metrics.myDancrNetRevenueCents || 0))} />
          <Metric label="Open invoices" value={String(metrics.openInvoiceCount || 0)} />
          <Metric label="Failed payouts" value={String(metrics.failedPayoutCount || 0)} />
          <Metric label="NATS accounts to verify" value={String(metrics.natsPendingAccountCount || 0)} />
          <Metric label="NATS exports queued" value={String(metrics.natsPendingExportCount || 0)} />
          <Metric label="NATS reconciliation" value={String(metrics.natsReconciliationCount || 0)} />
          <Metric label="Exported to NATS" value={formatAdminCents(Number(metrics.natsExportedCents || 0))} />
        </div>
        <div className="admin-action-row">
          <button disabled={isRunning} type="button" onClick={() => runAction("run_automation")}>Run full reconciliation</button>
          <button disabled={isRunning} type="button" onClick={() => runAction(natsSelected ? "run_automation" : "process_payouts")}>{natsSelected ? "Sync NATS commissions" : "Process payable dancers"}</button>
        </div>
        {status ? <p role="status">{status}</p> : null}
      </Panel>

      {natsSelected ? <Panel title="NATS affiliate settlement" badge={nats.configured === true ? "API ready" : "Credentials required"}>
        <p>MyDancr remains authoritative for NFC validation and exact commission amounts. Verify every dancer login against the licensed NATS admin before activation.</p>
        {nats.affiliatePortalUrl ? <p><a href={asText(nats.affiliatePortalUrl)} target="_blank" rel="noreferrer">Open NATS affiliate portal</a></p> : null}
        <div className="admin-list">
          {natsAccounts.map((account) => <article key={asText(account.dancer_id)}>
            <strong>{asText(readFirst(account.dancer_profiles)?.stage_name) || "Dancer"} · login ID {String(account.login_id || "")}</strong>
            <p>{asText(account.username) || "No username supplied"} · {asText(account.status)}</p>
            <p>Requested {formatDate(account.requested_at)}</p>
            {account.verification_note ? <p>Audit note: {asText(account.verification_note)}</p> : null}
            <div className="admin-action-row">
              {account.status === "requested" ? <button disabled={isRunning || nats.configured !== true} type="button" onClick={() => manageNats("verify_nats_affiliate", asText(account.dancer_id))}>Verify and activate</button> : null}
              {account.status !== "disabled" ? <button disabled={isRunning} type="button" onClick={() => manageNats("disable_nats_affiliate", asText(account.dancer_id))}>Disable link</button> : null}
            </div>
          </article>)}
          {!natsAccounts.length ? <p className="empty">No dancers have requested a NATS account link.</p> : null}
        </div>

        <h3>NATS commission exports</h3>
        <div className="admin-list">
          {natsExports.slice(0, 100).map((item) => <article key={asText(item.id)}>
            <strong>{asText(readFirst(item.dancer_profiles)?.stage_name) || "Dancer"} · {formatAdminCents(Number(item.amount_cents || 0))}</strong>
            <p>{asText(item.status).replaceAll("_", " ")} · attempt {String(item.attempt_count || 0)} · {formatDate(item.created_at)}</p>
            {item.last_error ? <p role="alert">{asText(item.last_error)}</p> : null}
            <div className="admin-action-row">
              {item.status === "failed" ? <button disabled={isRunning || nats.configured !== true} type="button" onClick={() => manageNats("retry_nats_export", asText(item.id))}>Retry definite rejection</button> : null}
              {item.status === "reconciliation_required" ? <>
                <button disabled={isRunning} type="button" onClick={() => manageNats("reconcile_nats_export", asText(item.id), "confirmed_exported")}>Confirmed in NATS</button>
                <button disabled={isRunning || nats.configured !== true} type="button" onClick={() => manageNats("reconcile_nats_export", asText(item.id), "confirmed_not_exported")}>Confirmed not exported</button>
              </> : null}
            </div>
          </article>)}
          {!natsExports.length ? <p className="empty">No NATS commission exports have been queued.</p> : null}
        </div>
      </Panel> : null}

      <Panel title="Payout controls" badge={payoutSettings.livePayoutsEnabled === true ? "Live enabled" : "Money movement off"}>
        <form onSubmit={savePayoutSettings}>
          <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="stripe">Stripe</option><option value="adyen">Adyen</option><option value="other">Other approved provider</option></select></label>
          <label>Payout mode<select value={payoutMode} onChange={(event) => setPayoutMode(event.target.value)}><option value="manual_cashout">Manual cash out</option><option value="scheduled">Scheduled</option><option value="both">Both</option></select></label>
          <label>Earnings hold days<input inputMode="numeric" min="0" max="90" value={holdDays} onChange={(event) => setHoldDays(event.target.value)} /></label>
          <label>Minimum payout<input inputMode="decimal" min="0.01" max="100000" step="0.01" type="number" value={minimumPayout} onChange={(event) => setMinimumPayout(event.target.value)} /></label>
          <label><input type="checkbox" checked={payoutsEnabled} onChange={(event) => setPayoutsEnabled(event.target.checked)} /> Enable payouts in admin</label>
          <p>Live money movement also requires the server-only PAYOUTS_ENABLED flag. Admin settings cannot bypass that hard stop.</p>
          {payoutSettings.providerConfigured !== true ? <p role="alert">The selected provider does not have complete server-side onboarding and payout credentials.</p> : null}
          <button disabled={isRunning} type="submit">Save payout settings</button>
        </form>
      </Panel>

      <Panel title="Dancer earnings ledger" badge={`${earnings.length} inspected`}>
        <div className="operations-layout">
          <div className="operations-list"><strong>Earnings by venue</strong>{earningsByVenue.slice(0, 10).map((group) => <div key={asText(group.name)}><span><strong>{asText(group.name)}</strong><small>{String(group.count || 0)} entries</small></span><em>{formatAdminCents(Number(group.amountCents || 0))}</em></div>)}</div>
          <div className="operations-list"><strong>Earnings by dancer</strong>{earningsByDancer.slice(0, 10).map((group) => <div key={asText(group.name)}><span><strong>{asText(group.name)}</strong><small>{String(group.count || 0)} entries</small></span><em>{formatAdminCents(Number(group.amountCents || 0))}</em></div>)}</div>
        </div>
        <div className="admin-list">
          {earnings.slice(0, 100).map((earning) => (
            <article key={asText(earning.id)}>
              <strong>{asText(readFirst(earning.dancer_profiles)?.stage_name) || "Dancer"} · {formatAdminCents(Number(earning.amount_cents || 0))}</strong>
              <p>{asText(readFirst(earning.venues)?.name) || "Venue"} · {asText(earning.earning_type).replaceAll("_", " ")} · {asText(earning.status)}</p>
              <p>{formatDate(earning.created_at)}</p>
              {earning.hold_reason ? <p>Held: {asText(earning.hold_reason)}</p> : null}
              {earning.reversal_reason ? <p>Reversed: {asText(earning.reversal_reason)}</p> : null}
              {earning.review_flag ? <p role="alert">Review flag: {asText(earning.review_flag)}</p> : null}
              <details>
                <summary>Inspect originating event</summary>
                <p>Earning ID: <code>{asText(earning.id)}</code></p>
                <p>Redemption ID: <code>{asText(earning.qr_redemption_id) || "Not applicable"}</code></p>
                <p>Club Deal: {asText(readFirst(earning.club_deals)?.deal_title) || "Not applicable"}</p>
                <p>Test record: {earning.is_test === true ? "Yes" : "No"}</p>
              </details>
              {["pending", "available"].includes(asText(earning.status)) ? <div className="admin-action-row">
                {earning.held_at ? <button disabled={isRunning} type="button" onClick={() => manageEarning(asText(earning.id), "release")}>Release eligible</button> : <button disabled={isRunning} type="button" onClick={() => manageEarning(asText(earning.id), "hold")}>Hold</button>}
                <button disabled={isRunning} type="button" onClick={() => manageEarning(asText(earning.id), "reverse")}>Reverse</button>
              </div> : null}
            </article>
          ))}
          {!earnings.length ? <p className="empty">No dancer earnings have been recorded.</p> : null}
        </div>
      </Panel>

      <Panel title="Club invoices" badge={`${openInvoices.length} open`}>
        <div className="admin-list">
          {invoices.slice(0, 50).map((invoice) => {
            const venue = readFirst(invoice.venues);
            return (
              <article key={asText(invoice.id)}>
                <strong>{asText(venue?.name) || "Venue"} · {asText(invoice.period_start).slice(0, 7)}</strong>
                <p>{asText(invoice.status)} · {formatAdminCents(Number(invoice.amount_paid_cents || 0))} paid of {formatAdminCents(Number(invoice.amount_due_cents || 0))} · due {formatDate(invoice.due_at)}</p>
                {invoice.last_error ? <p role="alert">{asText(invoice.last_error)}</p> : null}
                <div className="admin-action-row">
                  {invoice.hosted_invoice_url ? <a href={asText(invoice.hosted_invoice_url)} target="_blank" rel="noreferrer">Hosted invoice</a> : null}
                  {invoice.invoice_pdf_url ? <a href={asText(invoice.invoice_pdf_url)} target="_blank" rel="noreferrer">Invoice PDF</a> : null}
                </div>
              </article>
            );
          })}
          {!invoices.length ? <p className="empty">No monthly club invoices have been generated yet.</p> : null}
        </div>
      </Panel>

      <Panel title="Record bank, ACH, or check payment">
        <form onSubmit={recordPayment}>
          <label>
            Open invoice
            <select required value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
              <option value="">Choose invoice</option>
              {openInvoices.map((invoice) => (
                <option key={asText(invoice.id)} value={asText(invoice.id)}>
                  {asText(readFirst(invoice.venues)?.name) || "Venue"} · {asText(invoice.period_start).slice(0, 7)} · {formatAdminCents(Number(invoice.amount_due_cents || 0))}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cumulative amount paid
            <input required inputMode="decimal" value={paymentTotal} onChange={(event) => setPaymentTotal(event.target.value)} placeholder="250.00" />
          </label>
          <label>
            Bank, ACH, or check reference
            <input required maxLength={160} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
          </label>
          <button disabled={isRunning} type="submit">Reconcile payment</button>
        </form>
      </Panel>

      <Panel title="Dancer payout batches" badge={`${payouts.length} tracked`}>
        <div className="admin-list">
          {payouts.slice(0, 50).map((payout) => (
            <article key={asText(payout.id)}>
              <strong>{asText(readFirst(payout.dancer_profiles)?.stage_name) || "Dancer"} · {formatAdminCents(Number(payout.amount_cents || 0))}</strong>
              <p>{asText(payout.status)} · {asText(payout.payment_provider) || "provider pending"} · {formatDate(payout.paid_at || payout.created_at)}</p>
              {payout.provider_reference_id ? <p>Provider reference: <code>{asText(payout.provider_reference_id)}</code></p> : null}
              {payout.failure_message ? <p role="alert">{asText(payout.failure_message)}</p> : null}
              {payout.status === "failed" ? <button disabled={isRunning} type="button" onClick={() => retryPayout(asText(payout.id))}>Retry safely</button> : null}
            </article>
          ))}
          {!payouts.length ? <p className="empty">No dancer payout batches have been created yet.</p> : null}
        </div>
      </Panel>
    </section>
  );
}

function AdminClubDealManager({
  venues,
  clubDeals,
  dealRequests,
  referralFees,
  onClubDealsChange,
  onDealRequestsChange,
  onActionConfirmed,
}: {
  venues: Array<Record<string, unknown>>;
  clubDeals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  referralFees: Record<string, unknown> | null;
  onClubDealsChange: (clubDeals: Array<Record<string, unknown>>) => void;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const preset = defaultClubDealOfferPreset();
  const [venueId, setVenueId] = useState("");
  const [dealId, setDealId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [dealTitle, setDealTitle] = useState<string>(preset.title);
  const [dealTerms, setDealTerms] = useState<string>(preset.terms);
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const venueDeals = clubDeals
    .filter((deal) => asText(deal.venueId) === venueId)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const selectedPreset = CLUB_DEAL_OFFER_PRESETS.find((offer) => offer.title === dealTitle) || preset;
  const terms = asRecordArray(referralFees?.terms);
  const currentTerm = currentAdminReferralTerm(terms.filter((term) => asText(term.venueId) === venueId));
  const openDealRequests = dealRequests.filter((request) => request.status === "pending" || request.status === "under_review");

  function resetEditor(nextVenueId = venueId) {
    setVenueId(nextVenueId);
    setDealId("");
    setRequestId("");
    setDealTitle(preset.title);
    setDealTerms(preset.terms);
    setSortOrder(String(clubDeals.filter((deal) => asText(deal.venueId) === nextVenueId).length * 10));
    setIsActive(false);
    setStatus("");
  }

  function editDeal(deal: Record<string, unknown>) {
    setRequestId("");
    setDealId(asText(deal.id));
    setDealTitle(asText(deal.dealTitle) || preset.title);
    setDealTerms(asText(deal.dealTerms) || preset.terms);
    setSortOrder(String(Number(deal.sortOrder || 0)));
    setIsActive(deal.isActive === true);
    setStatus("");
  }

  function prepareDealRequest(dealRequest: Record<string, unknown>) {
    const nextVenueId = asText(dealRequest.venueId);
    const linkedDeal = clubDeals.find((deal) => asText(deal.id) === asText(dealRequest.linkedDealId));
    const requestedPreset = CLUB_DEAL_OFFER_PRESETS.find((offer) => offer.title === asText(dealRequest.offerTitle)) || preset;
    setVenueId(nextVenueId);
    setRequestId(asText(dealRequest.id));
    setDealId(linkedDeal ? asText(linkedDeal.id) : "");
    setDealTitle(linkedDeal ? asText(linkedDeal.dealTitle) || requestedPreset.title : requestedPreset.title);
    setDealTerms(linkedDeal ? asText(linkedDeal.dealTerms) || requestedPreset.terms : requestedPreset.terms);
    setSortOrder(linkedDeal ? String(Number(linkedDeal.sortOrder || 0)) : String(clubDeals.filter((deal) => asText(deal.venueId) === nextVenueId).length * 10));
    setIsActive(linkedDeal?.isActive === true);
    setStatus("Request loaded. Confirm the Deal Order and referral fee before publishing.");
  }

  function chooseOffer(nextTitle: string) {
    const offer = CLUB_DEAL_OFFER_PRESETS.find((candidate) => candidate.title === nextTitle) || preset;
    setDealTitle(offer.title);
    setDealTerms(offer.terms);
  }

  async function saveDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venueId) return setStatus("Choose the contracted venue first.");
    if (isActive && !currentTerm) return setStatus("Record the signed referral fee agreement before publishing this Club Deal.");
    setIsSaving(true);
    setStatus(isActive ? "Publishing the contract Club Deal…" : "Saving the contract Club Deal…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_contract_deal",
          venueId,
          dealId: dealId || null,
          requestId: requestId || null,
          dealTitle,
          dealDescription: selectedPreset.description,
          dealTerms,
          isActive,
          sortOrder: Number(sortOrder || 0),
        }),
        fallbackMessage: "Unable to save the contract Club Deal.",
      });
      onClubDealsChange(data.clubDeals || []);
      onDealRequestsChange(data.dealRequests || dealRequests);
      setDealId(asText(data.deal?.id));
      if (isActive) setRequestId("");
      const message = isActive ? "Contract Club Deal published by MyDancr." : "Contract Club Deal saved as an unpublished draft.";
      setStatus(message);
      onActionConfirmed(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save the contract Club Deal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteDeal() {
    if (!venueId || !dealId) return setStatus("Choose an unpublished Club Deal first.");
    if (isActive) return setStatus("Pause this Club Deal and save it before deleting it.");
    if (!window.confirm("Delete this unpublished Club Deal? This cannot be undone.")) return;
    setIsSaving(true);
    setStatus("Deleting unpublished Club Deal…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_contract_deal", venueId, dealId }),
        fallbackMessage: "Unable to delete the contract Club Deal.",
      });
      onClubDealsChange(data.clubDeals || []);
      onDealRequestsChange(data.dealRequests || dealRequests);
      resetEditor(venueId);
      onActionConfirmed("Unpublished contract Club Deal deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete the contract Club Deal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function rejectDealRequest(dealRequest: Record<string, unknown>) {
    const reason = window.prompt("Why is this Club Deal request not approved? This note will be visible to the venue.")?.trim();
    if (!reason) return;
    setIsSaving(true);
    setStatus("Rejecting Club Deal request…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review_deal_request",
          requestId: asText(dealRequest.id),
          venueId: asText(dealRequest.venueId),
          status: "rejected",
          decisionNote: reason,
        }),
        fallbackMessage: "Unable to reject the Club Deal request.",
      });
      onDealRequestsChange(data.dealRequests || []);
      if (requestId === asText(dealRequest.id)) resetEditor();
      setStatus("Club Deal request rejected with an audit note.");
      onActionConfirmed("Club Deal request rejected.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reject the Club Deal request.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="operations-center admin-club-deal-manager" aria-labelledby="admin-club-deal-manager-heading">
      <Panel title="Contract Club Deals" badge={`${clubDeals.filter((deal) => deal.isActive === true).length} live`}>
        <span className="eyebrow">MyDancr controlled</span>
        <h2 id="admin-club-deal-manager-heading">Create and publish venue offers</h2>
        <p>Enter only the admission offer authorized by the signed deal order. Venue dashboards receive a read-only copy of every offer, fee, status, and settlement metric.</p>
        <section className="admin-deal-request-inbox" aria-labelledby="admin-deal-request-inbox-heading">
          <div>
            <h3 id="admin-deal-request-inbox-heading">Venue deal requests</h3>
            <span>{openDealRequests.length} open</span>
          </div>
          {openDealRequests.map((dealRequest) => (
            <article key={asText(dealRequest.id)}>
              <div>
                <strong>{asText((dealRequest.venue as Record<string, unknown> | null)?.name) || "Venue"} · {asText(dealRequest.offerTitle)}</strong>
                <small>{asText(dealRequest.requestNotes) || "No additional contract notes."}</small>
              </div>
              <span>{dealRequest.status === "under_review" ? "Under review" : "New request"}</span>
              <button type="button" disabled={isSaving} onClick={() => prepareDealRequest(dealRequest)}>Prepare deal</button>
              <button className="danger-action" type="button" disabled={isSaving} onClick={() => void rejectDealRequest(dealRequest)}>Reject</button>
            </article>
          ))}
          {!openDealRequests.length ? <p className="empty">No venue Club Deal requests are waiting for review.</p> : null}
        </section>
        <form className="admin-club-deal-form" onSubmit={saveDeal}>
          <label>
            Contracted venue
            <select value={venueId} onChange={(event) => resetEditor(event.target.value)} required>
              <option value="">Choose venue</option>
              {venues.map((venue) => <option key={asText(venue.id)} value={asText(venue.id)}>{asText(venue.name)}</option>)}
            </select>
          </label>
          <label>
            Deal offered
            <select value={dealTitle} onChange={(event) => chooseOffer(event.target.value)}>
              {CLUB_DEAL_OFFER_PRESETS.map((offer) => <option key={offer.key} value={offer.title}>{offer.title}</option>)}
            </select>
          </label>
          <label className="wide">
            Public offer details
            <textarea value={selectedPreset.description} readOnly rows={2} />
          </label>
          <label className="wide">
            Contract and guest terms
            <textarea value={dealTerms} onChange={(event) => setDealTerms(event.target.value)} maxLength={1200} rows={4} />
          </label>
          <label>
            Display order
            <input type="number" min="0" max="1000" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
          </label>
          <label className="admin-club-deal-publish-state">
            Publication state
            <span><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Live on MyDancr</span>
          </label>
          <div className="admin-club-deal-agreement wide">
            <span>Signed referral fee</span>
            <strong>{currentTerm ? `${formatAdminCents(Number(currentTerm.feeCents || 0))} per verified guest` : "Agreement required before publishing"}</strong>
            <small>{currentTerm ? `${asText(currentTerm.agreementReference)} · effective ${formatDate(currentTerm.effectiveFrom)}` : "Record the fee in Venue referral terms below."}</small>
          </div>
          {requestId ? <p className="admin-club-deal-request-link wide">This draft is linked to venue request {requestId}. Publishing it will approve the request automatically.</p> : null}
          <div className="admin-club-deal-actions wide">
            <button disabled={isSaving} type="submit">{isSaving ? "Saving…" : isActive ? "Publish contract deal" : "Save unpublished deal"}</button>
            {dealId ? <button className="secondary-action" disabled={isSaving} type="button" onClick={() => resetEditor(venueId)}>New deal</button> : null}
            {dealId && !isActive ? <button className="danger-action" disabled={isSaving} type="button" onClick={() => void deleteDeal()}>Delete unpublished deal</button> : null}
          </div>
        </form>
        {status ? <p role="status">{status}</p> : null}
        <div className="admin-club-deal-list">
          {venueDeals.map((deal) => (
            <button className={asText(deal.id) === dealId ? "selected" : ""} key={asText(deal.id)} type="button" onClick={() => editDeal(deal)}>
              <span><strong>{asText(deal.dealTitle) || "Club Deal"}</strong><small>{deal.isActive === true ? "Live" : "Unpublished"}</small></span>
              <em>{formatAdminCents(Number(deal.payoutAmountCents || 0))} / verified guest</em>
            </button>
          ))}
          {venueId && !venueDeals.length ? <p className="empty">No contract Club Deals have been entered for this venue.</p> : null}
        </div>
      </Panel>
    </section>
  );
}

function ReferralFeeManager({
  venues,
  referralFees,
  onReferralFeesChange,
  onActionConfirmed,
}: {
  venues: Array<Record<string, unknown>>;
  referralFees: Record<string, unknown> | null;
  onReferralFeesChange: (referralFees: Record<string, unknown>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const terms = asRecordArray(referralFees?.terms);
  const requests = asRecordArray(referralFees?.requests);
  const pendingRequests = requests.filter((request) => asText(request.status) === "pending");
  const [venueId, setVenueId] = useState("");
  const [fee, setFee] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => adminLocalDateTime(new Date()));
  const [agreementReference, setAgreementReference] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [reviewRequestId, setReviewRequestId] = useState("");
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedVenue = venues.find((venue) => asText(venue.id) === venueId);
  const selectedTerms = terms.filter((term) => asText(term.venueId) === venueId);
  const currentTerm = currentAdminReferralTerm(selectedTerms);

  function beginRequestApproval(request: Record<string, unknown>) {
    const requestedVenueId = asText(request.venueId);
    setVenueId(requestedVenueId);
    setFee((Number(request.requestedFeeCents || 0) / 100).toFixed(2));
    setReviewRequestId(asText(request.id));
    setDecisionNote(requestNotes[asText(request.id)] || "Approved after MyDancr agreement review.");
    setStatus("Complete the agreement reference and effective date, then approve this request.");
    window.requestAnimationFrame(() => document.getElementById("admin-referral-fee-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function saveAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const feeCents = adminDollarsToCents(fee);
    if (!venueId || feeCents === null || !agreementReference.trim() || !effectiveFrom) {
      return setStatus("Choose a venue and enter a valid fee, effective date, and agreement reference.");
    }
    setIsSaving(true);
    setStatus(reviewRequestId ? "Approving fee request and recording agreement…" : "Recording referral fee agreement…");
    try {
      const data = await requestAdminJson("/api/admin/referral-fees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: reviewRequestId ? "approve_request" : "set_fee",
          requestId: reviewRequestId || null,
          venueId,
          feeCents,
          effectiveFrom: new Date(effectiveFrom).toISOString(),
          agreementReference,
          decisionNote,
        }),
        fallbackMessage: "Unable to save the referral fee agreement.",
      });
      onReferralFeesChange(data.referralFees);
      const message = reviewRequestId ? "Venue fee request approved and agreement recorded." : "Referral fee agreement recorded.";
      setStatus(message);
      setReviewRequestId("");
      setDecisionNote("");
      onActionConfirmed(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save the referral fee agreement.");
    } finally {
      setIsSaving(false);
    }
  }

  async function rejectRequest(request: Record<string, unknown>) {
    const requestId = asText(request.id);
    const note = (requestNotes[requestId] || "").trim();
    if (note.length < 3) return setStatus("Add a decision note before rejecting a fee request.");
    setIsSaving(true);
    setStatus("Rejecting fee request…");
    try {
      const data = await requestAdminJson("/api/admin/referral-fees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject_request", requestId, decisionNote: note }),
        fallbackMessage: "Unable to reject the fee request.",
      });
      onReferralFeesChange(data.referralFees);
      setStatus("Venue fee request rejected with an audit note.");
      onActionConfirmed("Venue fee request rejected.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reject the fee request.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="operations-center referral-fee-manager" aria-labelledby="referral-fee-manager-heading">
      <Panel title="Referral fee agreements" badge={`${pendingRequests.length} requests`}>
        <span className="eyebrow">MyDancr controlled</span>
        <h2 id="referral-fee-manager-heading">Venue referral terms</h2>
        <p>Only MyDancr admins can record the fee charged for each verified individual NFC redemption. Venue managers receive a complete read-only view of the signed amount and history.</p>
        <form id="admin-referral-fee-form" className="referral-fee-form" onSubmit={saveAgreement}>
          <label>
            Venue
            <select required value={venueId} onChange={(event) => { setVenueId(event.target.value); setReviewRequestId(""); }}>
              <option value="">Choose venue</option>
              {venues.map((venue) => <option key={asText(venue.id)} value={asText(venue.id)}>{asText(venue.name)} · {asText(venue.city)}</option>)}
            </select>
          </label>
          <label>
            Fee per verified guest
            <input required inputMode="decimal" placeholder="20.00" value={fee} onChange={(event) => setFee(event.target.value)} />
          </label>
          <label>
            Effective date and time
            <input required type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          </label>
          <label>
            Signed agreement reference
            <input required maxLength={160} placeholder="Agreement or amendment ID" value={agreementReference} onChange={(event) => setAgreementReference(event.target.value)} />
          </label>
          <label className="wide">
            Internal decision note (optional)
            <textarea maxLength={500} rows={2} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
          </label>
          <button disabled={isSaving} type="submit">{isSaving ? "Saving…" : reviewRequestId ? "Approve request & set fee" : "Set referral fee"}</button>
          {reviewRequestId ? <button className="secondary-action" type="button" onClick={() => { setReviewRequestId(""); setDecisionNote(""); }}>Cancel request review</button> : null}
        </form>
        {selectedVenue ? (
          <div className="referral-fee-current">
            <strong>{asText(selectedVenue.name)}</strong>
            <span>{currentTerm ? `${formatAdminCents(Number(currentTerm.feeCents || 0))} per verified guest` : "No active agreement"}</span>
            <small>{currentTerm ? `Effective ${formatDate(currentTerm.effectiveFrom)} · ${asText(currentTerm.agreementReference)}` : "Club Deals cannot be published until an agreement is recorded."}</small>
          </div>
        ) : null}
        {status ? <p role="status">{status}</p> : null}
      </Panel>

      <Panel title="Venue fee change requests" badge={`${pendingRequests.length} pending`}>
        <div className="referral-fee-request-list">
          {pendingRequests.map((request) => {
            const requestId = asText(request.id);
            const venue = venues.find((item) => asText(item.id) === asText(request.venueId));
            return (
              <article key={requestId}>
                <strong>{asText(venue?.name) || "Venue"} · {formatAdminCents(Number(request.requestedFeeCents || 0))}</strong>
                <p>{asText(request.reason)}</p>
                <small>Requested {formatDate(request.createdAt)}</small>
                <label>
                  Decision note
                  <textarea maxLength={500} rows={2} value={requestNotes[requestId] || ""} onChange={(event) => setRequestNotes((current) => ({ ...current, [requestId]: event.target.value }))} />
                </label>
                <div className="admin-action-row">
                  <button disabled={isSaving} type="button" onClick={() => beginRequestApproval(request)}>Review & approve</button>
                  <button className="danger-action" disabled={isSaving} type="button" onClick={() => void rejectRequest(request)}>Reject</button>
                </div>
              </article>
            );
          })}
          {!pendingRequests.length ? <p className="empty">No venue fee change requests are waiting.</p> : null}
        </div>
      </Panel>

      <Panel title="Agreement history" badge={`${terms.length} terms`}>
        <div className="referral-fee-history">
          {terms.slice(0, 100).map((term) => {
            const venue = venues.find((item) => asText(item.id) === asText(term.venueId));
            const state = adminReferralTermState(term);
            return (
              <article key={asText(term.id)}>
                <strong>{asText(venue?.name) || "Venue"} · {formatAdminCents(Number(term.feeCents || 0))}</strong>
                <span className={`account-state ${state === "Active" ? "active" : ""}`}>{state}</span>
                <p>{asText(term.agreementReference)}</p>
                <small>{formatDate(term.effectiveFrom)}{term.effectiveUntil ? ` → ${formatDate(term.effectiveUntil)}` : " onward"}</small>
              </article>
            );
          })}
          {!terms.length ? <p className="empty">No referral fee agreements have been recorded.</p> : null}
        </div>
      </Panel>
    </section>
  );
}

function OperationsOverview({
  operations,
  monitoring,
  onOpenWorkspace,
}: {
  operations: AdminOperationsCenter | null;
  monitoring: Record<string, unknown> | null;
  onOpenWorkspace: (workspace: AdminWorkspace) => void;
}) {
  if (!operations) {
    return (
      <section className="operations-center" aria-live="polite">
        <Panel title="Live operations" defaultOpen><p className="empty">Live operational data is temporarily unavailable. Use More to inspect the affected connection.</p></Panel>
      </section>
    );
  }

  const attention = operations.attention;
  const attentionItems = [
    ["Dancer profiles", attention.dancerProfiles],
    ["Photos", attention.photos],
    ["Videos", attention.videos],
    ["Social links", attention.socialLinks],
    ["Reports", attention.reports],
    ["DMCA", attention.dmca],
    ["Support", attention.support],
    ["Venues", attention.venues],
  ] as const;

  return (
    <section className="operations-center">
      <header className="operations-status-line">
        <div>
          <span className="eyebrow">Command center</span>
          <h2>What needs attention now</h2>
        </div>
        <span className={attention.overdue ? "health-pill warning" : "health-pill healthy"}>
          {attention.overdue ? `${attention.overdue} overdue` : "No overdue queues"}
        </span>
      </header>

      <div className="attention-grid">
        {attentionItems.map(([label, value]) => (
          <button key={label} type="button" onClick={() => onOpenWorkspace(label === "Support" ? "more" : label === "Venues" ? "clubs" : "approvals")}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{value === 1 ? "item" : "items"}</small>
          </button>
        ))}
      </div>

      <div className="operations-layout">
        <Panel title="Live operations" badge={`${operations.live.checkedInDancers.length} checked in`}>
          <div className="operations-metric-grid">
            <Metric label="Operating venues" value={String(operations.live.activeVenueCount)} />
            <Metric label="QR generated / 24h" value={String(operations.live.qrGeneratedToday)} />
            <Metric label="QR redeemed / 24h" value={String(operations.live.qrRedeemedToday)} />
            <Metric label="Suspicious QR / 24h" value={String(operations.live.suspiciousQrToday)} />
          </div>
          <OperationsList
            items={operations.live.checkedInDancers}
            empty="No dancers are currently checked in."
            render={(item) => ({
              title: relationLabel(item.dancer_profiles, "stage_name", "Dancer"),
              detail: `${relationLabel(item.venues, "name", "Venue")} · checked in ${relativeTime(item.checked_in_at)}`,
              status: asText(item.location_status) || "checked in",
            })}
          />
          {operations.live.missedCheckIns.length ? (
            <div className="exception-block">
              <strong>{operations.live.missedCheckIns.length} missed check-in{operations.live.missedCheckIns.length === 1 ? "" : "s"}</strong>
              <OperationsList
                items={operations.live.missedCheckIns}
                empty=""
                render={(item) => ({
                  title: relationLabel(item.dancer_profiles, "stage_name", "Dancer"),
                  detail: `${relationLabel(item.venues, "name", "Venue")} · shift began ${relativeTime(item.starts_at)}`,
                  status: "needs review",
                })}
              />
            </div>
          ) : null}
          <div className="quick-links">
            <button type="button" onClick={() => onOpenWorkspace("money")}>Review deal activity</button>
            <button type="button" onClick={() => onOpenWorkspace("people")}>Open people</button>
          </div>
        </Panel>

        <Panel title="Revenue & deal health" badge={`${operations.revenue.conversionRate}% conversion`}>
          <div className="operations-metric-grid">
            <Metric label="Gross commission" value={formatAdminCents(operations.revenue.grossCommissionCents)} />
            <Metric label="Platform share" value={formatAdminCents(operations.revenue.platformCommissionCents)} />
            <Metric label="Dancer share" value={formatAdminCents(operations.revenue.dancerCommissionCents)} />
            <Metric label="Awaiting venue payment" value={formatAdminCents(operations.revenue.pendingVenuePaymentCents)} />
            <Metric label="Payable to dancers" value={formatAdminCents(operations.revenue.payableCents)} />
            <Metric label="Settled" value={formatAdminCents(operations.revenue.settledCents)} />
          </div>
          <button className="panel-link-button" type="button" onClick={() => onOpenWorkspace("money")}>Open money workspace</button>
        </Panel>

        <Panel title="Growth & engagement">
          <div className="operations-metric-grid">
            <Metric label="Total accounts" value={operations.analytics.totalAccounts.toLocaleString()} />
            <Metric label="Approved dancers" value={operations.analytics.activeDancers.toLocaleString()} />
            <Metric label="New accounts / 7d" value={operations.analytics.newAccounts7d.toLocaleString()} />
            <Metric label="Profile views / 7d" value={operations.analytics.profileViews7d.toLocaleString()} />
            <Metric label="Profile views / 30d" value={operations.analytics.profileViews30d.toLocaleString()} />
            <Metric label="Directions / 7d" value={operations.analytics.directionRequests7d.toLocaleString()} />
            <Metric label="New follows / 7d" value={operations.analytics.newFollows7d.toLocaleString()} />
            <Metric label="Published TV / 30d" value={operations.analytics.publishedVideos30d.toLocaleString()} />
          </div>
        </Panel>

        <SystemHealthSummary monitoring={monitoring} warnings={operations.warnings} onOpenSystem={() => onOpenWorkspace("more")} />
      </div>
      <small className="data-freshness">Live data checked {relativeTime(operations.checkedAt)}.</small>
    </section>
  );
}

function SystemHealthSummary({
  monitoring,
  warnings,
  onOpenSystem,
}: {
  monitoring: Record<string, unknown> | null;
  warnings: Array<{ section: string; message: string }>;
  onOpenSystem: () => void;
}) {
  const integrations = asRecordArray(monitoring?.integrations);
  const database = asRecordArray(monitoring?.database);
  const disconnected = integrations.filter((item) => item.configured === false || item.status === "missing");
  const databaseErrors = database.filter((item) => Boolean(item.error));
  const issues = warnings.length + disconnected.length + databaseErrors.length;
  return (
    <Panel title="Platform health" badge={issues ? `${issues} issues` : "Healthy"}>
      <div className="health-row">
        <span className={issues ? "health-dot warning" : "health-dot healthy"} aria-hidden="true" />
        <div>
          <strong>{issues ? "Degraded services need review" : "Core services are operational"}</strong>
          <small>{integrations.length} integrations · {database.length} database checks</small>
        </div>
      </div>
      {warnings.slice(0, 4).map((warning) => (
        <div className="health-warning" key={`${warning.section}-${warning.message}`}>
          <strong>{warning.section}</strong>
          <span>{warning.message}</span>
        </div>
      ))}
      <button className="panel-link-button" type="button" onClick={onOpenSystem}>Inspect system status</button>
    </Panel>
  );
}

function ActivityTimeline({ operations }: { operations: AdminOperationsCenter | null }) {
  const activity = operations?.activity || [];
  return (
    <section className="workspace-lead">
      <header>
        <span className="eyebrow">Audit trail</span>
        <h2>Recent admin activity</h2>
        <p>Every approval, moderation decision, account change, ranking action, and legal action recorded by the production system.</p>
      </header>
      <div className="activity-timeline">
        {activity.length ? activity.map((item) => (
          <article key={asText(item.id)}>
            <span className="timeline-marker" aria-hidden="true" />
            <div>
              <strong>{labelize(asText(item.action) || "admin action")}</strong>
              <span>{labelize(asText(item.target_type) || "record")} {shortId(item.target_id)}</span>
              {asText(item.notes) ? <p>{asText(item.notes)}</p> : null}
              <small>{formatDate(item.created_at)}</small>
            </div>
          </article>
        )) : <p className="empty">No admin actions have been recorded yet.</p>}
      </div>
    </section>
  );
}

function AccountOverview({ operations }: { operations: AdminOperationsCenter | null }) {
  const [query, setQuery] = useState("");
  const accounts = (operations?.accounts || []).filter((item) => {
    const search = query.trim().toLowerCase();
    if (!search) return true;
    return [item.display_name, item.email, item.role, item.account_state, relationLabel(item.dancer_profiles, "stage_name", "")]
      .some((value) => asText(value).toLowerCase().includes(search));
  });
  return (
    <section className="workspace-lead">
      <header>
        <span className="eyebrow">Account directory</span>
        <h2>Dancers, guests, venues & admins</h2>
        <p>Search the latest production accounts, then use the full dancer and venue records below for operational changes.</p>
      </header>
      <label className="admin-search">
        <span>Search accounts</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, role, or status" type="search" />
      </label>
      <div className="account-table" role="table" aria-label="Recent accounts">
        {accounts.length ? accounts.map((item) => (
          <div role="row" key={asText(item.id)}>
            <span role="cell"><strong>{asText(item.display_name) || relationLabel(item.dancer_profiles, "stage_name", "Unnamed account")}</strong><small>{asText(item.email) || "No email displayed"}</small></span>
            <span role="cell">{labelize(asText(item.role) || "account")}</span>
            <span role="cell" className={`account-state ${asText(item.account_state)}`}>{labelize(asText(item.account_state) || "unknown")}</span>
            <span role="cell"><small>{formatDate(item.created_at)}</small></span>
          </div>
        )) : <p className="empty">No accounts match this search.</p>}
      </div>
    </section>
  );
}

function WorkspaceHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="admin-workspace-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function OperationsList({
  items,
  empty,
  render,
}: {
  items: Array<Record<string, unknown>>;
  empty: string;
  render: (item: Record<string, unknown>) => { title: string; detail: string; status: string };
}) {
  if (!items.length) return empty ? <p className="empty">{empty}</p> : null;
  return (
    <div className="operations-list">
      {items.slice(0, 8).map((item, index) => {
        const row = render(item);
        return (
          <div key={asText(item.id) || index}>
            <span><strong>{row.title}</strong><small>{row.detail}</small></span>
            <em>{labelize(row.status)}</em>
          </div>
        );
      })}
    </div>
  );
}

function relationLabel(value: unknown, key: string, fallback: string) {
  const record = readFirst(value);
  return record ? asText(record[key]) || fallback : fallback;
}

function relativeTime(value: unknown) {
  const date = new Date(asText(value));
  if (Number.isNaN(date.getTime())) return "just now";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function shortId(value: unknown) {
  const id = asText(value);
  return id ? `#${id.slice(0, 8)}` : "";
}

function DealActivityManager({
  activity,
  onActivityChange,
}: {
  activity: Array<Record<string, unknown>>;
  onActivityChange: (activity: Array<Record<string, unknown>>) => void;
}) {
  const [venueId, setVenueId] = useState("");
  const [dancerId, setDancerId] = useState("");
  const [dealId, setDealId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [status, setStatus] = useState("");
  const [commissionStatus, setCommissionStatus] = useState("");
  const [suspicious, setSuspicious] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});

  async function loadFiltered() {
    setIsLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    if (venueId) params.set("venueId", venueId);
    if (dancerId) params.set("dancerId", dancerId);
    if (dealId) params.set("dealId", dealId);
    if (sourceType) params.set("sourceType", sourceType);
    if (status) params.set("status", status);
    if (commissionStatus) params.set("commissionStatus", commissionStatus);
    if (suspicious) params.set("suspicious", suspicious);

    try {
      const data = await requestAdminJson(`/api/admin/deals?${params.toString()}`, {
        fallbackMessage: "Unable to load deal activity.",
      });
      onActivityChange(data.activity || []);
      setMessage(`${data.activity?.length || 0} records loaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load deal activity.");
    } finally {
      setIsLoading(false);
    }
  }

  async function voidRedemption(redemptionId: string) {
    setMessage("Voiding redemption...");
    try {
      await requestAdminJson("/api/admin/deals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redemptionId }),
        fallbackMessage: "Unable to void redemption.",
      });
      onActivityChange(activity.map((item) => (String(item.id) === redemptionId ? { ...item, status: "voided", suspicious: true } : item)));
      setMessage("Redemption voided.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to void redemption.");
    }
  }

  async function settleVenueBalance(eventId: string) {
    const referenceKey = `venue_payment_received:${eventId}`;
    const externalReference = String(paymentReferences[referenceKey] || "").trim();
    if (externalReference.length < 3) {
      setMessage("Enter the real invoice, payment, or payout reference first.");
      return;
    }

    setMessage("Recording venue payment...");
    try {
      await requestAdminJson("/api/admin/deals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "venue_payment_received",
          externalReference,
          revenueEventId: eventId,
        }),
        fallbackMessage: "Unable to record settlement.",
      });
      await loadFiltered();
      setPaymentReferences((current) => ({ ...current, [referenceKey]: "" }));
      setMessage("Venue payment recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to record settlement.");
    }
  }

  return (
    <div className="deal-activity-manager">
      <div className="deal-filters">
        <label>
          Club ID
          <input value={venueId} onChange={(event) => setVenueId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Dancer ID
          <input value={dancerId} onChange={(event) => setDancerId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Deal ID
          <input value={dealId} onChange={(event) => setDealId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Source
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            <option value="">All sources</option>
            <option value="club_page">Club page</option>
            <option value="dancer_profile">Dancer profile</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="generated">Generated</option>
            <option value="redeemed">Redeemed</option>
            <option value="expired">Expired</option>
            <option value="voided">Voided</option>
          </select>
        </label>
        <label>
          Commission
          <select value={commissionStatus} onChange={(event) => setCommissionStatus(event.target.value)}>
            <option value="">All commissions</option>
            <option value="pending">Pending</option>
            <option value="available">Available</option>
            <option value="payout_processing">Payout processing</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          Suspicious
          <select value={suspicious} onChange={(event) => setSuspicious(event.target.value)}>
            <option value="">All activity</option>
            <option value="true">Flagged only</option>
          </select>
        </label>
        <button type="button" onClick={loadFiltered} disabled={isLoading}>
          {isLoading ? "Loading..." : "Filter"}
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="deal-activity-list">
        {activity.slice(0, 8).map((item) => {
          const revenue = readFirst(item.deal_revenue_events);
          const commission = readFirst(item.commission_events);
          const revenueEventId = String(revenue?.id || "");
          const revenueStatus = String(revenue?.status || "");
          const commissionState = String(commission?.status || "");
          const venueReferenceKey = `venue_payment_received:${revenueEventId}`;
          return (
            <div className="deal-activity-row" key={String(item.id)}>
              <strong>{previewDealName(item)}</strong>
              <span>{String(item.source_type || "source")} / {String(item.status || "status")}</span>
              <em>{previewCommission(item)}</em>
              {revenue ? (
                <section className="deal-settlement-ledger" aria-label="Venue receivable">
                  <strong>Venue → MyDancr</strong>
                  <span>
                    Venue owes MyDancr: {formatAdminCents(Number(revenue.gross_commission_cents || 0))}
                  </span>
                  <span>Venue payment: {revenueStatus === "settled" ? "paid" : revenueStatus.replaceAll("_", " ")}</span>
                  {revenueStatus === "pending_venue_payment" ? (
                    <div className="deal-settlement-action">
                      <input
                        aria-label="Venue payment reference"
                        placeholder="Venue invoice/payment reference"
                        value={paymentReferences[venueReferenceKey] || ""}
                        onChange={(event) => setPaymentReferences((current) => ({
                          ...current,
                          [venueReferenceKey]: event.target.value,
                        }))}
                      />
                      <button
                        type="button"
                        onClick={() => settleVenueBalance(revenueEventId)}
                      >
                        Record venue payment
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {commission ? (
                <section className="deal-settlement-ledger" aria-label="Dancer payout">
                  <strong>MyDancr → Dancer</strong>
                  <span>MyDancr owes dancer: {formatAdminCents(Number(commission.amount_cents || 0))}</span>
                  <span>Dancer payout: {commissionState.replaceAll("_", " ")}</span>
                  {commissionState === "available" ? <span>Eligible earnings are paid only through the audited Finance payout workflow.</span> : null}
                </section>
              ) : null}
              {item.suspicious ? <span>Flagged suspicious</span> : null}
              {item.status === "generated" ? (
                <button type="button" onClick={() => voidRedemption(String(item.id))}>
                  Void unused QR
                </button>
              ) : null}
            </div>
          );
        })}
        {!activity.length ? <p className="empty">No deal redemptions yet.</p> : null}
      </div>
    </div>
  );
}

function RankingManager() {
  const [city, setCity] = useState("Las Vegas");
  const [rankings, setRankings] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  async function recalculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsWorking(true);
    setStatus("");
    try {
      const data = await requestAdminJson("/api/admin/rankings/recalculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city }),
        fallbackMessage: "Unable to recalculate rankings.",
      });
      const nextRankings = Array.isArray(data.rankings) ? data.rankings : [];
      setRankings(nextRankings);
      setStatus(`${nextRankings.length} rankings recalculated.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to recalculate rankings. Check your connection and try again.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="ranking-manager">
      <form onSubmit={recalculate}>
        <label>
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <button type="submit" disabled={isWorking}>
          {isWorking ? "Working..." : "Recalculate"}
        </button>
      </form>
      <div className="ranking-list">
        {rankings.slice(0, 6).map((ranking) => (
          <div className="ranking-row" key={String(ranking.dancerId || ranking.id || ranking.rank)}>
            <strong>{String(ranking.stageName || ranking.dancerName || "Dancer")}</strong>
            <span>{ranking.rank ? `#${ranking.rank}` : "Ranked"}</span>
          </div>
        ))}
      </div>
      {status ? <p>{status}</p> : null}
    </div>
  );
}

function ImageModerationQueue({
  records,
  onRecordsChange,
  onActionConfirmed,
}: {
  records: Array<Record<string, unknown>>;
  onRecordsChange: (records: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [filter, setFilter] = useState("review");
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function loadQueue(nextFilter = filter) {
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }
    setIsLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/image-moderation?decision=${encodeURIComponent(nextFilter)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    setIsLoading(false);
    if (!response.ok || !data.ok) {
      setMessage(data.error || "Unable to load image moderation queue.");
      return;
    }
    onRecordsChange(data.records || []);
    setMessage(`${data.records?.length || 0} image moderation records loaded.`);
  }

  async function decide(recordId: string, decision: "approved" | "rejected") {
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }
    const confirmed = window.confirm(decision === "approved" ? "Approve this photo and publish it?" : "Reject this photo and keep it private?");
    if (!confirmed) return;

    setMessage(decision === "approved" ? "Publishing approved photo..." : "Rejecting photo...");
    const response = await fetch("/api/admin/image-moderation", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recordId, decision, notes: notesById[recordId] || "" }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setMessage(data.error || "Unable to update moderation record.");
      return;
    }
    onRecordsChange(records.filter((record) => String(record.id) !== recordId));
    const confirmation =
      decision === "approved"
        ? "Picture approved and published successfully."
        : "Picture rejected successfully and removed from private review storage.";
    setMessage(confirmation);
    onActionConfirmed(confirmation);
  }

  return (
    <div className="image-moderation-manager">
      <div className="image-moderation-filters">
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            loadQueue(event.target.value);
          }}
        >
          <option value="review">Pending review</option>
          <option value="approved">Approved</option>
        </select>
        <button type="button" onClick={() => loadQueue()} disabled={isLoading}>
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="image-moderation-list">
        {records.slice(0, 12).map((record) => {
          const recordId = String(record.id || "");
          const reasonCodes = Array.isArray(record.reasonCodes) ? record.reasonCodes : Array.isArray(record.reason_codes) ? record.reason_codes : [];
          const scores = (record.categoryScores || record.category_scores || {}) as Record<string, unknown>;
          const flags = (record.categoryFlags || record.category_flags || {}) as Record<string, unknown>;
          return (
            <article className="image-moderation-row" key={recordId}>
              {record.thumbnailUrl ? <img src={String(record.thumbnailUrl)} alt="Moderation thumbnail" /> : <div className="moderation-thumb-empty">Private</div>}
              <div className="image-moderation-copy">
                <strong>{String(record.upload_context || "photo upload")}</strong>
                <span>{String(record.decision || "review")} / {String(record.status || "pending")}</span>
                <small>{String(record.created_at || "")}</small>
                <small>Model: {String(record.provider_model || "openai")}</small>
                <small>Reasons: {reasonCodes.length ? reasonCodes.join(", ") : "None"}</small>
                <details>
                  <summary>Category flags and scores</summary>
                  <pre>{JSON.stringify({ flags, scores }, null, 2)}</pre>
                </details>
                {String(record.decision) === "review" ? (
                  <>
                    <textarea
                      value={notesById[recordId] || ""}
                      onChange={(event) => setNotesById((current) => ({ ...current, [recordId]: event.target.value }))}
                      placeholder="Reviewer notes"
                    />
                    <div className="image-moderation-actions">
                      <button type="button" onClick={() => decide(recordId, "approved")}>Approve</button>
                      <button type="button" onClick={() => decide(recordId, "rejected")}>Reject</button>
                    </div>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
        {!records.length ? <p className="empty">No image moderation records for this filter.</p> : null}
      </div>
    </div>
  );
}

function AdminSupportInbox({
  threads,
  onThreadsChange,
}: {
  threads: Array<Record<string, unknown>>;
  onThreadsChange: (threads: Array<Record<string, unknown>>) => void;
}) {
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const [statusByThread, setStatusByThread] = useState<Record<string, string>>({});

  async function reply(threadId: string) {
    const token = readToken();
    if (!token) {
      setStatusByThread((current) => ({ ...current, [threadId]: "Admin sign in required." }));
      return;
    }

    const message = (replyByThread[threadId] || "").trim();
    if (!message) {
      setStatusByThread((current) => ({ ...current, [threadId]: "Enter a reply first." }));
      return;
    }

    setStatusByThread((current) => ({ ...current, [threadId]: "Sending reply..." }));
    const response = await fetch("/api/admin/support", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ threadId, message }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      setStatusByThread((current) => ({ ...current, [threadId]: data.error || "Unable to send reply." }));
      return;
    }

    onThreadsChange([data.thread, ...threads.filter((thread) => String(thread.id) !== threadId)]);
    setReplyByThread((current) => ({ ...current, [threadId]: "" }));
    setStatusByThread((current) => ({ ...current, [threadId]: "Reply sent." }));
  }

  if (!threads.length) return <p className="empty">No support messages yet.</p>;

  return (
    <div className="support-inbox-list">
      {threads.slice(0, 8).map((thread) => {
        const threadId = String(thread.id || "");
        const messages = asRecordArray(thread.messages);
        const userLabel = String(thread.userName || thread.userEmail || thread.userRole || "User");
        return (
          <details className="support-inbox-thread" key={threadId} open={threads.length === 1}>
            <summary>
              <span>
                <strong>{String(thread.subject || "Support message")}</strong>
                <small>{userLabel} / {String(thread.userRole || "user")} / {String(thread.status || "open")} / {formatDate(thread.lastMessageAt)}</small>
              </span>
            </summary>
            <div className="support-inbox-messages">
              {messages.map((message) => {
                const senderLabel = String(message.senderRole) === "admin" ? "Admin Support" : userLabel;
                return (
                <div className={String(message.senderRole) === "admin" ? "support-inbox-message from-admin" : "support-inbox-message"} key={String(message.id)}>
                  <strong>{senderLabel}</strong>
                  <p>{String(message.body || "")}</p>
                  <small>{formatDate(message.createdAt)}</small>
                </div>
                );
              })}
            </div>
            <textarea
              value={replyByThread[threadId] || ""}
              onChange={(event) => setReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
              placeholder="Reply to this guest, dancer, or venue"
            />
            <button type="button" onClick={() => reply(threadId)}>
              Reply to account
            </button>
            {statusByThread[threadId] ? <p>{statusByThread[threadId]}</p> : null}
          </details>
        );
      })}
    </div>
  );
}

function ReportManager({
  reports,
  onReportsChange,
}: {
  reports: Array<Record<string, unknown>>;
  onReportsChange: (reports: Array<Record<string, unknown>>) => void;
}) {
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  if (!reports.length) return <p className="empty">No open reports.</p>;

  async function updateReport(reportId: string, action: "resolved" | "removed") {
    const token = readToken();
    if (!token) {
      setStatusById((current) => ({ ...current, [reportId]: "Admin sign in required." }));
      return;
    }

    setStatusById((current) => ({ ...current, [reportId]: "Saving..." }));
    const response = await fetch("/api/admin/reports", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reportId, action }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatusById((current) => ({ ...current, [reportId]: data.error || "Unable to update report." }));
      return;
    }

    onReportsChange(reports.filter((report) => String(report.id) !== reportId));
  }

  return (
    <div className="report-list">
      {reports.slice(0, 6).map((report) => {
        const reportId = String(report.id || "");
        return (
          <div className="report-row" key={reportId}>
            <strong>{String(report.targetLabel || report.targetType || "Reported item")}</strong>
            <span>{String(report.reason || "Reason pending")}</span>
            {report.details ? <p>{String(report.details)}</p> : null}
            <div>
              <button type="button" onClick={() => updateReport(reportId, "resolved")}>
                Resolve
              </button>
              <button type="button" onClick={() => updateReport(reportId, "removed")}>
                Remove
              </button>
            </div>
            {statusById[reportId] ? <p>{statusById[reportId]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function VenueSignupRequestQueue({
  requests,
  venues,
  claimCodes,
  onRequestsChange,
  onVenuesChange,
  onClaimCodesChange,
  onActionConfirmed,
}: {
  requests: Array<Record<string, unknown>>;
  venues: Array<Record<string, unknown>>;
  claimCodes: Array<Record<string, unknown>>;
  onRequestsChange: (requests: Array<Record<string, unknown>>) => void;
  onVenuesChange: (venues: Array<Record<string, unknown>>) => void;
  onClaimCodesChange: (claimCodes: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [notesByRequest, setNotesByRequest] = useState<Record<string, string>>({});
  const [statusByRequest, setStatusByRequest] = useState<Record<string, string>>({});
  const [busyRequestId, setBusyRequestId] = useState("");
  const [issuedAccess, setIssuedAccess] = useState<{
    requestId: string;
    venueName: string;
    code: string;
    emailDelivered: boolean;
  } | null>(null);
  async function reviewRequest(request: Record<string, unknown>, decision: "approved" | "rejected") {
    const requestId = asText(request.id);
    const token = readToken();
    if (!token) {
      setStatusByRequest((current) => ({ ...current, [requestId]: "Admin sign in required." }));
      return;
    }
    const notes = notesByRequest[requestId]?.trim() || "";
    if (decision === "rejected" && !notes) {
      setStatusByRequest((current) => ({ ...current, [requestId]: "Add a reason before rejecting this request." }));
      return;
    }
    if (decision === "rejected" && !window.confirm(`Reject ${asText(request.venueName) || "this venue"}'s access request?`)) return;

    setBusyRequestId(requestId);
    setStatusByRequest((current) => ({
      ...current,
      [requestId]: decision === "approved" ? "Approving venue and creating private access..." : "Rejecting request...",
    }));

    try {
      const response = await fetch("/api/admin/venue-signup-requests", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          requestId,
          decision,
          notes: notes || null,
          confirmAgentReferral: decision === "approved" && Boolean(asText(request.referringAgentId)),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to review the venue request.");
      }

      onRequestsChange(requests.filter((item) => asText(item.id) !== requestId));
      if (decision === "approved" && data.venue?.id) {
        const venueId = asText(data.venue.id);
        const normalizedVenue = {
          ...data.venue,
          is_active: data.venue.isActive !== false,
          owner_user_id: null,
        };
        onVenuesChange(
          venues.some((venue) => asText(venue.id) === venueId)
            ? venues.map((venue) => asText(venue.id) === venueId ? { ...venue, ...normalizedVenue } : venue)
            : [normalizedVenue, ...venues],
        );
        if (data.claimCode?.id) {
          onClaimCodesChange([
            data.claimCode,
            ...claimCodes.map((claimCode) => (
              asText(claimCode.venueId) === venueId && asText(claimCode.status) === "active"
                ? { ...claimCode, status: "revoked", revokedAt: new Date().toISOString() }
                : claimCode
            )),
          ]);
        }
        setIssuedAccess({
          requestId,
          venueName: asText(data.venue.name) || asText(request.venueName),
          code: asText(data.accessCode),
          emailDelivered: data.emailDelivery?.delivered === true,
        });
      }
      onActionConfirmed(data.message || (decision === "approved" ? "Venue request approved." : "Venue request rejected."));
    } catch (error) {
      setStatusByRequest((current) => ({
        ...current,
        [requestId]: error instanceof Error ? error.message : "Unable to review the venue request.",
      }));
    } finally {
      setBusyRequestId("");
    }
  }

  async function copyIssuedAccessCode() {
    if (!issuedAccess?.code) return;
    try {
      await copyAdminText(issuedAccess.code);
      onActionConfirmed("Private venue access code copied.");
    } catch {
      onActionConfirmed("Select and copy the private access code manually.");
    }
  }

  return (
    <section className="venue-request-queue" aria-labelledby="venue-request-queue-title">
      <div className="venue-request-queue-head">
        <span>
          <strong id="venue-request-queue-title">Venue signup requests</strong>
          <small>Verify the business before issuing manager access.</small>
        </span>
        <em>{requests.length} pending</em>
      </div>
      {issuedAccess ? (
        <div className="venue-request-issued" role="status" aria-live="polite">
          <span className="eyebrow">Approved — copy once</span>
          <strong>{issuedAccess.venueName}</strong>
          <p>
            {issuedAccess.emailDelivered
              ? "The private code was emailed to the business contact. Copy it only if a secure backup delivery is needed."
              : "Email delivery was unavailable. Copy this code now and send it to the verified contact through a secure channel."}
          </p>
          <code>{issuedAccess.code}</code>
          <button type="button" onClick={copyIssuedAccessCode}>Copy private access code</button>
          <button className="secondary" type="button" onClick={() => setIssuedAccess(null)}>Done</button>
        </div>
      ) : null}
      <div className="venue-request-list">
        {requests.map((request) => {
          const requestId = asText(request.id);
          const isBusy = busyRequestId === requestId;
          return (
            <details className="venue-request-row" key={requestId}>
              <summary>
                <span>
                  <strong>{asText(request.venueName) || "Venue request"}</strong>
                  <small>{[asText(request.city), asText(request.state)].filter(Boolean).join(", ")} · {asText(request.contactName)}{request.referringAgentId ? ` · Referred by ${asText(request.referringAgentName) || "sales agent"}` : ""}</small>
                </span>
                <span className="venue-disclosure" aria-hidden="true">⌄</span>
              </summary>
              <div className="venue-request-details">
                <dl>
                  <div><dt>Public address</dt><dd>{[asText(request.streetAddress), asText(request.city), asText(request.state), asText(request.postalCode)].filter(Boolean).join(", ")}</dd></div>
                  <div><dt>Contact</dt><dd>{asText(request.contactName)} · {asText(request.contactTitle)}</dd></div>
                  <div><dt>Business email</dt><dd><a href={`mailto:${asText(request.contactEmail)}`}>{asText(request.contactEmail)}</a></dd></div>
                  <div><dt>Business phone</dt><dd><a href={`tel:${asText(request.contactPhone)}`}>{asText(request.contactPhone)}</a></dd></div>
                  {request.website ? <div><dt>Website</dt><dd><a href={asText(request.website)} target="_blank" rel="noopener noreferrer">Open website</a></dd></div> : null}
                  {request.message ? <div><dt>Request note</dt><dd>{asText(request.message)}</dd></div> : null}
                  {request.referringAgentId ? <div><dt>Agent referral</dt><dd>{asText(request.referringAgentName) || "Active sales agent"} · confirm this relationship before approval</dd></div> : null}
                  <div><dt>Submitted</dt><dd>{formatDate(request.submittedAt)}</dd></div>
                </dl>
                <div className="venue-request-private-workspace">
                  <strong>{request.referringAgentId ? "Approval confirms the agent referral" : "Approval creates a private venue workspace"}</strong>
                  <small>{request.referringAgentId
                    ? `Confirm that ${asText(request.referringAgentName) || "the listed sales agent"} introduced this club. Approval creates an immutable commission attribution and the private venue workspace.`
                    : "The venue manager receives a one-time signup code and completes the venue page. MyDancr records and publishes contract Club Deals and referral fees from the signed deal order."}</small>
                </div>
                <label>
                  Review notes
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={notesByRequest[requestId] || ""}
                    onChange={(event) => setNotesByRequest((current) => ({ ...current, [requestId]: event.target.value }))}
                    placeholder="Required when rejecting; optional internal note when approving"
                    disabled={isBusy}
                  />
                </label>
                <div className="venue-request-actions">
                  <button type="button" disabled={isBusy} onClick={() => reviewRequest(request, "approved")}>
                    {isBusy ? "Working..." : request.referringAgentId ? "Confirm agent & approve" : "Approve & send access"}
                  </button>
                  <button className="secondary" type="button" disabled={isBusy} onClick={() => reviewRequest(request, "rejected")}>
                    Reject request
                  </button>
                </div>
                {statusByRequest[requestId] ? <p role="status" aria-live="polite">{statusByRequest[requestId]}</p> : null}
              </div>
            </details>
          );
        })}
        {!requests.length ? <p className="empty">No venue signup requests are waiting for review.</p> : null}
      </div>
    </section>
  );
}

function VenueManager({
  venues,
  claimCodes,
  onVenuesChange,
  onClaimCodesChange,
}: {
  venues: Array<Record<string, unknown>>;
  claimCodes: Array<Record<string, unknown>>;
  onVenuesChange: (venues: Array<Record<string, unknown>>) => void;
  onClaimCodesChange: (claimCodes: Array<Record<string, unknown>>) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusByVenue, setStatusByVenue] = useState<Record<string, string>>({});
  const [busyVenueId, setBusyVenueId] = useState("");

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleVenues = normalizedSearch
    ? venues.filter((venue) => [venue.name, venue.city, venue.state, venue.address]
      .some((value) => asText(value).toLowerCase().includes(normalizedSearch)))
    : venues;

  function setVenueStatus(venueId: string, message: string) {
    setStatusByVenue((current) => ({ ...current, [venueId]: message }));
  }

  function mergeVenue(venueId: string, next: Record<string, unknown>) {
    onVenuesChange(venues.map((item) => {
      if (asText(item.id) !== venueId) return item;
      return {
        ...item,
        ...next,
        ...(next.logoImageUrl !== undefined ? { logo_image_url: next.logoImageUrl, logo_storage_path: next.logoStoragePath } : {}),
        ...(next.coverImageUrl !== undefined ? { cover_image_url: next.coverImageUrl, cover_image_storage_path: next.coverImageStoragePath } : {}),
      };
    }));
  }

  async function saveVenuePage(event: React.FormEvent<HTMLFormElement>, venue: Record<string, unknown>) {
    event.preventDefault();
    const venueId = asText(venue.id);
    const token = readToken();
    if (!token) return setVenueStatus(venueId, "Admin sign in required.");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(["name", "address", "city", "state", "latitude", "longitude", "phone", "website", "timezone", "opensAt", "closesAt"]
      .map((key) => [key, String(form.get(key) || "").trim()]));
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, "Saving private venue page...");
      const response = await fetch("/api/admin/venues", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ venueId, ...body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.venue) throw new Error(data?.error || "Unable to save venue page.");
      mergeVenue(venueId, data.venue);
      setVenueStatus(venueId, "Private venue page saved. Any prior approval was reset because the page changed.");
    } catch (error) {
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to save venue page.");
    } finally {
      setBusyVenueId("");
    }
  }

  async function uploadVenueImage(venue: Record<string, unknown>, kind: "logo" | "cover", file: File | null) {
    const venueId = asText(venue.id);
    if (!file) return setVenueStatus(venueId, `Choose a ${kind} image first.`);
    const token = readToken();
    if (!token) return setVenueStatus(venueId, "Admin sign in required.");
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, `Checking and uploading venue ${kind}...`);
      const body = new FormData();
      body.set("venueId", venueId);
      body.set("kind", kind);
      body.set("file", file);
      const response = await fetch("/api/admin/venues/media", { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.venue) throw new Error(data?.error || `Unable to upload venue ${kind}.`);
      mergeVenue(venueId, data.venue);
      setVenueStatus(venueId, `Venue ${kind} uploaded. Any prior approval was reset because the page changed.`);
    } catch (error) {
      setVenueStatus(venueId, error instanceof Error ? error.message : `Unable to upload venue ${kind}.`);
    } finally {
      setBusyVenueId("");
    }
  }

  async function removeVenueImage(venue: Record<string, unknown>, kind: "logo" | "cover") {
    const venueId = asText(venue.id);
    if (!window.confirm(`Remove this venue ${kind}?`)) return;
    const token = readToken();
    if (!token) return setVenueStatus(venueId, "Admin sign in required.");
    try {
      setBusyVenueId(venueId);
      const response = await fetch("/api/admin/venues/media", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ venueId, kind }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.venue) throw new Error(data?.error || `Unable to remove venue ${kind}.`);
      mergeVenue(venueId, data.venue);
      setVenueStatus(venueId, `Venue ${kind} removed.`);
    } catch (error) {
      setVenueStatus(venueId, error instanceof Error ? error.message : `Unable to remove venue ${kind}.`);
    } finally {
      setBusyVenueId("");
    }
  }

  async function sendVenuePageForReview(venue: Record<string, unknown>) {
    const venueId = asText(venue.id);
    const token = readToken();
    if (!token) return setVenueStatus(venueId, "Admin sign in required.");
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, "Sending private page to the venue...");
      const response = await fetch("/api/admin/venues", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ venueId, action: "send_for_review" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.venue) throw new Error(data?.error || "Unable to update venue page workflow.");
      mergeVenue(venueId, data.venue);
      setVenueStatus(venueId, "Review sent. The venue can now approve the exact page and make it live.");
    } catch (error) {
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to update venue page workflow.");
    } finally {
      setBusyVenueId("");
    }
  }

  function activeCodeForVenue(venueId: string) {
    return claimCodes.find((claimCode) => (
      asText(claimCode.venueId) === venueId
      && asText(claimCode.status) === "active"
      && new Date(asText(claimCode.expiresAt)).getTime() > Date.now()
    ));
  }

  function venuePagePreviewHref(venue: Record<string, unknown>) {
    const params = new URLSearchParams({
      city: asText(venue.city),
      venue: asText(venue.slug) || asText(venue.name),
      venue_id: asText(venue.id),
      venue_preview: "1",
      preview_source: "admin",
    });
    return `/?${params.toString()}`;
  }

  async function hideVenue(venue: Record<string, unknown>) {
    const venueId = asText(venue.id);
    const token = readToken();
    if (!token) {
      setVenueStatus(venueId, "Admin sign in required.");
      return;
    }

    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, "Removing venue from public discovery...");
      const response = await fetch("/api/admin/venues", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ venueId, isActive: false }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to update venue.");
      }

      onVenuesChange(venues.map((item) => (String(item.id) === venueId ? { ...item, ...data.venue } : item)));
      setVenueStatus(venueId, "Venue hidden. MyDancr must prepare a new private draft, obtain venue approval, and publish it again.");
    } catch (error) {
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to update venue.");
    } finally {
      setBusyVenueId("");
    }
  }

  async function revokeAccessCode(venueId: string, claimCode: Record<string, unknown>) {
    if (!window.confirm("Revoke this access code? It will stop working immediately.")) return;
    const token = readToken();
    if (!token) {
      setVenueStatus(venueId, "Admin sign in required.");
      return;
    }

    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, "Revoking access code...");
      const response = await fetch("/api/admin/venue-claim-codes", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", codeId: asText(claimCode.id) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.claimCode) {
        throw new Error(data?.error || "Unable to revoke venue access code.");
      }

      onClaimCodesChange(claimCodes.map((item) => (
        asText(item.id) === asText(data.claimCode.id) ? data.claimCode : item
      )));
      setVenueStatus(venueId, "Access code revoked.");
    } catch (error) {
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to revoke venue access code.");
    } finally {
      setBusyVenueId("");
    }
  }

  return (
    <div className="venue-manager">
      <p className="admin-info-note">Approve a submitted request to create its private workspace. MyDancr then builds the full venue page and sends the exact page to the connected venue manager. The manager can request changes or approve it to make it live.</p>
      <label className="venue-search">
        Find venue
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search name, city, state, or address"
        />
      </label>
      <div className="venue-list-heading">
        <strong>Venue access</strong>
        <small>{visibleVenues.length} {visibleVenues.length === 1 ? "venue" : "venues"}</small>
      </div>
      <div className="venue-list">
        {visibleVenues.map((venue) => {
          const venueId = asText(venue.id);
          const activeCode = activeCodeForVenue(venueId);
          const connectedManager = Boolean(asText(venue.owner_user_id || venue.ownerUserId));
          const isActive = venue.is_active !== false;
          const isBusy = busyVenueId === venueId;
          const reviewStatus = asText(venue.page_review_status) || (isActive ? "published" : "admin_draft");
          const requirements = [
            { label: "Venue details", complete: Boolean(asText(venue.name) && asText(venue.address) && asText(venue.city) && asText(venue.state)) },
            { label: "Map coordinates", complete: validAdminCoordinate(venue.latitude, -90, 90) !== null && validAdminCoordinate(venue.longitude, -180, 180) !== null },
            { label: "Public phone", complete: Boolean(asText(venue.phone)) },
            { label: "Venue hours", complete: Boolean(asText(venue.opens_at) && asText(venue.closes_at)) },
            { label: "Venue logo", complete: Boolean(asText(venue.logo_image_url)) },
            { label: "Active Club Deal", complete: Number(venue.active_deal_count || 0) > 0 },
          ];
          const isReady = requirements.every((requirement) => requirement.complete);
          const reviewLabel = reviewStatus === "venue_review"
            ? "Venue review"
            : reviewStatus === "changes_requested"
              ? "Changes requested"
              : reviewStatus === "venue_approved"
                ? "Venue approved"
                : reviewStatus === "published"
                  ? "Published"
                  : "MyDancr draft";
          return (
            <details className="venue-admin-row" key={venueId}>
              <summary>
                <span className="venue-admin-identity">
                  <strong>{asText(venue.name) || "Venue"}</strong>
                  <small>{[asText(venue.city) || "City", asText(venue.state)].filter(Boolean).join(", ")}</small>
                </span>
                <span className="venue-admin-summary-state">
                  <em className={reviewStatus === "published" || reviewStatus === "venue_approved" ? "connected" : isActive ? "active" : "inactive"}>
                    {reviewLabel}
                  </em>
                  <span className="venue-disclosure" aria-hidden="true">⌄</span>
                </span>
              </summary>
              <div className="venue-admin-actions">
                <small>{asText(venue.address) || "No address submitted"}</small>
                {isActive ? <button type="button" disabled={isBusy} onClick={() => hideVenue(venue)}>Hide venue</button> : <span>Private workspace · {connectedManager ? "manager connected" : "waiting for manager account"}</span>}
              </div>
              <section className="venue-page-admin-panel" aria-label={`${asText(venue.name) || "Venue"} managed page`}>
                <div className="venue-page-admin-heading">
                  <span><small>Managed venue page</small><strong>{reviewLabel}</strong></span>
                  <b>{requirements.filter((requirement) => requirement.complete).length}/{requirements.length} ready</b>
                </div>
                {reviewStatus === "changes_requested" && asText(venue.page_review_notes) ? (
                  <div className="venue-page-change-request"><strong>Venue requested changes</strong><p>{asText(venue.page_review_notes)}</p></div>
                ) : null}
                <form className="venue-page-editor" onSubmit={(event) => void saveVenuePage(event, venue)}>
                  <label>Venue name<input name="name" defaultValue={asText(venue.name)} required readOnly={isActive} /></label>
                  <label>Public address<input name="address" defaultValue={asText(venue.address)} required readOnly={isActive} /></label>
                  <label>City<input name="city" defaultValue={asText(venue.city)} required readOnly={isActive} /></label>
                  <label>State<input name="state" defaultValue={asText(venue.state)} required readOnly={isActive} /></label>
                  <label>Latitude<input name="latitude" defaultValue={asText(venue.latitude)} inputMode="decimal" max="90" min="-90" required readOnly={isActive} step="0.000001" type="number" /></label>
                  <label>Longitude<input name="longitude" defaultValue={asText(venue.longitude)} inputMode="decimal" max="180" min="-180" required readOnly={isActive} step="0.000001" type="number" /></label>
                  <label>Public phone<input name="phone" defaultValue={asText(venue.phone)} required readOnly={isActive} type="tel" /></label>
                  <label>Website<input name="website" defaultValue={asText(venue.website)} readOnly={isActive} inputMode="url" /></label>
                  <label>Time zone<input name="timezone" defaultValue={asText(venue.timezone) || "America/Los_Angeles"} required readOnly={isActive} /></label>
                  <label>Opens<input name="opensAt" defaultValue={asText(venue.opens_at).slice(0, 5)} required readOnly={isActive} type="time" /></label>
                  <label>Closes<input name="closesAt" defaultValue={asText(venue.closes_at).slice(0, 5)} required readOnly={isActive} type="time" /></label>
                  {!isActive ? <button type="submit" disabled={isBusy}>Save private page</button> : <small>Published venue details are locked here. Hide the venue before replacing its approved public page.</small>}
                </form>
                <div className="venue-page-media-admin">
                  {(["logo", "cover"] as const).map((kind) => {
                    const imageUrl = asText(venue[`${kind}_image_url`]);
                    return (
                      <form key={kind} onSubmit={(event) => {
                        event.preventDefault();
                        const file = new FormData(event.currentTarget).get("file");
                        void uploadVenueImage(venue, kind, file instanceof File ? file : null);
                      }}>
                        <strong>{kind === "logo" ? "Official logo" : "Venue detail cover (optional)"}</strong>
                        <small>{kind === "logo" ? "Use the original high-resolution logo file." : "Use the original camera image for the clearest venue page."}</small>
                        {imageUrl ? <img src={imageUrl} alt={`${asText(venue.name)} ${kind}`} /> : <span>No {kind} uploaded</span>}
                        {!isActive ? <input accept="image/*,.heic,.heif" name="file" type="file" required /> : null}
                        {!isActive ? <button type="submit" disabled={isBusy}>{imageUrl ? `Replace ${kind}` : `Upload ${kind}`}</button> : null}
                        {!isActive && imageUrl ? <button className="secondary" type="button" disabled={isBusy} onClick={() => void removeVenueImage(venue, kind)}>Remove</button> : null}
                      </form>
                    );
                  })}
                </div>
                <ul className="venue-page-requirements">
                  {requirements.map((requirement) => <li className={requirement.complete ? "complete" : ""} key={requirement.label}><span>{requirement.complete ? "✓" : "○"}</span>{requirement.label}</li>)}
                </ul>
                <div className="venue-page-workflow-actions">
                  <div className="venue-page-workflow-copy">
                    <small>Final Admin review</small>
                    <strong>Preview the completed customer experience, then send it to the venue.</strong>
                    <p>The preview uses the same venue-page renderer the manager will review and customers will see after approval.</p>
                  </div>
                  <a className="venue-page-preview-action" href={venuePagePreviewHref(venue)} rel="noopener noreferrer" target="_blank">Preview full customer page</a>
                  {!isActive && reviewStatus !== "venue_approved" ? (
                    <button type="button" disabled={isBusy || !isReady || !connectedManager} onClick={() => void sendVenuePageForReview(venue)}>{reviewStatus === "venue_review" ? "Resend venue review" : "Send page for venue approval"}</button>
                  ) : null}
                  {!isReady ? <small>Complete every requirement before sending this page to the venue.</small> : !connectedManager && !isActive ? <small>The manager must redeem the approved access code before review can be sent.</small> : null}
                </div>
              </section>
              <section className="venue-access-panel" aria-label={`${asText(venue.name) || "Venue"} access code`}>
                <span className="eyebrow">Manager access</span>
                {connectedManager ? (
                  <div className="venue-access-state connected">
                    <strong>Venue account connected</strong>
                    <p>A verified manager already controls this venue. Access codes are disabled.</p>
                  </div>
                ) : activeCode ? (
                  <>
                    <div className="venue-access-state">
                      <strong>Active one-time access code</strong>
                      <p>
                        {`Created from the approved venue request and expires ${formatDate(activeCode.expiresAt)}. The code can be used once to create this venue's manager account.`}
                      </p>
                    </div>
                    <div className="venue-access-actions">
                      <button className="secondary" type="button" disabled={isBusy} onClick={() => revokeAccessCode(venueId, activeCode)}>
                        Revoke access code
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="venue-access-state inactive">
                    <strong>No active access code</strong>
                    <p>Review the original venue request. New codes are issued only through the approved request workflow.</p>
                  </div>
                )}
              </section>
              {statusByVenue[venueId] ? <p className="venue-status" role="status" aria-live="polite">{statusByVenue[venueId]}</p> : null}
            </details>
          );
        })}
        {!visibleVenues.length ? <p className="empty">{venues.length ? "No venues match this search." : "No venues returned."}</p> : null}
      </div>
    </div>
  );
}

function ApprovalQueue({
  items,
  openById,
  onToggleOpen,
  onKeepOpen,
  onSocialReviewed,
  onProfileUpdated,
  onReviewed,
  onActionConfirmed,
}: {
  items: Array<Record<string, unknown>>;
  openById: Record<string, boolean>;
  onToggleOpen: (dancerId: string) => void;
  onKeepOpen: (dancerId: string) => void;
  onSocialReviewed: (dancerId: string, targetId: string, status: "approved" | "rejected", notes: string) => void;
  onProfileUpdated: (profile: Record<string, unknown>) => void;
  onReviewed: (dancerId: string) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [selectedProfile, setSelectedProfile] = useState<Record<string, unknown> | null>(null);
  const [selectedProfileStatus, setSelectedProfileStatus] = useState("");
  const [deletingContentKey, setDeletingContentKey] = useState("");

  if (!items.length) return <p className="empty">No real pending dancer applications.</p>;

  async function openFullProfile(item: Record<string, unknown>) {
    setSelectedProfile(item);
    setSelectedProfileStatus("Loading full profile...");
    try {
      const detail = await requestAdminDancerProfile(asText(item.id));
      setSelectedProfile(detail);
      setSelectedProfileStatus("");
    } catch (error) {
      setSelectedProfileStatus(error instanceof Error ? error.message : "Unable to load dancer profile.");
    }
  }

  async function deleteProfileContent(kind: "photo" | "social-link", targetId: string, label: string) {
    if (!selectedProfile) return;
    const dancerId = asText(selectedProfile.id);
    const confirmed = window.confirm(
      `Permanently delete ${label} from ${asText(selectedProfile.stageName || selectedProfile.stage_name) || "this dancer"}'s profile? This cannot be undone.`,
    );
    if (!confirmed) return;

    const key = `${kind}:${targetId}`;
    setDeletingContentKey(key);
    setSelectedProfileStatus(`Deleting ${kind === "photo" ? "picture" : "social link"}...`);
    try {
      const updated = await requestAdminDancerContentDeletion(dancerId, kind, targetId);
      setSelectedProfile(updated.profile);
      onProfileUpdated(updated.profile);
      setSelectedProfileStatus("");
      onActionConfirmed(`${label} deleted from the dancer profile.`);
    } catch (error) {
      setSelectedProfileStatus(error instanceof Error ? error.message : `Unable to delete ${label}.`);
    } finally {
      setDeletingContentKey("");
    }
  }

  async function rejectProfile(dancerId: string) {
    setStatusById((current) => ({ ...current, [dancerId]: "Saving..." }));
    try {
      await requestAdminJson("/api/admin/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dancerId, status: "rejected", notes: notesById[dancerId] || null }),
        fallbackMessage: "Unable to review profile.",
      });

      const confirmation = "Dancer profile rejected successfully.";
      setStatusById((current) => ({ ...current, [dancerId]: confirmation }));
      onActionConfirmed(confirmation);
      onReviewed(dancerId);
    } catch (error) {
      setStatusById((current) => ({
        ...current,
        [dancerId]: error instanceof Error ? error.message : "Unable to review profile. Check your connection and try again.",
      }));
    }
  }

  return (
    <div className="approval-list">
      {items.map((item) => {
        const dancerId = String(item.id || "");
        const stageName = asText(item.stageName || item.stage_name);
        const city = asText(item.city);
        const status = asText(item.status);
        const isOpen = Boolean(openById[dancerId]);
        const pendingItems = pendingSubmittedContent(item);
        const hasPendingItems = pendingItems.length > 0;
        const reviewStatus = statusById[dancerId] || "";
        const isSaving = reviewStatus === "Saving...";
        return (
          <div className="approval-row" key={dancerId}>
            <div className="approval-summary">
              <span>
                <button className="admin-profile-name-link" type="button" onClick={() => openFullProfile(item)}>
                  {stageName || "Stage name not submitted"}
                </button>
                <small>{[city || "City not submitted", status || "pending"].join(" - ")}</small>
              </span>
              <button
                className="secondary-action"
                type="button"
                onClick={() => onToggleOpen(dancerId)}
              >
                {isOpen ? "Hide submission" : "View submission"}
              </button>
            </div>
            {isOpen ? (
              <SubmissionDetails
                item={item}
                onKeepOpen={() => onKeepOpen(dancerId)}
                onSocialReviewed={onSocialReviewed}
                onActionConfirmed={onActionConfirmed}
              />
            ) : null}
            {hasPendingItems ? <p className="approval-blocked">Review pending items first: {pendingItems.join(", ")}.</p> : null}
            <textarea
              placeholder="Review notes"
              rows={2}
              value={notesById[dancerId] || ""}
              onChange={(event) => setNotesById((current) => ({ ...current, [dancerId]: event.target.value }))}
            />
            <div className="approval-actions">
              <button className="secondary-action" type="button" onClick={() => openFullProfile(item)}>
                View full profile
              </button>
              <button type="button" onClick={() => rejectProfile(dancerId)} disabled={isSaving}>
                {isSaving ? "Saving..." : "Reject profile"}
              </button>
            </div>
            {reviewStatus ? <p role="status" aria-live="polite">{reviewStatus}</p> : null}
          </div>
        );
      })}
      {selectedProfile ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label="Full dancer profile" onClick={() => {
          if (!deletingContentKey) setSelectedProfile(null);
        }}>
          <div className="admin-preview-modal admin-profile-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-preview-close"
              type="button"
              onClick={() => setSelectedProfile(null)}
              aria-label="Close full profile"
              disabled={Boolean(deletingContentKey)}
            >
              ×
            </button>
            <h3>{`${asText(selectedProfile.stageName || selectedProfile.stage_name) || "Dancer"} — full profile`}</h3>
            {selectedProfileStatus ? <p role={selectedProfileStatus.startsWith("Unable") ? "alert" : "status"}>{selectedProfileStatus}</p> : null}
            {selectedProfileStatus !== "Loading full profile..." ? (
              <AdminDancerFullProfile
                profile={selectedProfile}
                activeTab="all"
                deletingContentKey={deletingContentKey}
                onDeletePhoto={(targetId, label) => deleteProfileContent("photo", targetId, label)}
                onDeleteSocial={(targetId, label) => deleteProfileContent("social-link", targetId, label)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AdminPreview = {
  kind: "image" | "file" | "link";
  title: string;
  url: string;
};

type ReviewFeedback = {
  tone: "working" | "success" | "error";
  message: string;
};

function SubmissionDetails({
  item,
  onKeepOpen,
  onSocialReviewed,
  onActionConfirmed,
}: {
  item: Record<string, unknown>;
  onKeepOpen: () => void;
  onSocialReviewed: (dancerId: string, targetId: string, status: "approved" | "rejected", notes: string) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const photos = labelSubmittedPhotos(asRecordArray(item.photos));
  const socials = normalizeSubmissionSocials(item);
  const reviews = asRecordArray(item.reviews);
  const dancerId = asText(item.id);
  const submittedBy = asText(item.stageName || item.stage_name) || "this dancer";
  const [reasonByKey, setReasonByKey] = useState<Record<string, string>>({});
  const [statusByKey, setStatusByKey] = useState<Record<string, string>>({});
  const [feedbackByKey, setFeedbackByKey] = useState<Record<string, ReviewFeedback>>({});
  const [workingByKey, setWorkingByKey] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<AdminPreview | null>(null);

  function openPreview(event: MouseEvent<HTMLAnchorElement>, nextPreview: AdminPreview) {
    event.preventDefault();
    if (!nextPreview.url || nextPreview.url === "#") return;
    setPreview(nextPreview);
  }

  async function reviewContent(
    event: MouseEvent<HTMLButtonElement>,
    targetType: "photo" | "social_link",
    targetId: string,
    status: "approved" | "rejected",
    label: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    onKeepOpen();
    const key = `${targetType}:${targetId}`;
    const notes = reasonByKey[key]?.trim() || "";
    if (status === "rejected" && !notes) {
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "error", message: "Add a reason before disapproving this item." },
      }));
      return;
    }

    setWorkingByKey((current) => ({ ...current, [key]: true }));
    setFeedbackByKey((current) => ({
      ...current,
      [key]: { tone: "working", message: "Saving review..." },
    }));

    try {
      const data = await requestAdminJson("/api/admin/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review_content",
          dancerId,
          targetType,
          targetId,
          status,
          notes,
          label,
        }),
        fallbackMessage: "Unable to save this review.",
      });

      const responseStatus = asText(data.review?.status);
      const savedStatus = responseStatus === "approved" || responseStatus === "rejected" ? responseStatus : status;
      const confirmation = `${label} ${savedStatus === "approved" ? "approved" : "rejected"} successfully.`;
      setStatusByKey((current) => ({ ...current, [key]: savedStatus }));
      if (targetType === "social_link") {
        onSocialReviewed(dancerId, targetId, savedStatus, notes);
      }
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "success", message: confirmation },
      }));
      onActionConfirmed(confirmation);
      onKeepOpen();
    } catch (error) {
      setFeedbackByKey((current) => ({
        ...current,
        [key]: {
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to save this review. Check your connection and try again.",
        },
      }));
    } finally {
      onKeepOpen();
      setWorkingByKey((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <div className="submission-detail">
      <section className="submission-section">
        <h3>Profile information</h3>
        <div className="submission-grid">
          <SubmissionValue label="Stage name" value={item.stageName || item.stage_name} />
          <SubmissionValue label="City" value={item.city} />
          <SubmissionValue label="Slug" value={item.slug} />
          <SubmissionValue label="Profile status" value={item.status} />
          <SubmissionValue label="Identity review" value={item.verificationStatus || item.verification_status} />
          <SubmissionValue label="Photo review" value={item.photoReviewStatus || item.photo_review_status} />
          <SubmissionValue label="Submitted" value={formatDate(item.createdAt || item.created_at)} />
        </div>
      </section>

      <section className="submission-section">
        <h3>Photos submitted</h3>
        {photos.length ? (
          <div className="submission-media-grid">
            {photos.map((photo, index) => {
              const imageUrl = asText(photo.imageUrl || photo.image_url);
              const storagePath = asText(photo.storagePath || photo.storage_path);
              const photoId = asText(photo.id);
              const targetId = photoId;
              const key = `photo:${targetId}`;
              const status = statusByKey[key] || asText(photo.reviewStatus || photo.review_status) || "pending";
              const feedback = feedbackByKey[key];
              const isWorking = Boolean(workingByKey[key]);
              const reason = asText(photo.reviewNotes || photo.review_notes);
              const isApproved = status === "approved";
              const isDisapproved = status === "rejected";
              const label = asText(photo.displayLabel) || adminPhotoLabel(photos, photo);
              return (
                <div className="submission-review-card" key={photoId || storagePath || imageUrl || `${dancerId}-photo-missing-id`}>
                  <a
                    className="submission-thumb"
                    href={imageUrl || "#"}
                    onClick={(event) => openPreview(event, { kind: "image", title: `Submitted dancer ${label}`, url: imageUrl })}
                  >
                    {imageUrl ? <img src={imageUrl} alt={`Submitted dancer ${label}`} /> : <span>No image URL</span>}
                    <small>{status}</small>
                  </a>
                  <small>Submitted by {submittedBy}</small>
                  {!targetId ? <small>Missing photo ID. Refresh the queue before approving this picture.</small> : null}
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <small>Type the reason, then press Save disapproval.</small>
                  <div className="content-review-actions">
                    <button type="button" onClick={(event) => reviewContent(event, "photo", targetId, "approved", label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve picture"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "photo", targetId, "rejected", label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                  <ReviewFeedbackMessage feedback={feedback} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="submission-empty">No photos submitted.</p>
        )}
      </section>

      <section className="submission-section">
        <h3>Account approval</h3>
        <p className="submission-empty">Approval is based on the dancer&apos;s venue affiliation and profile and media review.</p>
      </section>

      <section className="submission-section">
        <h3>Social links</h3>
        {socials.length ? (
          <div className="submitted-social-review-list">
            {socials.map((social, index) => {
              const targetId = asText(social.id);
              const key = `social_link:${targetId}`;
              const status = statusByKey[key] || asText(social.reviewStatus) || "pending";
              const feedback = feedbackByKey[key];
              const isWorking = Boolean(workingByKey[key]);
              const reason = asText(social.reviewNotes);
              const isApproved = status === "approved";
              const isDisapproved = status === "rejected";
              return (
                <div
                  className={`submitted-social-review ${isApproved ? "is-approved" : isDisapproved ? "is-rejected" : ""}`}
                  key={targetId || `${social.platform}-${index}`}
                >
                  <a
                    className={`submitted-social-icon social-${social.platform}`}
                    href={social.url || "#"}
                    onClick={(event) => openPreview(event, { kind: "link", title: `${social.label} link`, url: social.url || "" })}
                    aria-label={`${social.label}: ${social.handle ? `@${social.handle.replace(/^@/, "")}` : social.url || "submitted social"}`}
                    title={`${social.label}${social.handle ? ` @${social.handle.replace(/^@/, "")}` : ""}`}
                  >
                    <SubmittedSocialIcon platform={social.platform} />
                  </a>
                  <small className={`submitted-social-review-status ${isApproved ? "is-approved" : isDisapproved ? "is-rejected" : ""}`}>
                    {social.label} / {isApproved ? "✓ Approved" : isDisapproved ? "Disapproved" : "Pending review"}
                  </small>
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <div className="content-review-actions">
                    <button type="button" onClick={(event) => reviewContent(event, "social_link", targetId, "approved", social.label)} disabled={!targetId || isWorking || isApproved}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve social"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "social_link", targetId, "rejected", social.label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                  <ReviewFeedbackMessage feedback={feedback} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="submission-empty">No social links submitted.</p>
        )}
      </section>

      <section className="submission-section">
        <h3>Review history</h3>
        {reviews.length ? (
          <div className="submission-files">
            {reviews.map((review, index) => (
              <div className="submission-link" key={asText(review.id) || index}>
                <strong>{asText(review.reviewType || review.review_type) || "Review"}</strong>
                <small>
                  {asText(review.status) || "pending"}
                  {asText(review.notes) ? ` - ${asText(review.notes)}` : ""}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="submission-empty">No prior review notes.</p>
        )}
      </section>

      <details className="submission-json">
        <summary>Full submitted record</summary>
        <pre>{JSON.stringify(item, null, 2)}</pre>
      </details>
      {preview ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label={preview.title} onClick={() => setPreview(null)}>
          <div className="admin-preview-modal" onClick={(event) => event.stopPropagation()}>
            <button className="admin-preview-close" type="button" onClick={() => setPreview(null)} aria-label="Close preview">
              ×
            </button>
            <h3>{preview.title}</h3>
            {preview.kind === "image" ? (
              <img src={preview.url} alt={preview.title} />
            ) : preview.kind === "file" ? (
              <iframe src={preview.url} title={preview.title} />
            ) : (
              <div className="admin-preview-link">
                <strong>Submitted link</strong>
                <p>{preview.url}</p>
                <a href={preview.url} target="_blank" rel="noreferrer">
                  Open link
                </a>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReviewFeedbackMessage({ feedback }: { feedback?: ReviewFeedback }) {
  if (!feedback) return null;
  return (
    <p
      className={`review-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {feedback.tone === "success" ? <span aria-hidden="true">✓</span> : null}
      {feedback.message}
    </p>
  );
}

function labelSubmittedPhotos(photos: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const primary = photos.find((photo) => photo.isPrimary || photo.is_primary);
  const ordered = primary ? [primary, ...photos.filter((photo) => photo !== primary)] : photos;
  return ordered.map((photo, index) => ({
    ...photo,
    displayLabel: index === 0 ? "Main Photo" : `Photo ${index + 1}`,
  }));
}

function adminPhotoLabel(photos: Array<Record<string, unknown>>, photo: Record<string, unknown>) {
  const index = photos.findIndex((item) => asText(item.id) === asText(photo.id) && asText(item.id));
  if (index >= 0) return index === 0 ? "Main Photo" : `Photo ${index + 1}`;
  return photo.isPrimary || photo.is_primary ? "Main Photo" : "Photo";
}

function pendingSubmittedContent(item: Record<string, unknown>) {
  void item;
  return [];
}

function SubmittedSocialIcon({ platform }: { platform: string }) {
  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="3.4" />
        <path d="M17.2 6.8h.01" />
      </svg>
    );
  }
  if (platform === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.8 3c.3 2.5 1.8 4.1 4.2 4.4v3.2c-1.6 0-3-.5-4.2-1.4v6.1c0 3.3-2.3 5.7-5.5 5.7A5.2 5.2 0 0 1 5 15.8c0-3.1 2.4-5.4 5.5-5.4.4 0 .8 0 1.1.1v3.4a2.6 2.6 0 0 0-1.2-.3 2.1 2.1 0 0 0-2.1 2.2c0 1.3.9 2.2 2.1 2.2s2.1-.9 2.1-2.4V3h3.3Z" />
      </svg>
    );
  }
  if (platform === "snapchat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2c2.7 0 4.6 2 4.6 4.8v2.5c0 .6.5.9 1.1 1.1.6.2 1.2.4 1.2.9 0 .6-.7.9-1.5 1.1-.4.1-.5.4-.3.8.6 1.1 1.5 1.8 2.7 2.1.3.1.4.5.2.8-.8.7-1.8.8-2.5.8-.5 0-.8.2-1.1.6-.6.7-1.3 1.1-2.2 1.1-.7 0-1.2-.2-1.7-.5a1.1 1.1 0 0 0-1.1 0c-.5.3-1 .5-1.7.5-.9 0-1.6-.4-2.2-1.1-.3-.4-.6-.6-1.1-.6-.7 0-1.7-.1-2.5-.8-.2-.3-.1-.7.2-.8 1.2-.3 2.1-1 2.7-2.1.2-.4.1-.7-.3-.8-.8-.2-1.5-.5-1.5-1.1 0-.5.6-.7 1.2-.9.6-.2 1.1-.5 1.1-1.1V8c0-2.8 1.9-4.8 4.6-4.8Z" />
      </svg>
    );
  }
  if (platform === "onlyfans") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9.2" cy="12" r="5.4" />
        <circle cx="9.2" cy="12" r="2.15" className="logo-cutout" />
        <path d="M13.9 8.2h6.2c.5 0 .8.5.6 1l-1 2.2c-.1.3-.4.5-.7.5h-3.2l-1.1 3.9c-.1.4-.5.7-.9.7h-3.1l2.3-7.5c.1-.5.5-.8.9-.8Z" />
      </svg>
    );
  }
  if (platform === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4l14 16" />
        <path d="M19 4 5 20" />
      </svg>
    );
  }
  return <span aria-hidden="true">{platform.slice(0, 1).toUpperCase() || "S"}</span>;
}

function normalizeSubmissionSocials(item: Record<string, unknown>) {
  const rawLinks = asRecordArray(item.socialLinks || item.social_links);
  const mappedLinks: Array<Record<string, unknown>> = rawLinks.length
    ? rawLinks
    : Object.entries((item.socials || {}) as Record<string, unknown>).map(([platform, value]) => ({ platform, url: value, handle: value }));

  return mappedLinks
    .filter((social) => social.isActive !== false && social.is_active !== false)
    .map((social) => {
      const platform = asText(social.platform || social.type).toLowerCase();
      const url = asText(social.url || social.href);
      const handle = asText(social.handle || social.username || social.value) || socialHandleFromUrl(url);
      return {
        id: asText(social.id),
        platform,
        label: socialPlatformLabel(platform),
        handle,
        url,
        reviewStatus: asText(social.reviewStatus || social.review_status),
        reviewNotes: asText(social.reviewNotes || social.review_notes),
      };
    })
    .filter((social) => social.platform && (social.handle || social.url));
}

async function requestAdminDancerProfile(dancerId: string) {
  const token = readToken();
  if (!dancerId || !token) throw new Error("Admin sign in required.");

  const response = await fetch(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok || !data.ok || !data.profile) {
    throw new Error(data.error || "Unable to load dancer profile.");
  }
  return data.profile as Record<string, unknown>;
}

async function requestAdminDancerContentDeletion(
  dancerId: string,
  kind: "photo" | "social-link",
  targetId: string,
) {
  const token = readToken();
  if (!dancerId || !targetId || !token) throw new Error("Admin sign in required.");

  const resource = kind === "photo" ? "photos" : "social-links";
  const response = await fetch(
    `/api/admin/dancers/${encodeURIComponent(dancerId)}/${resource}/${encodeURIComponent(targetId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    },
  );
  const data = await response.json();
  if (!response.ok || !data.ok || !data.profile) {
    throw new Error(data.error || `Unable to delete dancer ${kind}.`);
  }
  return data as { profile: Record<string, unknown>; deleted: Record<string, unknown> };
}

function DancerDirectory({
  onDeleted,
  onProfileUpdated,
  onActionConfirmed,
}: {
  onDeleted: (dancerId: string) => void;
  onProfileUpdated: (profile: Record<string, unknown>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [roster, setRoster] = useState<AdminDancerRosterResult | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [moderationFilter, setModerationFilter] = useState("all");
  const [commissionFilter, setCommissionFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isLoadingRoster, setIsLoadingRoster] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingLifecycle, setIsUpdatingLifecycle] = useState(false);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [detailTab, setDetailTab] = useState("overview");
  const [deletingContentKey, setDeletingContentKey] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, statusFilter, scheduleFilter, moderationFilter, commissionFilter, sourceFilter, cityFilter, venueFilter, sort]);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setStatus("Admin sign in required.");
      setIsLoadingRoster(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: debouncedQuery,
      status: statusFilter,
      schedule: scheduleFilter,
      moderation: moderationFilter,
      commission: commissionFilter,
      source: sourceFilter,
      city: cityFilter,
      venueId: venueFilter,
      sort,
      page: String(page),
      pageSize: "20",
    });
    setIsLoadingRoster(true);
    setStatus("");
    fetch(`/api/admin/dancers?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok || !data.roster) throw new Error(data.error || "Unable to load dancer roster.");
        if (page > data.roster.totalPages) {
          setPage(Math.max(1, data.roster.totalPages));
          return;
        }
        setRoster(data.roster);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(error instanceof Error ? error.message : "Unable to load dancer roster.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingRoster(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, statusFilter, scheduleFilter, moderationFilter, commissionFilter, sourceFilter, cityFilter, venueFilter, sort, page, refreshVersion]);

  async function openProfile(item: Record<string, unknown>) {
    const dancerId = asText(item.id);
    const token = readToken();
    if (!dancerId || !token) {
      setStatus("Admin sign in required.");
      return;
    }

    setSelectedId(dancerId);
    setProfile(null);
    setDetailTab("overview");
    setLifecycleReason("");
    setStatus("Loading full profile...");
    try {
      const detail = await requestAdminDancerProfile(dancerId);
      setProfile(detail);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load dancer profile.");
    }
  }

  async function updateLifecycle(action: "disable" | "reactivate") {
    if (!profile) return;
    const dancerId = asText(profile.id);
    const token = readToken();
    if (!token || !dancerId) return;
    if (lifecycleReason.trim().length < 4) {
      setStatus("Add a short reason before changing profile access.");
      return;
    }
    setIsUpdatingLifecycle(true);
    setStatus(action === "disable" ? "Disabling profile..." : "Reactivating profile...");
    try {
      const response = await fetch(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action, reason: lifecycleReason.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.profile) throw new Error(data.error || "Unable to update dancer lifecycle.");
      setProfile(data.profile);
      onProfileUpdated(data.profile);
      setLifecycleReason("");
      setRefreshVersion((value) => value + 1);
      setStatus("");
      onActionConfirmed(action === "disable" ? "Dancer profile disabled and hidden." : "Dancer profile reactivated using its saved approval state.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update dancer lifecycle.");
    } finally {
      setIsUpdatingLifecycle(false);
    }
  }

  async function deleteProfileContent(kind: "photo" | "social-link", targetId: string, label: string) {
    if (!profile) return;
    const dancerId = asText(profile.id);
    const stageName = asText(profile.stageName || profile.stage_name) || "this dancer";
    const confirmed = window.confirm(
      `Permanently delete ${label} from ${stageName}'s profile? This cannot be undone.`,
    );
    if (!confirmed) return;

    const key = `${kind}:${targetId}`;
    setDeletingContentKey(key);
    setStatus(`Deleting ${kind === "photo" ? "picture" : "social link"}...`);
    try {
      const updated = await requestAdminDancerContentDeletion(dancerId, kind, targetId);
      setProfile(updated.profile);
      onProfileUpdated(updated.profile);
      setRefreshVersion((value) => value + 1);
      setStatus("");
      onActionConfirmed(`${label} deleted from ${stageName}'s profile.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Unable to delete ${label}.`);
    } finally {
      setDeletingContentKey("");
    }
  }

  function closeProfile() {
    if (isDeleting || deletingContentKey) return;
    setSelectedId("");
    setProfile(null);
    setStatus("");
  }

  async function deleteProfile(item: Record<string, unknown>) {
    const dancerId = asText(item.id);
    const stageName = asText(item.stageName || item.stage_name) || "this dancer";
    const token = readToken();
    if (!dancerId || !token) {
      setStatus("Admin sign in required.");
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${stageName}'s dancer profile, profile photos, any legacy identity files, schedules, and profile activity? Their login account will remain. This cannot be undone.`,
    );
    if (!confirmed) return;
    const typedName = window.prompt(`Type ${stageName} to permanently delete this profile.`);
    if (typedName !== stageName) {
      setStatus("Permanent deletion canceled because the stage name did not match.");
      return;
    }

    setIsDeleting(true);
    setStatus("Deleting profile and stored content...");
    try {
      const response = await fetch(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to delete dancer profile.");

      onDeleted(dancerId);
      setRefreshVersion((value) => value + 1);
      const warningCount = Array.isArray(data.deleted?.warnings) ? data.deleted.warnings.length : 0;
      onActionConfirmed(
        warningCount
          ? `${stageName}'s profile was deleted. ${warningCount} storage cleanup warning${warningCount === 1 ? "" : "s"} were logged.`
          : `${stageName}'s profile and stored content were deleted. The login account remains.`,
      );
      setSelectedId("");
      setProfile(null);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete dancer profile.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="dancer-management">
      <div className="dancer-roster-summary">
        <span><strong>{roster?.total ?? 0}</strong><small>matching profiles</small></span>
        <span><strong>{roster?.items.filter((item) => item.schedule.state === "working_now").length ?? 0}</strong><small>working now on page</small></span>
        <span><strong>{roster?.items.filter((item) => item.openReports > 0).length ?? 0}</strong><small>reported on page</small></span>
      </div>
      <div className="dancer-roster-filters" role="search" aria-label="Search and filter dancer profiles">
        <label className="dancer-roster-search"><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Stage name, city, email, or slug" /></label>
        <RosterSelect label="Profile state" value={statusFilter} onChange={setStatusFilter} options={[["all", "All profiles"], ["needs_action", "Needs action"], ["draft", "Draft"], ["pending_review", "Pending"], ["approved", "Live"], ["rejected", "Rejected"], ["disabled", "Disabled / archived"]]} />
        <RosterSelect label="Schedule" value={scheduleFilter} onChange={setScheduleFilter} options={[["all", "Any schedule"], ["working_now", "Working now"], ["upcoming", "Upcoming"], ["no_schedule", "No schedule"]]} />
        <RosterSelect label="Moderation" value={moderationFilter} onChange={setModerationFilter} options={[["all", "Any moderation"], ["pending", "Pending review"], ["clear", "No pending review"]]} />
        <RosterSelect label="Commission" value={commissionFilter} onChange={setCommissionFilter} options={[["all", "Any commission state"], ["active", "NATS active"], ["not_active", "NATS not active"]]} />
        <RosterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={[["all", "Demo and standard"], ["demo", "Demo assignments"], ["standard", "Standard profiles"]]} />
        <RosterSelect label="City" value={cityFilter} onChange={setCityFilter} options={[["", "All cities"], ...(roster?.filters.cities || []).map((city) => [city, city] as [string, string])]} />
        <RosterSelect label="Club" value={venueFilter} onChange={setVenueFilter} options={[["", "All clubs"], ...(roster?.filters.venues || []).map((venue) => [venue.id, `${venue.name} · ${venue.city}`] as [string, string])]} />
        <RosterSelect label="Sort" value={sort} onChange={setSort} options={[["updated", "Recently active"], ["created", "Newest profiles"], ["name", "Stage name"], ["status", "Profile state"]]} />
        <button className="secondary-action dancer-roster-clear" type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setScheduleFilter("all"); setModerationFilter("all"); setCommissionFilter("all"); setSourceFilter("all"); setCityFilter(""); setVenueFilter(""); setSort("updated"); }}>Clear filters</button>
      </div>
      {status ? <p className="dancer-roster-status" role={status.startsWith("Unable") ? "alert" : "status"}>{status}</p> : null}
      {isLoadingRoster ? <p className="empty">Loading dancer roster…</p> : null}
      {!isLoadingRoster && !roster?.items.length ? <p className="empty">No dancer profiles match these filters.</p> : null}
      <div className="dancer-directory-list" aria-busy={isLoadingRoster}>
      {(roster?.items || []).map((item) => {
        const dancerId = item.id;
        const stageName = item.stageName || "Stage name not submitted";
        return (
          <article className="dancer-directory-row" key={dancerId}>
            <button className="dancer-directory-profile-link" type="button" onClick={() => openProfile(item as unknown as Record<string, unknown>)}>
              <span className="dancer-roster-avatar">{item.avatarUrl ? <img src={item.avatarUrl} srcSet={item.avatarSrcSet || undefined} alt="" /> : <span>{stageName.slice(0, 1).toUpperCase()}</span>}</span>
              <span className="dancer-roster-identity"><strong>{stageName}</strong><small>{item.email || "No account email"}</small><small>{item.city}{item.venue ? ` · ${item.venue.name}` : " · No active club"}</small></span>
              <span className="dancer-roster-badges"><RosterBadge value={item.status} /><RosterBadge value={item.schedule.state} />{item.isDemo ? <RosterBadge value="demo" /> : null}{item.openReports ? <RosterBadge value={`${item.openReports} open report${item.openReports === 1 ? "" : "s"}`} tone="danger" /> : null}</span>
            </button>
            <div className="dancer-roster-data">
              <span><small>Media</small><strong>{item.media.approved} approved · {item.media.pending} pending</strong></span>
              <span><small>Affiliations</small><strong>{item.affiliationCount}</strong></span>
              <span><small>Commission</small><strong>{labelize(item.commissionStatus)}</strong></span>
              <span><small>Last activity</small><strong>{formatDate(item.lastActivityAt)}</strong></span>
            </div>
            <div className="dancer-directory-actions">
              <button className="secondary-action" type="button" onClick={() => openProfile(item as unknown as Record<string, unknown>)}>
                View full profile &amp; management
              </button>
            </div>
          </article>
        );
      })}
      </div>
      {roster && roster.totalPages > 1 ? <nav className="dancer-roster-pagination" aria-label="Dancer roster pages"><button type="button" className="secondary-action" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {roster.page} of {roster.totalPages}</span><button type="button" className="secondary-action" disabled={page >= roster.totalPages} onClick={() => setPage((value) => Math.min(roster.totalPages, value + 1))}>Next</button></nav> : null}
      {selectedId ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label="Full dancer profile" onClick={closeProfile}>
          <div className="admin-preview-modal admin-profile-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-preview-close"
              type="button"
              onClick={closeProfile}
              aria-label="Close full profile"
              disabled={isDeleting || Boolean(deletingContentKey)}
            >
              ×
            </button>
            <h3>{profile ? `${asText(profile.stageName || profile.stage_name) || "Dancer"} — full profile` : "Full dancer profile"}</h3>
            {status ? <p role={status.startsWith("Unable") ? "alert" : "status"}>{status}</p> : null}
            {profile ? (
              <>
              <nav className="admin-dancer-tabs" aria-label="Dancer management sections">
                {[["overview", "Overview"], ["media", "Profile & media"], ["affiliations", "Clubs & shifts"], ["commissions", "Club Deals & commissions"], ["analytics", "Analytics & reports"], ["history", "History"]].map(([id, label]) => <button type="button" key={id} className={detailTab === id ? "active" : ""} onClick={() => setDetailTab(id)}>{label}</button>)}
              </nav>
              <AdminDancerFullProfile
                profile={profile}
                activeTab={detailTab}
                deletingContentKey={deletingContentKey}
                onDeletePhoto={(targetId, label) => deleteProfileContent("photo", targetId, label)}
                onDeleteSocial={(targetId, label) => deleteProfileContent("social-link", targetId, label)}
              />
              </>
            ) : null}
            {profile ? (
              <div className="admin-profile-delete-zone">
                <strong>Profile access and retention</strong>
                <p>Disable a profile for a reversible hold. Permanent deletion is reserved for verified deletion requests or required data removal.</p>
                <label><span>Required action reason</span><textarea value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} maxLength={500} placeholder="Why this profile is being disabled or reactivated" /></label>
                <div className="admin-profile-lifecycle-actions">
                  {asText(profile.status) === "disabled" ? <button className="secondary-action" type="button" onClick={() => updateLifecycle("reactivate")} disabled={isUpdatingLifecycle}>Reactivate profile</button> : <button className="danger-action" type="button" onClick={() => updateLifecycle("disable")} disabled={isUpdatingLifecycle}>Disable profile</button>}
                  <details><summary>Permanent deletion</summary><p>This removes profile data and stored media. The login account remains.</p><button className="danger-action" type="button" onClick={() => deleteProfile(profile)} disabled={isDeleting}>{isDeleting ? "Deleting profile..." : "Permanently delete profile"}</button></details>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RosterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id || "all"} value={id}>{text}</option>)}</select></label>;
}

function RosterBadge({ value, tone = "neutral" }: { value: string; tone?: "neutral" | "danger" }) {
  return <em className={`dancer-roster-badge ${tone} is-${value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>{labelize(value)}</em>;
}

function AdminDancerFullProfile({
  profile,
  activeTab,
  deletingContentKey,
  onDeletePhoto,
  onDeleteSocial,
}: {
  profile: Record<string, unknown>;
  activeTab: string;
  deletingContentKey: string;
  onDeletePhoto: (targetId: string, label: string) => void;
  onDeleteSocial: (targetId: string, label: string) => void;
}) {
  const account = asRecordObject(profile.account);
  const subscription = asRecordObject(profile.subscription);
  const photos = labelSubmittedPhotos(asRecordArray(profile.photos));
  const socials = asRecordArray(profile.socialLinks || profile.social_links);
  const reviews = asRecordArray(profile.reviews);
  const operations = asRecordObject(profile.operations);
  const affiliations = asRecordArray(operations.affiliations);
  const shifts = asRecordArray(operations.shifts);
  const videos = asRecordArray(operations.videos);
  const commissions = asRecordArray(operations.commissions);
  const reports = asRecordArray(operations.reports);
  const accountHistory = asRecordArray(operations.accountHistory || operations.account_history);
  const analytics = asRecordObject(operations.analytics);
  const natsAccount = asRecordObject(operations.natsAccount || operations.nats_account);

  return (
    <div className="admin-full-profile">
      {activeTab === "all" || activeTab === "overview" ? <section className="submission-section">
        <h3>Profile information</h3>
        <div className="submission-grid">
          <SubmissionValue label="Stage name" value={profile.stageName || profile.stage_name} />
          <SubmissionValue label="City" value={profile.city} />
          <SubmissionValue label="Slug" value={profile.slug} />
          <SubmissionValue label="Profile ID" value={profile.id} />
          <SubmissionValue label="User ID" value={profile.userId || profile.user_id} />
          <SubmissionValue label="Profile status" value={profile.status} />
          <SubmissionValue label="Public visibility" value={profile.isPublic === false || profile.is_public === false ? "Hidden" : "Visible"} />
          <SubmissionValue label="Approval review" value={profile.verificationStatus || profile.verification_status} />
          <SubmissionValue label="Photo review" value={profile.photoReviewStatus || profile.photo_review_status} />
          <SubmissionValue label="Created" value={formatDate(profile.createdAt || profile.created_at)} />
          <SubmissionValue label="Last updated" value={formatDate(profile.updatedAt || profile.updated_at)} />
          <SubmissionValue label="Approved" value={formatDate(profile.approvedAt || profile.approved_at)} />
          <SubmissionValue label="Disabled" value={formatDate(profile.disabledAt || profile.disabled_at)} />
        </div>
      </section> : null}

      {activeTab === "all" || activeTab === "overview" ? <section className="submission-section">
        <h3>Login account</h3>
        <div className="submission-grid">
          <SubmissionValue label="Email" value={account.email} />
          <SubmissionValue label="Display name" value={account.displayName || account.display_name} />
          <SubmissionValue label="Account state" value={account.accountState || account.account_state} />
          <SubmissionValue label="Account created" value={formatDate(account.createdAt || account.created_at)} />
        </div>
      </section> : null}

      {activeTab === "all" || activeTab === "overview" ? <section className="submission-section">
        <h3>Account approval</h3>
        <p className="submission-empty">MyDancr controls profile approval. Club affiliations are recorded separately from account and media decisions.</p>
      </section> : null}

      {activeTab === "all" || activeTab === "media" ? <section className="submission-section">
        <h3>Photos ({photos.length})</h3>
        {photos.length ? (
          <div className="submission-media-grid">
            {photos.map((photo, index) => {
              const imageUrl = asText(photo.imageUrl || photo.image_url);
              const photoId = asText(photo.id);
              const label = asText(photo.displayLabel) || `Photo ${index + 1}`;
              return (
                <div className="submission-thumb admin-managed-content" key={photoId || index}>
                  <a className="admin-managed-content-link" href={imageUrl || "#"} target="_blank" rel="noreferrer">
                    {imageUrl ? <img src={imageUrl} alt={label} /> : <span>No image URL</span>}
                    <strong>{label}</strong>
                    <small>{asText(photo.reviewStatus || photo.review_status) || "pending"}</small>
                  </a>
                  <button
                    className="danger-action"
                    type="button"
                    onClick={() => onDeletePhoto(photoId, label)}
                    disabled={!photoId || deletingContentKey === `photo:${photoId}`}
                  >
                    {deletingContentKey === `photo:${photoId}` ? "Deleting picture..." : "Delete picture"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : <p className="submission-empty">No profile photos.</p>}
      </section> : null}

      {activeTab === "all" || activeTab === "media" ? <section className="submission-section">
        <h3>Social links ({socials.length})</h3>
        {socials.length ? (
          <div className="submission-files">
            {socials.map((social, index) => {
              const socialId = asText(social.id);
              const label = asText(social.platform) || "Social link";
              return (
                <div className="submission-link admin-managed-content" key={socialId || index}>
                  <a className="admin-managed-content-link" href={asText(social.url) || "#"} target="_blank" rel="noreferrer">
                    <strong>{label}</strong>
                    <small>{asText(social.handle) || asText(social.url)}</small>
                    <small>{asText(social.reviewStatus || social.review_status) || "pending"}</small>
                  </a>
                  <button
                    className="danger-action"
                    type="button"
                    onClick={() => onDeleteSocial(socialId, `${label} social link`)}
                    disabled={!socialId || deletingContentKey === `social-link:${socialId}`}
                  >
                    {deletingContentKey === `social-link:${socialId}` ? "Deleting social..." : "Delete social link"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : <p className="submission-empty">No social links.</p>}
      </section> : null}

      {activeTab === "all" || activeTab === "media" ? <section className="submission-section">
        <h3>Videos ({videos.length})</h3>
        {videos.length ? <div className="submission-files">{videos.map((video, index) => <div className="submission-link" key={asText(video.id) || index}><strong>{asText(video.status) || "Unknown state"}</strong><small>{formatValue(video.duration_seconds || video.durationSeconds)} seconds</small><small>{formatDate(video.published_at || video.publishedAt || video.created_at || video.createdAt)}</small></div>)}</div> : <p className="submission-empty">No uploaded videos.</p>}
      </section> : null}

      {activeTab === "all" || activeTab === "overview" ? <section className="submission-section">
        <h3>Subscription</h3>
        {Object.keys(subscription).length ? (
          <div className="submission-grid">
            <SubmissionValue label="Status" value={subscription.status} />
            <SubmissionValue label="Period end" value={formatDate(subscription.currentPeriodEnd || subscription.current_period_end)} />
            <SubmissionValue label="Stripe customer" value={subscription.stripeCustomerId || subscription.stripe_customer_id} />
            <SubmissionValue label="Stripe subscription" value={subscription.stripeSubscriptionId || subscription.stripe_subscription_id} />
          </div>
        ) : <p className="submission-empty">No subscription record.</p>}
      </section> : null}

      {activeTab === "all" || activeTab === "history" ? <section className="submission-section">
        <h3>Review history ({reviews.length})</h3>
        {reviews.length ? (
          <div className="submission-files">
            {reviews.map((review, index) => (
              <div className="submission-link" key={asText(review.id) || index}>
                <strong>{asText(review.reviewType || review.review_type) || "Review"} — {asText(review.status) || "pending"}</strong>
                <small>{asText(review.notes) || "No notes"}</small>
                <small>{formatDate(review.reviewedAt || review.reviewed_at || review.createdAt || review.created_at)}</small>
              </div>
            ))}
          </div>
        ) : <p className="submission-empty">No review history.</p>}
      </section> : null}

      {activeTab === "all" || activeTab === "affiliations" ? <>
        <section className="submission-section"><h3>Club affiliations ({affiliations.length})</h3>{affiliations.length ? <div className="submission-files">{affiliations.map((item, index) => { const venue = asRecordObject(item.venues); return <div className="submission-link" key={asText(item.id) || index}><strong>{asText(venue.name) || "Club"} · {labelize(asText(item.status))}</strong><small>{asText(venue.city) || "City unavailable"}</small><small>{formatDate(item.approved_at || item.approvedAt || item.revoked_at || item.revokedAt)}</small></div>; })}</div> : <p className="submission-empty">No club affiliations.</p>}</section>
        <section className="submission-section"><h3>Shift history ({shifts.length})</h3>{shifts.length ? <div className="submission-files">{shifts.map((item, index) => { const venue = asRecordObject(item.venues); return <div className="submission-link" key={asText(item.id) || index}><strong>{asText(venue.name) || "Club"} · {labelize(asText(item.status))}</strong><small>{formatDate(item.starts_at || item.startsAt)} to {formatDate(item.ends_at || item.endsAt)}</small><small>{labelize(asText(item.shift_source || item.shiftSource) || "scheduled")}</small></div>; })}</div> : <p className="submission-empty">No posted or historical shifts.</p>}</section>
      </> : null}

      {activeTab === "all" || activeTab === "commissions" ? <>
        <section className="submission-section"><h3>NATS payout eligibility</h3><div className="submission-grid"><SubmissionValue label="Link status" value={natsAccount.status || "Not linked"} /><SubmissionValue label="Username" value={natsAccount.username || "Not supplied"} /><SubmissionValue label="Activated" value={formatDate(natsAccount.activated_at || natsAccount.activatedAt)} /><SubmissionValue label="Last error" value={natsAccount.last_error || natsAccount.lastError || "None"} /></div></section>
        <section className="submission-section"><h3>Commission activity ({commissions.length})</h3>{commissions.length ? <div className="submission-files">{commissions.map((item, index) => <div className="submission-link" key={asText(item.id) || index}><strong>{formatMoneyFromCents(item.amount_cents || item.amountCents)} · {labelize(asText(item.status))}</strong><small>{formatDate(item.paid_at || item.paidAt || item.payable_at || item.payableAt || item.created_at || item.createdAt)}</small></div>)}</div> : <p className="submission-empty">No attributed commission activity.</p>}</section>
      </> : null}

      {activeTab === "all" || activeTab === "analytics" ? <>
        <section className="submission-section"><h3>Customer activity</h3><div className="submission-grid"><SubmissionValue label="Followers" value={analytics.followers} /><SubmissionValue label="Profile views" value={analytics.profileViews || analytics.profile_views} /><SubmissionValue label="Direction requests" value={analytics.directionRequests || analytics.direction_requests} /><SubmissionValue label="Active shifts" value={analytics.activeShifts || analytics.active_shifts} /><SubmissionValue label="Recorded commissions" value={formatMoneyFromCents(analytics.totalCommissionCents || analytics.total_commission_cents)} /></div></section>
        <section className="submission-section"><h3>Reports ({reports.length})</h3>{reports.length ? <div className="submission-files">{reports.map((item, index) => <div className="submission-link" key={asText(item.id) || index}><strong>{asText(item.reason) || "Report"} · {labelize(asText(item.status))}</strong><small>{asText(item.details) || "No additional details"}</small><small>{formatDate(item.created_at || item.createdAt)}</small></div>)}</div> : <p className="submission-empty">No reports against this profile.</p>}</section>
      </> : null}

      {activeTab === "all" || activeTab === "history" ? <section className="submission-section"><h3>Admin account history ({accountHistory.length})</h3>{accountHistory.length ? <div className="submission-files">{accountHistory.map((item, index) => <div className="submission-link" key={asText(item.id) || index}><strong>{labelize(asText(item.action) || "Admin action")}</strong><small>{asText(item.notes) || "No notes"}</small><small>{formatDate(item.created_at || item.createdAt)}</small></div>)}</div> : <p className="submission-empty">No administrative lifecycle history.</p>}</section> : null}
    </div>
  );
}

function withReviewedSocial(
  item: Record<string, unknown>,
  targetId: string,
  status: "approved" | "rejected",
  notes: string,
) {
  const socialLinks = asRecordArray(item.socialLinks || item.social_links).map((social) =>
    asText(social.id) === targetId
      ? {
          ...social,
          reviewStatus: status,
          reviewNotes: notes || null,
        }
      : social
  );

  return {
    ...item,
    socialLinks,
  };
}

function socialPlatformLabel(platform: string) {
  const labels: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    snapchat: "Snapchat",
    onlyfans: "OnlyFans",
    x: "X",
  };
  return labels[platform] || labelize(platform || "Social");
}

function socialHandleFromUrl(url: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop()?.replace(/^@/, "") || parsed.hostname;
  } catch {
    return url.replace(/^@/, "");
  }
}

function SubmissionValue({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) {
  const text = asText(value);
  return (
    <div className={wide ? "submission-value wide" : "submission-value"}>
      <span>{label}</span>
      <strong>{text || "Not submitted"}</strong>
    </div>
  );
}

function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function validAdminCoordinate(value: unknown, minimum: number, maximum: number) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum ? coordinate : null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function asRecordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function formatDate(value: unknown) {
  const text = asText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString();
}

function formatMoneyFromCents(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
}

function Panel({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={title === "Support Inbox" ? "admin-panel support-admin-panel" : "admin-panel"} open={defaultOpen || undefined}>
      <summary className="admin-panel-head">
        <h2>{title}</h2>
        <span className="admin-panel-summary-side">
          {badge ? <span className="admin-panel-badge">{badge}</span> : null}
          <span className="admin-panel-chevron" aria-hidden="true">⌄</span>
        </span>
      </summary>
      <div className="admin-panel-body">{children}</div>
    </details>
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

function ListPreview({ items, empty }: { items?: unknown[]; empty: string }) {
  if (!items?.length) return <p className="empty">{empty}</p>;
  return (
    <ul>
      {items.slice(0, 4).map((item, index) => (
        <li key={index}>{previewName(item)}</li>
      ))}
    </ul>
  );
}

function previewName(item: unknown) {
  if (!item || typeof item !== "object") return "Item";
  const record = item as Record<string, unknown>;
  return String(record.stageName || record.stage_name || record.name || record.email || record.status || "Item");
}

function previewDealName(item: Record<string, unknown>) {
  const deal = readFirst(item.club_deals);
  const venue = readFirst(item.venues);
  const dancer = readFirst(item.dancer_profiles);
  const dealTitle = deal ? String(deal.deal_title || "Club deal") : "Club deal";
  const venueName = venue ? String(venue.name || "Venue") : "Venue";
  const dancerName = dancer ? ` / ${String(dancer.stage_name || "Dancer")}` : "";
  return `${dealTitle} at ${venueName}${dancerName}`;
}

function previewCommission(item: Record<string, unknown>) {
  const commission = readFirst(item.commission_events);
  if (!commission) return "No dancer commission";
  return `Commission: ${String(commission.status || "pending")}`;
}

function adminLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function adminDollarsToCents(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents >= 100 && cents <= 100_000 ? cents : null;
}

function adminPayoutDollarsToCents(value: string) {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number.parseInt(match[1], 10) * 100 + Number.parseInt((match[2] || "").padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 10_000_000 ? cents : null;
}

function currentAdminReferralTerm(terms: Array<Record<string, unknown>>) {
  const now = Date.now();
  return terms.find((term) => (
    !term.supersededAt
    && Date.parse(asText(term.effectiveFrom)) <= now
    && (!term.effectiveUntil || Date.parse(asText(term.effectiveUntil)) > now)
  )) || null;
}

function adminReferralTermState(term: Record<string, unknown>) {
  if (term.supersededAt) return "Superseded";
  const now = Date.now();
  if (Date.parse(asText(term.effectiveFrom)) > now) return "Scheduled";
  if (term.effectiveUntil && Date.parse(asText(term.effectiveUntil)) <= now) return "Expired";
  return "Active";
}

function formatAdminCents(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.max(0, value) / 100);
}

function readFirst(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) || null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function readPersistedOpenApprovals(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(OPEN_APPROVALS_SESSION_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const restored: Record<string, boolean> = {};
    for (const [dancerId, open] of Object.entries(parsed)) {
      if (dancerId && open === true) restored[dancerId] = true;
    }
    return restored;
  } catch {
    return {};
  }
}

function persistOpenApprovals(openApprovalIds: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(OPEN_APPROVALS_SESSION_KEY, JSON.stringify(openApprovalIds));
  } catch {
    // The in-memory state still preserves expansion when session storage is unavailable.
  }
}

async function copyAdminText(value: string) {
  if (!value) throw new Error("Nothing to copy.");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Unable to copy.");
}

function labelize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return String(value.length);
  if (value && typeof value === "object") return String(Object.keys(value).length);
  return "0";
}

function AdminStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; min-width: 0; }
      .admin-shell { min-height: 100vh; padding: 22px clamp(12px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.16), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); overflow-x: hidden; }
      .top-nav, .admin-head, .admin-grid, .admin-warning, .sign-in { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .admin-logout { min-height: 40px; padding: 0 15px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; color: #fff; background: rgba(255,255,255,.075); font: inherit; font-weight: 900; cursor: pointer; box-shadow: 0 10px 28px rgba(0,0,0,.24); }
      .admin-logout:hover, .admin-logout:focus-visible { border-color: rgba(148,229,255,.7); background: rgba(34,199,255,.12); outline: none; }
      .admin-logout:disabled { opacity: .62; cursor: wait; }
      .admin-head { display: grid; gap: 14px; margin-bottom: 24px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(32px, 8vw, 76px); line-height: .94; letter-spacing: 0; overflow-wrap: anywhere; }
      h2 { margin: 0; font-size: clamp(18px, 4vw, 22px); line-height: 1.15; overflow-wrap: anywhere; }
      p { margin: 0; color: #cfc5de; font-size: clamp(14px, 3.8vw, 18px); line-height: 1.45; max-width: 58ch; overflow-wrap: anywhere; }
      .admin-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .admin-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: clamp(12px, 2.8vw, 16px); overflow: hidden; }
      .admin-panel-head { cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; list-style: none; }
      .admin-panel-head::-webkit-details-marker { display: none; }
      .admin-panel-head:focus-visible { border-radius: 8px; outline: 2px solid #94e5ff; outline-offset: 4px; }
      .admin-panel-summary-side { display: flex; align-items: center; gap: 9px; }
      .admin-panel-chevron { color: #b9accd; font-size: 22px; line-height: 1; transition: transform .18s ease; }
      .admin-panel[open] .admin-panel-chevron { transform: rotate(180deg); }
      .admin-panel-body { display: grid; gap: 10px; padding-top: 14px; }
      .admin-panel-badge { flex: 0 0 auto; padding: 6px 9px; border-radius: 999px; color: #090911; background: #94e5ff; font-size: 12px; font-weight: 950; white-space: nowrap; }
      .admin-warning { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid rgba(255,193,92,.38); border-radius: 8px; color: #fff4d8; background: rgba(99,63,13,.34); }
      .admin-warning > div { display: grid; gap: 7px; }
      .admin-warning ul { gap: 4px; }
      .admin-warning li { color: #f4ddb1; font-size: 13px; }
      .admin-warning button { flex: 0 0 auto; padding: 0 14px; color: #211506; background: #ffd98f; }
      .admin-action-toast { position: fixed; z-index: 120; top: 16px; left: 50%; width: min(520px, calc(100vw - 24px)); min-height: 56px; transform: translateX(-50%); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(50,255,164,.48); border-radius: 10px; color: #eafff4; background: #102b1c; box-shadow: 0 18px 56px rgba(0,0,0,.55); }
      .admin-action-toast > span { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 999px; color: #07140d; background: #32ffa4; font-weight: 950; }
      .admin-action-toast strong { overflow-wrap: anywhere; }
      .admin-action-toast button { width: 34px; min-height: 34px; padding: 0; border-radius: 999px; color: #eafff4; background: rgba(255,255,255,.08); font-size: 22px; line-height: 1; }
      .sign-in { max-width: 430px; }
      .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
      .segmented button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: transparent; font-weight: 900; cursor: pointer; }
      .segmented button.active { background: linear-gradient(135deg, rgba(139,92,246,.62), rgba(34,199,255,.22)); }
      .sign-in label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      input, select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      .password-control { position: relative; display: flex; align-items: center; }
      .password-control input { width: 100%; padding-right: 58px; }
      .password-control button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: #d8cfeb; background: rgba(255,255,255,.055); cursor: pointer; z-index: 2; }
      .password-control button[aria-pressed="true"], .password-control button:hover { color: #fff; background: rgba(155,92,255,.18); box-shadow: 0 0 16px rgba(155,92,255,.18); }
      .password-control svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; white-space: normal; line-height: 1.15; }
      .password-control button { width: 30px; min-width: 30px; max-width: 30px; height: 30px; min-height: 30px; padding: 0; }
      button:disabled { opacity: .62; cursor: wait; }
      .forgot-password { justify-self: end; min-height: auto; padding: 0; border: 0; background: transparent; color: #94e5ff; font-size: 13px; font-weight: 900; cursor: pointer; }
      .metric { min-height: 54px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span, .empty { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: clamp(17px, 4.4vw, 20px); overflow-wrap: anywhere; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      li { color: #d8cfeb; overflow-wrap: anywhere; }
      .approval-list { display: grid; gap: 12px; }
      .approval-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .approval-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .approval-summary span { display: grid; gap: 2px; min-width: 0; }
      .admin-profile-name-link, .dancer-directory-profile-link { appearance: none; width: fit-content; max-width: 100%; padding: 0; border: 0; color: #fff; background: transparent; font: inherit; text-align: left; text-decoration: underline; text-decoration-color: rgba(53,216,255,.46); text-underline-offset: 4px; cursor: pointer; }
      .admin-profile-name-link { font-weight: 950; }
      .admin-profile-name-link:hover, .admin-profile-name-link:focus-visible, .dancer-directory-profile-link:hover strong, .dancer-directory-profile-link:focus-visible strong { color: #8ceaff; text-decoration-color: #35d8ff; }
      .approval-summary small { color: #b9accd; font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .approval-row span { color: #b9accd; }
      .approval-row textarea { min-height: 72px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .approval-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .approval-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .approval-row .secondary-action { color: #f7f2ff; background: rgba(139,92,246,.16); border: 1px solid rgba(139,92,246,.34); }
      .approval-row p { color: #94e5ff; font-size: 14px; }
      .approval-blocked { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,214,102,.22); background: rgba(255,214,102,.08); color: #ffd666 !important; font-size: 13px !important; }
      .admin-panel:has(.dancer-management) { grid-column: 1 / -1; }
      .dancer-management { display: grid; gap: 14px; }
      .dancer-roster-summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
      .dancer-roster-summary > span { display: grid; gap: 2px; padding: 11px; border: 1px solid rgba(148,229,255,.14); border-radius: 9px; background: rgba(148,229,255,.035); }
      .dancer-roster-summary strong { color: #fff; font-size: 21px; }
      .dancer-roster-summary small { color: #9c90b3; font-size: 11px; font-weight: 850; }
      .dancer-roster-filters { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 9px; padding: 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.025); }
      .dancer-roster-filters label, .admin-profile-delete-zone label { display: grid; gap: 5px; color: #a99fba; font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
      .dancer-roster-filters input, .dancer-roster-filters select { width: 100%; background: #15151c; }
      .dancer-roster-filters option { color: #fff; background: #15151c; }
      .dancer-roster-search { grid-column: span 2; }
      .dancer-roster-clear { align-self: end; min-height: 42px; }
      .dancer-roster-status { max-width: none; padding: 10px 12px; border: 1px solid rgba(148,229,255,.2); border-radius: 8px; color: #d5f8ff; background: rgba(148,229,255,.05); font-size: 13px; }
      .dancer-directory-list { display: grid; gap: 10px; }
      .dancer-directory-row { display: grid; grid-template-columns: minmax(280px,1.2fr) minmax(340px,1fr) auto; align-items: center; gap: 12px; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .dancer-directory-row:hover { border-color: rgba(148,229,255,.25); background: rgba(148,229,255,.045); }
      .dancer-directory-profile-link { display: grid; grid-template-columns: 52px minmax(0,1fr); align-items: center; gap: 10px; width: 100%; text-decoration: none; }
      .dancer-roster-avatar { grid-row: span 2; display: grid; place-items: center; width: 52px; height: 52px; overflow: hidden; border: 1px solid rgba(148,229,255,.26); border-radius: 999px; color: #fff; background: rgba(139,92,246,.16); font-size: 20px; font-weight: 950; }
      .dancer-roster-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .dancer-roster-identity { display: grid; gap: 2px; }
      .dancer-roster-badges { grid-column: 2; display: flex; flex-wrap: wrap; gap: 5px; }
      .dancer-roster-badge { padding: 4px 7px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #cfc5de; background: rgba(255,255,255,.045); font-size: 9px; font-style: normal; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; }
      .dancer-roster-badge.is-approved, .dancer-roster-badge.is-working-now { color: #8dffc4; border-color: rgba(50,255,164,.28); background: rgba(50,255,164,.07); }
      .dancer-roster-badge.is-pending-review, .dancer-roster-badge.is-upcoming { color: #94e5ff; border-color: rgba(148,229,255,.25); background: rgba(148,229,255,.06); }
      .dancer-roster-badge.is-disabled, .dancer-roster-badge.danger { color: #ffb3bf; border-color: rgba(255,104,124,.3); background: rgba(255,104,124,.07); }
      .dancer-roster-badge.is-demo { color: #d8c4ff; border-color: rgba(155,92,255,.35); background: rgba(155,92,255,.1); }
      .dancer-roster-data { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }
      .dancer-roster-data > span { display: grid; gap: 2px; }
      .dancer-roster-data small { color: #857a98; font-size: 9px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
      .dancer-roster-data strong { color: #d8cfeb; font-size: 11px; }
      .dancer-directory-row strong { color: #fff; overflow-wrap: anywhere; }
      .dancer-directory-row small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .dancer-directory-actions { display: grid; gap: 8px; }
      .dancer-directory-actions button { min-height: 40px; padding: 8px 10px; }
      .dancer-roster-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; }
      .dancer-roster-pagination span { color: #b9accd; font-size: 12px; font-weight: 900; }
      .dancer-roster-pagination button { padding: 0 14px; }
      .secondary-action { color: #f7f2ff; background: rgba(139,92,246,.16); border: 1px solid rgba(139,92,246,.34); }
      .danger-action { color: #fff; background: rgba(202,36,63,.88); border: 1px solid rgba(255,122,142,.56); padding: 9px 12px; }
      .danger-action:hover { background: rgba(225,45,73,.96); }
      .submission-detail { display: grid; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(139,92,246,.24); background: rgba(5,5,8,.72); }
      .submission-section { display: grid; gap: 8px; }
      .submission-section h3 { margin: 0; color: #fff; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; }
      .submission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .submission-value { display: grid; gap: 3px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); }
      .submission-value.wide { grid-column: 1 / -1; }
      .submission-value span { color: #9c90b3; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .submission-value strong { color: #f7f2ff; font-size: 13px; overflow-wrap: anywhere; white-space: pre-wrap; }
      .submission-media-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .submission-thumb, .submission-link { color: #f7f2ff; text-decoration: none; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.045); overflow: hidden; }
      .submission-thumb { display: grid; gap: 6px; padding: 6px; }
      .submission-thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: #050507; }
      .submission-thumb small, .submission-link small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .admin-managed-content { display: grid; gap: 8px; }
      .admin-managed-content-link { display: grid; gap: 6px; min-width: 0; color: inherit; text-decoration: none; }
      .admin-managed-content > .danger-action { width: 100%; min-height: 38px; }
      .submission-files { display: grid; gap: 8px; }
      .submission-link { display: grid; gap: 3px; padding: 10px; }
      .submission-link strong { overflow-wrap: anywhere; }
      .submission-review-card { display: grid; gap: 8px; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submission-review-card.is-approved { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.075); }
      .submission-review-card.is-rejected { border-color: rgba(255,104,124,.38); background: rgba(255,104,124,.075); }
      .submission-review-card > small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submission-review-status.is-approved { color: #8dffc4 !important; font-weight: 900; }
      .submission-review-status.is-rejected { color: #ffb3bf !important; font-weight: 900; }
      .submission-review-card textarea { width: 100%; min-height: 68px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .content-review-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .content-review-actions button { min-height: 38px; padding: 0 10px; font-size: 12px; white-space: normal; line-height: 1.15; }
      .review-feedback { display: flex; align-items: center; gap: 7px; width: 100%; max-width: none; padding: 9px 10px; border-radius: 8px; font-size: 12px !important; font-weight: 850; }
      .review-feedback.success { color: #8dffc4 !important; border: 1px solid rgba(50,255,164,.36); background: rgba(50,255,164,.1); }
      .review-feedback.working { color: #94e5ff !important; border: 1px solid rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .review-feedback.error { color: #ffb3bf !important; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.1); }
      .submitted-social-icons, .submitted-social-review-list { display: grid; gap: 8px; }
      .submitted-social-review { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: center; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submitted-social-review.is-approved { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.075); }
      .submitted-social-review.is-rejected { border-color: rgba(255,104,124,.38); background: rgba(255,104,124,.075); }
      .submitted-social-review small, .submitted-social-review textarea, .submitted-social-review .content-review-actions, .submitted-social-review .review-feedback { grid-column: 2; }
      .submitted-social-review small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submitted-social-review-status.is-approved { color: #8dffc4 !important; font-weight: 900; }
      .submitted-social-review-status.is-rejected { color: #ffb3bf !important; font-weight: 900; }
      .submitted-social-review textarea { width: 100%; min-height: 58px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .submitted-social-icon { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; padding: 0; line-height: 1; border-radius: 999px; color: #f7f2ff; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); text-decoration: none; }
      .submitted-social-icon:hover { color: #fff; border-color: rgba(34,199,255,.48); background: rgba(34,199,255,.12); }
      .submitted-social-icon svg { display: block; width: 22px; height: 22px; margin: 0; flex: 0 0 22px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .submitted-social-icon.social-instagram svg, .submitted-social-icon.social-x svg { fill: none; }
      .submitted-social-icon .logo-cutout { fill: #050507; stroke: none; }
      .admin-preview-overlay { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.74); backdrop-filter: blur(10px); }
      .admin-preview-modal { position: relative; width: min(760px, 100%); max-height: min(86vh, 760px); overflow: auto; display: grid; gap: 12px; padding: 16px; border-radius: 8px; border: 1px solid rgba(139,92,246,.34); background: #08080c; box-shadow: 0 24px 80px rgba(0,0,0,.62); }
      .admin-preview-modal h3 { margin: 0; padding-right: 48px; color: #fff; font-size: 17px; overflow-wrap: anywhere; }
      .admin-preview-close { position: absolute; top: 10px; right: 10px; width: 38px; min-height: 38px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); color: #f7f2ff; background: rgba(255,255,255,.06); font-size: 24px; line-height: 1; }
      .admin-preview-modal img { width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px; background: #050507; }
      .admin-preview-modal iframe { width: 100%; height: min(70vh, 620px); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #050507; }
      .admin-preview-link { display: grid; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.045); color: #f7f2ff; overflow-wrap: anywhere; }
      .admin-preview-link p { margin: 0; color: #b9accd; }
      .admin-preview-link a { justify-self: start; color: #090911; background: #f7f2ff; border-radius: 999px; padding: 10px 14px; text-decoration: none; font-weight: 900; }
      .admin-profile-modal { width: min(920px, 100%); max-height: 92vh; }
      .admin-dancer-tabs { position: sticky; top: -16px; z-index: 4; display: flex; gap: 6px; overflow-x: auto; padding: 10px 0; background: #08080c; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.35) transparent; }
      .admin-dancer-tabs button { flex: 0 0 auto; min-height: 36px; padding: 0 10px; color: #b9accd; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); font-size: 11px; }
      .admin-dancer-tabs button.active { color: #fff; border-color: rgba(148,229,255,.4); background: rgba(148,229,255,.1); }
      .admin-full-profile { display: grid; gap: 18px; }
      .admin-full-profile .submission-thumb img { aspect-ratio: 4 / 5; max-height: none; object-fit: cover; }
      .admin-profile-delete-zone { display: grid; gap: 9px; padding: 14px; border-radius: 8px; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.08); }
      .admin-profile-delete-zone p { color: #ffccd4; font-size: 13px; }
      .admin-profile-delete-zone button { justify-self: start; }
      .admin-profile-delete-zone textarea { width: 100%; min-height: 64px; padding: 10px; resize: vertical; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: rgba(255,255,255,.055); font: inherit; text-transform: none; }
      .admin-profile-lifecycle-actions { display: flex; align-items: flex-start; gap: 9px; flex-wrap: wrap; }
      .admin-profile-lifecycle-actions details { flex: 1 1 240px; padding: 10px; border: 1px solid rgba(255,104,124,.25); border-radius: 8px; }
      .admin-profile-lifecycle-actions summary { cursor: pointer; color: #ffccd4; font-weight: 900; }
      .admin-profile-lifecycle-actions details p { margin: 8px 0; }
      .submission-empty { color: #9c90b3; font-size: 13px; }
      .submission-json { border-radius: 8px; border: 1px solid rgba(255,255,255,.08); padding: 10px; background: rgba(255,255,255,.035); }
      .submission-json summary { cursor: pointer; color: #94e5ff; font-weight: 900; }
      .submission-json pre { max-height: 260px; overflow: auto; color: #d8cfeb; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .venue-request-queue { display: grid; gap: 12px; padding: 14px; border: 1px solid rgba(148,229,255,.18); border-radius: 11px; background: linear-gradient(145deg, rgba(148,229,255,.045), rgba(139,92,246,.035)); }
      .venue-request-queue-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .venue-request-queue-head > span { display: grid; gap: 3px; }
      .venue-request-queue-head strong { color: #fff; font-size: 16px; }
      .venue-request-queue-head small { color: #a99fba; }
      .venue-request-queue-head em { flex: 0 0 auto; padding: 6px 9px; border: 1px solid rgba(148,229,255,.24); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.07); font-size: 11px; font-style: normal; font-weight: 950; }
      .venue-request-list { display: grid; gap: 8px; }
      .venue-request-row { border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: #09090e; overflow: hidden; }
      .venue-request-row > summary { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 12px; cursor: pointer; list-style: none; }
      .venue-request-row > summary::-webkit-details-marker { display: none; }
      .venue-request-row > summary > span:first-child { display: grid; gap: 3px; }
      .venue-request-row > summary strong { color: #fff; overflow-wrap: anywhere; }
      .venue-request-row > summary small { color: #a99fba; overflow-wrap: anywhere; }
      .venue-request-row[open] > summary .venue-disclosure { transform: rotate(180deg); }
      .venue-request-details { display: grid; gap: 12px; padding: 0 12px 12px; border-top: 1px solid rgba(255,255,255,.07); }
      .venue-request-details dl { display: grid; gap: 8px; margin: 12px 0 0; }
      .venue-request-details dl > div { display: grid; grid-template-columns: 118px minmax(0,1fr); gap: 10px; }
      .venue-request-details dt { color: #857a98; font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
      .venue-request-details dd { margin: 0; color: #d8cfeb; font-size: 13px; overflow-wrap: anywhere; }
      .venue-request-details a { color: #94e5ff; }
      .venue-request-details label { display: grid; gap: 7px; color: #d8cfeb; font-size: 12px; font-weight: 850; }
      .venue-request-details label small { color: #857a98; font-weight: 700; line-height: 1.4; }
      .venue-request-details select, .venue-request-details textarea { width: 100%; min-height: 42px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #15151c; font: inherit; }
      .venue-request-details textarea { min-height: 76px; resize: vertical; }
      .venue-request-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
      .venue-request-actions button, .venue-request-issued button { min-height: 42px; padding: 0 12px; color: #090911; background: #f7f2ff; }
      .venue-request-actions button.secondary, .venue-request-issued button.secondary { color: #f7f2ff; border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
      .venue-request-actions button:disabled { cursor: wait; opacity: .62; }
      .venue-request-details > p { color: #94e5ff; font-size: 13px; }
      .venue-request-issued { display: grid; gap: 9px; padding: 13px; border: 1px solid rgba(50,255,164,.35); border-radius: 10px; background: rgba(50,255,164,.07); }
      .venue-request-issued strong { color: #fff; }
      .venue-request-issued p { color: #c4ead6; font-size: 13px; line-height: 1.45; }
      .venue-request-issued code { user-select: all; color: #fff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: clamp(18px,5vw,24px); font-weight: 900; letter-spacing: .08em; overflow-wrap: anywhere; }
      .venue-manager { display: grid; gap: 14px; }
      .admin-info-note { margin: 0; padding: 12px 14px; border: 1px solid rgba(148,229,255,.22); border-radius: 10px; color: #d5f8ff !important; background: rgba(148,229,255,.055); line-height: 1.5; }
      .venue-manager form { display: grid; gap: 10px; padding-top: 12px; }
      .venue-manager label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-manager input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .venue-manager input[readonly] { color: #94a3b8; background: #111118; }
      .venue-manager input:focus { border-color: rgba(148,229,255,.7); outline: 2px solid rgba(148,229,255,.16); outline-offset: 1px; }
      .venue-manager button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .venue-manager button.secondary { color: #f7f2ff; border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
      .venue-manager button:disabled { cursor: wait; opacity: .62; }
      .venue-manager p { color: #94e5ff; font-size: 14px; }
      .venue-create-panel { padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: rgba(255,255,255,.025); }
      .venue-create-panel > summary { cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; list-style: none; }
      .venue-create-panel > summary::-webkit-details-marker, .venue-admin-row > summary::-webkit-details-marker { display: none; }
      .venue-create-panel > summary > span:first-child { display: grid; gap: 3px; }
      .venue-create-panel > summary strong { color: #fff; }
      .venue-create-panel > summary small { color: #9c90b3; }
      .venue-disclosure { color: #b9accd; font-size: 21px; line-height: 1; transition: transform .18s ease; }
      .venue-create-panel[open] > summary .venue-disclosure, .venue-admin-row[open] > summary .venue-disclosure { transform: rotate(180deg); }
      .venue-search input::-webkit-search-cancel-button { filter: invert(1); opacity: .72; }
      .venue-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #fff; }
      .venue-list-heading small { color: #9c90b3; }
      .venue-list { display: grid; gap: 8px; }
      .venue-admin-row { padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.09); background: linear-gradient(145deg, rgba(255,255,255,.045), rgba(255,255,255,.018)); overflow: hidden; }
      .venue-admin-row > summary { cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; color: #fff; list-style: none; }
      .venue-admin-row > summary:focus-visible, .venue-create-panel > summary:focus-visible { border-radius: 8px; outline: 2px solid #94e5ff; outline-offset: 4px; }
      .venue-admin-row summary strong, .venue-admin-row summary small { display: block; min-width: 0; overflow-wrap: anywhere; }
      .venue-admin-row small { color: #b9accd; }
      .venue-admin-identity { display: grid; gap: 3px; min-width: 0; }
      .venue-admin-summary-state { display: flex; align-items: center; gap: 8px; }
      .venue-admin-row em { padding: 5px 8px; border: 1px solid rgba(148,229,255,.22); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.06); font-size: 11px; font-style: normal; font-weight: 900; }
      .venue-admin-row em.connected { color: #8dffc4; border-color: rgba(50,255,164,.24); background: rgba(50,255,164,.07); }
      .venue-admin-row em.inactive { color: #b9accd; border-color: rgba(185,172,205,.18); background: rgba(185,172,205,.05); }
      .venue-admin-actions { display: grid; gap: 8px; padding-top: 12px; }
      .venue-admin-actions button { justify-self: start; }
      .venue-access-panel { display: grid; gap: 11px; margin-top: 12px; padding: 13px; border: 1px solid rgba(148,229,255,.16); border-radius: 10px; background: #08090d; }
      .venue-access-state { display: grid; gap: 5px; }
      .venue-access-state strong { color: #fff; }
      .venue-access-state p { color: #b9accd; font-size: 13px; }
      .venue-access-state.connected strong { color: #8dffc4; }
      .venue-access-state.inactive strong { color: #c8bdd8; }
      .venue-access-secret { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(148,229,255,.42); border-radius: 9px; background: rgba(148,229,255,.065); }
      .venue-access-secret > span { color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .15em; text-transform: uppercase; }
      .venue-access-secret code { user-select: all; color: #fff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: clamp(18px, 5vw, 24px); font-weight: 900; letter-spacing: .08em; overflow-wrap: anywhere; }
      .venue-access-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .venue-status { margin-top: 10px; color: #94e5ff !important; }
      .venue-page-admin-panel { display: grid; gap: 12px; margin-top: 12px; padding: 13px; border: 1px solid rgba(124,58,237,.34); border-radius: 10px; background: #08080d; }
      .venue-page-admin-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .venue-page-admin-heading > span { display: grid; gap: 3px; }
      .venue-page-admin-heading small { color: #94a3b8; font-size: 10px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
      .venue-page-admin-heading strong { color: #f8fafc; }
      .venue-page-admin-heading b { padding: 5px 8px; border: 1px solid rgba(34,211,238,.28); border-radius: 999px; color: #67e8f9; font-size: 10px; }
      .venue-page-change-request { display: grid; gap: 5px; padding: 11px; border: 1px solid rgba(251,191,36,.32); border-radius: 8px; background: rgba(251,191,36,.07); }
      .venue-page-change-request strong { color: #fde68a; }
      .venue-page-change-request p { margin: 0; color: #fef3c7; font-size: 12px; line-height: 1.45; }
      .venue-page-editor { grid-template-columns: repeat(2,minmax(0,1fr)); padding: 12px !important; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: #111118; }
      .venue-page-editor label:nth-child(1), .venue-page-editor label:nth-child(2), .venue-page-editor > button, .venue-page-editor > small { grid-column: 1 / -1; }
      .venue-page-editor > button { justify-self: start; min-height: 42px; }
      .venue-page-media-admin { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; }
      .venue-page-media-admin form { align-content: start; padding: 11px !important; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: #111118; }
      .venue-page-media-admin strong { color: #f8fafc; }
      .venue-page-media-admin img, .venue-page-media-admin form > span { width: 100%; aspect-ratio: 16 / 10; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.08); border-radius: 7px; color: #64748b; background: #050507; object-fit: contain; }
      .venue-page-media-admin input[type="file"] { width: 100%; min-width: 0; font-size: 11px; }
      .venue-page-requirements { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; margin: 0; padding: 0; list-style: none; }
      .venue-page-requirements li { display: flex; align-items: center; gap: 7px; padding: 9px; border: 1px solid rgba(255,255,255,.08); border-radius: 7px; color: #94a3b8; font-size: 11px; font-weight: 800; background: #111118; }
      .venue-page-requirements li.complete { color: #6ee7b7; border-color: rgba(16,185,129,.25); }
      .venue-page-workflow-actions { display: grid; gap: 8px; }
      .venue-page-workflow-copy { display: grid; gap: 5px; padding: 11px; border: 1px solid rgba(139,92,246,.24); border-radius: 8px; background: rgba(124,58,237,.07); }
      .venue-page-workflow-copy small { color: #a78bfa; font-size: 10px; font-weight: 950; letter-spacing: .13em; text-transform: uppercase; }
      .venue-page-workflow-copy strong { color: #f8fafc; line-height: 1.35; }
      .venue-page-workflow-copy p { margin: 0; color: #b9accd; font-size: 12px; line-height: 1.45; }
      .venue-page-workflow-actions button, .venue-page-preview-action { min-height: 44px; }
      .venue-page-preview-action { display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid rgba(139,92,246,.72); border-radius: 8px; color: #fff; background: linear-gradient(135deg,rgba(109,40,217,.26),rgba(124,58,237,.14)); box-shadow: inset 0 0 18px rgba(124,58,237,.12), 0 0 16px rgba(109,40,217,.12); font-size: 12px; font-weight: 900; text-align: center; text-decoration: none; }
      .venue-page-preview-action:hover { border-color: rgba(167,139,250,.92); background: linear-gradient(135deg,rgba(109,40,217,.38),rgba(124,58,237,.22)); }
      .venue-page-preview-action:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 3px; }
      .venue-page-workflow-actions small { color: #94a3b8; line-height: 1.45; }
      .report-list { display: grid; gap: 12px; }
      .report-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .report-row span { color: #b9accd; }
      .report-row p { color: #94e5ff; font-size: 14px; }
      .report-row div { display: flex; gap: 8px; flex-wrap: wrap; }
      .report-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .dmca-admin, .dmca-case-list, .dmca-case-detail, .dmca-agent-settings form { display: grid; gap: 10px; }
      .dmca-admin-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .dmca-admin-summary a { color: #94e5ff; font-size: 12px; font-weight: 850; }
      .dmca-agent-warning { margin: 0; padding: 10px 12px; border: 1px solid rgba(255,180,84,.34); border-radius: 8px; color: #ffd19a !important; background: rgba(255,180,84,.09); font-size: 12px !important; }
      .dmca-agent-settings, .dmca-case-row { padding: 11px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: rgba(255,255,255,.035); }
      .dmca-agent-settings summary, .dmca-case-row summary { cursor: pointer; color: #fff; font-weight: 900; }
      .dmca-agent-settings form { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 12px; }
      .dmca-agent-settings label, .dmca-case-detail label { display: grid; gap: 6px; color: #d8cfeb; font-size: 12px; font-weight: 850; }
      .dmca-agent-settings input, .dmca-case-detail textarea { width: 100%; min-height: 40px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: rgba(255,255,255,.055); }
      .dmca-agent-settings button { justify-self: start; color: #090911; background: #f7f2ff; }
      .dmca-agent-check { grid-template-columns: 20px minmax(0, 1fr); align-items: center; }
      .dmca-agent-check input { width: 18px; min-height: 18px; }
      .dmca-admin-status { margin: 0; padding: 9px 11px; border: 1px solid rgba(140,234,255,.26); border-radius: 8px; color: #bff7ff !important; background: rgba(53,216,255,.08); font-size: 12px !important; }
      .dmca-case-row summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
      .dmca-case-row summary span { display: grid; gap: 3px; min-width: 0; }
      .dmca-case-row summary small { color: #958aa8; overflow-wrap: anywhere; }
      .dmca-case-row summary em { color: #94e5ff; font-size: 11px; font-style: normal; }
      .dmca-case-detail { margin-top: 12px; }
      .dmca-case-detail p { margin: 0; color: #cfc5de; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
      .dmca-case-detail a { color: #94e5ff; font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .dmca-case-detail > small { color: #958aa8; overflow-wrap: anywhere; }
      .dmca-case-detail textarea { min-height: 78px; resize: vertical; }
      .dmca-counter-summary { display: grid; gap: 5px; padding: 10px; border: 1px solid rgba(50,255,164,.28); border-radius: 8px; background: rgba(50,255,164,.07); }
      .dmca-case-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .dmca-case-actions button { min-height: 38px; padding: 8px 10px; }
      .support-admin-panel { grid-column: span 2; }
      .support-inbox-list, .support-inbox-thread, .support-inbox-messages { display: grid; gap: 10px; }
      .support-inbox-thread { padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-inbox-thread.is-escalated { border-color: rgba(255,180,84,.52); box-shadow: inset 3px 0 #ffb454; }
      .support-inbox-thread summary { cursor: pointer; color: #fff; font-weight: 900; }
      .support-inbox-thread summary span { display: grid; gap: 3px; }
      .support-inbox-thread small { color: #b9accd; font-size: 12px; }
      .support-escalation { display: grid; gap: 5px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,180,84,.32); background: rgba(255,180,84,.09); }
      .support-escalation strong { color: #ffd19a; font-size: 12px; letter-spacing: .05em; }
      .support-escalation p { margin: 0; color: #ffe1bd; }
      .support-escalation.priority-urgent { border-color: rgba(255,91,116,.55); background: rgba(255,91,116,.12); }
      .support-escalation.priority-urgent strong { color: #ff9cac; }
      .support-inbox-message { display: grid; gap: 4px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-inbox-message.from-admin { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .support-inbox-message p, .support-inbox-thread p { color: #cfc5de; font-size: 14px; line-height: 1.45; }
      .support-inbox-thread textarea { width: 100%; min-height: 82px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .support-inbox-thread button { justify-self: start; color: #090911; background: #f7f2ff; padding: 0 14px; }
      .ranking-manager { display: grid; gap: 12px; }
      .ranking-manager form { display: grid; gap: 10px; }
      .ranking-manager label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .ranking-manager input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .ranking-manager button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .ranking-manager p { color: #94e5ff; font-size: 14px; }
      .ranking-list { display: grid; gap: 8px; }
      .ranking-row { display: flex; justify-content: space-between; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .ranking-row span { color: #94e5ff; font-weight: 850; }
      .image-moderation-manager, .image-moderation-list, .image-moderation-copy { display: grid; gap: 10px; }
      .image-moderation-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .image-moderation-row { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .image-moderation-row img, .moderation-thumb-empty { width: 112px; aspect-ratio: 1; border-radius: 8px; background: #050507; object-fit: cover; border: 1px solid rgba(255,255,255,.08); }
      .moderation-thumb-empty { display: grid; place-items: center; color: #b9accd; font-size: 12px; font-weight: 900; }
      .image-moderation-copy strong { color: #fff; overflow-wrap: anywhere; }
      .image-moderation-copy span, .image-moderation-copy small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .image-moderation-copy details { border-radius: 8px; border: 1px solid rgba(255,255,255,.08); padding: 8px; background: rgba(5,5,8,.52); }
      .image-moderation-copy summary { cursor: pointer; color: #94e5ff; font-size: 12px; font-weight: 900; }
      .image-moderation-copy pre { max-height: 180px; overflow: auto; color: #d8cfeb; white-space: pre-wrap; font-size: 11px; }
      .image-moderation-copy textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .image-moderation-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .deal-activity-manager, .deal-activity-list { display: grid; gap: 10px; }
      .deal-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: end; }
      .deal-filters label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .deal-activity-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .deal-activity-row span { color: #b9accd; font-size: 13px; }
      .deal-activity-row em { color: #94e5ff; font-size: 13px; font-style: normal; font-weight: 850; }
      .deal-activity-row button { justify-self: start; min-height: 34px; padding: 0 12px; }
      .deal-settlement-ledger { display: grid; gap: 5px; margin-top: 6px; padding: 10px; border: 1px solid rgba(148,163,184,.18); border-radius: 8px; background: rgba(5,5,7,.54); }
      .deal-settlement-ledger > strong { color: #f8fafc; font-size: 13px; }
      .deal-settlement-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .deal-settlement-action input { min-height: 38px; border: 1px solid rgba(148,229,255,.22); border-radius: 8px; color: #fff; background: rgba(148,229,255,.06); padding: 0 10px; font: inherit; }
      .admin-grid:empty { display: none; }
      .admin-workspace-nav { position: sticky; z-index: 30; top: 8px; max-width: 1120px; margin: 0 auto 18px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; padding: 6px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(8,8,12,.9); backdrop-filter: blur(18px); box-shadow: 0 16px 50px rgba(0,0,0,.38); }
      .admin-workspace-nav button { position: relative; min-height: 46px; padding: 8px 12px; color: #b9accd; background: transparent; border: 1px solid transparent; }
      .admin-workspace-nav button.active { color: #fff; border-color: rgba(148,229,255,.28); background: linear-gradient(135deg, rgba(139,92,246,.36), rgba(34,199,255,.14)); box-shadow: inset 0 0 22px rgba(139,92,246,.14); }
      .admin-workspace-nav button span { position: absolute; top: 3px; right: 5px; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; color: #071016; background: #94e5ff; font-size: 10px; font-weight: 950; }
      .operations-center, .workspace-lead { max-width: 1120px; margin: 0 auto 18px; display: grid; gap: 14px; }
      .admin-workspace-heading { width: 100%; max-width: 1120px; display: grid; gap: 7px; margin: 0 auto 14px; padding: 8px 2px 2px; }
      .admin-workspace-heading h2 { font-size: clamp(28px, 5vw, 40px); }
      .admin-workspace-heading p { color: #a99fb9; font-size: 15px; }
      .admin-workspace-loading { width: 100%; max-width: 1120px; display: grid; gap: 14px; margin: 0 auto 18px; }
      .admin-workspace-loading header, .admin-workspace-loading > div { display: grid; gap: 10px; padding: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; background: #0b0b10; }
      .admin-workspace-loading > div { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .admin-workspace-loading span:not(.dashboard-sr-only) { display: block; min-height: 62px; border-radius: 10px; background: linear-gradient(100deg, rgba(255,255,255,.045) 20%, rgba(139,92,246,.12) 45%, rgba(255,255,255,.045) 70%); background-size: 240% 100%; animation: adminDashboardLoadingPulse 1.25s ease-in-out infinite; }
      .admin-workspace-loading header span { min-height: 15px; width: 58%; }
      .admin-workspace-loading header span.wide { min-height: 28px; width: 34%; }
      .admin-club-deal-manager .admin-panel-body > p, .referral-fee-manager .admin-panel-body > p { color: #b9accd; line-height: 1.5; }
      .admin-club-deal-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; padding: 12px; border: 1px solid rgba(124,58,237,.32); border-radius: 10px; background: rgba(124,58,237,.045); }
      .admin-deal-request-inbox { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(34,211,238,.24); border-radius: 10px; background: rgba(34,211,238,.035); }
      .admin-deal-request-inbox > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .admin-deal-request-inbox h3 { margin: 0; }
      .admin-deal-request-inbox > div > span { padding: 5px 8px; border: 1px solid rgba(34,211,238,.35); border-radius: 999px; color: #67e8f9; font-size: 10px; font-weight: 900; }
      .admin-deal-request-inbox article { display: grid; grid-template-columns: minmax(0,1fr) auto auto auto; align-items: center; gap: 8px; padding: 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #111118; }
      .admin-deal-request-inbox article > div { display: grid; gap: 3px; }
      .admin-deal-request-inbox article small { color: #94a3b8; line-height: 1.35; }
      .admin-deal-request-inbox article > span { color: #67e8f9; font-size: 10px; font-weight: 900; }
      .admin-deal-request-inbox article > button { min-height: 38px; padding: 0 10px; }
      .admin-club-deal-request-link { margin: 0; padding: 9px; border-left: 3px solid #22d3ee; color: #cbd5e1; background: rgba(34,211,238,.06); font-size: 11px; }
      .admin-club-deal-form label { display: grid; gap: 6px; color: #d8cfeb; font-size: 12px; font-weight: 850; }
      .admin-club-deal-form .wide { grid-column: 1 / -1; }
      .admin-club-deal-form input, .admin-club-deal-form select, .admin-club-deal-form textarea { width: 100%; min-height: 42px; box-sizing: border-box; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #15151c; font: inherit; }
      .admin-club-deal-form textarea { resize: vertical; }
      .admin-club-deal-form textarea[readonly] { color: #cbd5e1; background: #111118; }
      .admin-club-deal-publish-state > span { min-height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 11px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: #15151c; }
      .admin-club-deal-publish-state input { width: 18px; min-height: 18px; height: 18px; accent-color: #10b981; }
      .admin-club-deal-agreement { display: grid; gap: 4px; padding: 12px; border: 1px solid rgba(16,185,129,.28); border-radius: 9px; background: rgba(16,185,129,.055); }
      .admin-club-deal-agreement span, .admin-club-deal-agreement small { color: #94a3b8; }
      .admin-club-deal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .admin-club-deal-actions > button { min-height: 42px; }
      .admin-club-deal-list { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 8px; }
      .admin-club-deal-list > button { display: grid; gap: 7px; padding: 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: #f8fafc; background: #111118; text-align: left; cursor: pointer; }
      .admin-club-deal-list > button.selected { border-color: rgba(124,58,237,.72); box-shadow: 0 0 0 2px rgba(124,58,237,.18); }
      .admin-club-deal-list > button span { display: flex; justify-content: space-between; gap: 8px; }
      .admin-club-deal-list > button small { color: #6ee7b7; }
      .admin-club-deal-list > button em { color: #94a3b8; font-size: 11px; font-style: normal; }
      .referral-fee-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px; border: 1px solid rgba(148,229,255,.2); border-radius: 10px; background: rgba(148,229,255,.035); }
      .referral-fee-form label, .referral-fee-request-list label { display: grid; gap: 6px; color: #d8cfeb; font-size: 12px; font-weight: 850; }
      .referral-fee-form label.wide { grid-column: 1 / -1; }
      .referral-fee-form input, .referral-fee-form select, .referral-fee-form textarea, .referral-fee-request-list textarea { width: 100%; min-height: 42px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #15151c; font: inherit; }
      .referral-fee-current { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; padding: 12px; border: 1px solid rgba(50,255,164,.24); border-radius: 9px; background: rgba(50,255,164,.055); }
      .referral-fee-current strong { color: #fff; }
      .referral-fee-current span { color: #8dffc4; font-weight: 950; }
      .referral-fee-current small { grid-column: 1 / -1; color: #b9accd; }
      .referral-fee-request-list, .referral-fee-history { display: grid; gap: 9px; }
      .referral-fee-request-list article, .referral-fee-history article { display: grid; gap: 7px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: rgba(255,255,255,.035); }
      .referral-fee-request-list strong, .referral-fee-history strong { color: #fff; }
      .referral-fee-request-list p, .referral-fee-history p { color: #d8cfeb; font-size: 13px; }
      .referral-fee-request-list small, .referral-fee-history small { color: #9c90b3; font-size: 11px; }
      .referral-fee-history article { grid-template-columns: minmax(0,1fr) auto; }
      .referral-fee-history p, .referral-fee-history small { grid-column: 1 / -1; }
      .operations-status-line, .workspace-lead > header { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding: 8px 2px 2px; }
      .workspace-lead > header { display: grid; justify-content: stretch; }
      .operations-status-line > div, .workspace-lead > header { gap: 7px; }
      .operations-status-line h2, .workspace-lead h2 { font-size: clamp(24px, 5vw, 38px); }
      .health-pill { flex: 0 0 auto; padding: 8px 11px; border-radius: 999px; font-size: 12px; font-weight: 950; }
      .health-pill.healthy { color: #8dffc4; border: 1px solid rgba(50,255,164,.3); background: rgba(50,255,164,.09); }
      .health-pill.warning { color: #ffd19a; border: 1px solid rgba(255,180,84,.34); background: rgba(255,180,84,.1); }
      .attention-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 8px; }
      .attention-grid button { min-height: 102px; display: grid; align-content: center; justify-items: start; gap: 2px; padding: 12px; text-align: left; color: #fff; border: 1px solid rgba(255,255,255,.1); background: rgba(16,16,23,.88); }
      .attention-grid button:hover, .attention-grid button:focus-visible { border-color: rgba(148,229,255,.44); background: rgba(21,23,31,.96); }
      .attention-grid span { color: #b9accd; font-size: 11px; font-weight: 850; }
      .attention-grid strong { font-size: 27px; line-height: 1; }
      .attention-grid small { color: #70667f; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
      .operations-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .operations-metric-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px !important; }
      .operations-list { display: grid; gap: 7px; }
      .operations-list > div { min-height: 50px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.07); border-radius: 8px; background: rgba(255,255,255,.035); }
      .operations-list span { display: grid; gap: 2px; }
      .operations-list strong { color: #fff; font-size: 13px; overflow-wrap: anywhere; }
      .operations-list small { color: #9c90b3; font-size: 11px; overflow-wrap: anywhere; }
      .operations-list em { color: #94e5ff; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
      .exception-block { display: grid; gap: 8px; padding: 10px; border: 1px solid rgba(255,180,84,.28); border-radius: 8px; background: rgba(255,180,84,.06); }
      .exception-block > strong { color: #ffd19a; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
      .quick-links { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px !important; }
      .quick-links button, .panel-link-button { min-height: 40px; padding: 8px 11px; color: #f7f2ff; border: 1px solid rgba(148,229,255,.24); background: rgba(148,229,255,.07); }
      .data-freshness { justify-self: end; color: #70667f; font-size: 11px; }
      .health-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; }
      .health-row > div { display: grid; gap: 3px; }
      .health-row strong { color: #fff; }
      .health-row small { color: #9c90b3; }
      .health-dot { width: 12px; height: 12px; border-radius: 999px; }
      .health-dot.healthy { background: #32ffa4; box-shadow: 0 0 16px rgba(50,255,164,.55); }
      .health-dot.warning { background: #ffb454; box-shadow: 0 0 16px rgba(255,180,84,.5); }
      .health-warning { display: grid; gap: 2px; padding: 9px 10px; border-radius: 8px; border: 1px solid rgba(255,180,84,.25); background: rgba(255,180,84,.06); }
      .health-warning strong { color: #ffd19a; font-size: 12px; }
      .health-warning span { color: #f0d1aa; font-size: 11px; overflow-wrap: anywhere; }
      .activity-timeline { display: grid; gap: 0; padding: 6px 14px 14px; border: 1px solid rgba(139,92,246,.24); border-radius: 10px; background: rgba(12,12,18,.86); }
      .activity-timeline article { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .activity-timeline article:last-child { border-bottom: 0; }
      .timeline-marker { width: 10px; height: 10px; margin-top: 4px; border-radius: 999px; background: #94e5ff; box-shadow: 0 0 15px rgba(148,229,255,.4); }
      .activity-timeline article > div { display: grid; gap: 3px; }
      .activity-timeline strong { color: #fff; }
      .activity-timeline span, .activity-timeline small { color: #9c90b3; font-size: 12px; }
      .activity-timeline p { color: #d8cfeb; font-size: 13px; }
      .admin-search { display: grid; gap: 7px; color: #d8cfeb; font-size: 12px; font-weight: 850; }
      .account-table { display: grid; padding: 0 14px; border: 1px solid rgba(139,92,246,.24); border-radius: 10px; background: rgba(12,12,18,.86); }
      .account-table [role="row"] { min-height: 68px; display: grid; grid-template-columns: 2fr .7fr .7fr 1fr; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .account-table [role="row"]:last-child { border-bottom: 0; }
      .account-table [role="cell"] { color: #d8cfeb; font-size: 12px; overflow-wrap: anywhere; }
      .account-table [role="cell"]:first-child { display: grid; gap: 3px; }
      .account-table strong { color: #fff; }
      .account-table small { color: #9c90b3; }
      .account-state { justify-self: start; padding: 5px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); }
      .account-state.active { color: #8dffc4 !important; border-color: rgba(50,255,164,.28); background: rgba(50,255,164,.07); }
      .account-state.disabled { color: #ffd19a !important; border-color: rgba(255,180,84,.3); background: rgba(255,180,84,.08); }
      @media (max-width: 1020px) { .admin-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 680px) {
        .admin-grid, .venue-admin-row, .venue-page-editor, .venue-page-media-admin, .venue-page-requirements, .deal-filters, .submission-grid, .submission-media-grid, .image-moderation-row, .image-moderation-filters, .dmca-agent-settings form, .dmca-case-actions { grid-template-columns: 1fr; }
        .support-admin-panel { grid-column: auto; }
        .top-nav, .admin-warning { align-items: flex-start; flex-direction: column; margin-bottom: 28px; }
        .nav-links { justify-content: flex-start; }
        .approval-summary { display: grid; grid-template-columns: 1fr; }
        .approval-actions, .report-row div, .content-review-actions, .venue-access-actions { display: grid; grid-template-columns: 1fr; }
        .approval-row button, .report-row button, .venue-manager button, .venue-request-actions button, .venue-request-issued button, .deal-activity-row button { width: 100%; }
        .venue-request-details dl > div { grid-template-columns: 1fr; gap: 2px; }
        .venue-request-actions { grid-template-columns: 1fr; }
        .deal-settlement-action { grid-template-columns: 1fr; }
        .admin-club-deal-form, .referral-fee-form, .referral-fee-current, .referral-fee-history article, .admin-deal-request-inbox article { grid-template-columns: 1fr; }
        .admin-club-deal-form .wide { grid-column: 1; }
        .referral-fee-form label.wide, .referral-fee-current small, .referral-fee-history p, .referral-fee-history small { grid-column: 1; }
        .referral-fee-form > button { width: 100%; }
        .admin-shell { padding-left: 8px; padding-right: 8px; overflow-x: hidden; }
        .admin-head, .admin-grid, .admin-panel, .approval-row, .submission-detail, .submission-section, .submission-review-card, .submitted-social-review, .submitted-social-review-list, .submitted-social-icons { width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
        .admin-panel, .approval-row, .submission-detail { padding: 10px; }
        .submission-review-card { padding: 8px; }
        .submitted-social-review { grid-template-columns: 32px minmax(0, 1fr); gap: 7px; align-items: start; padding: 7px; }
        .submitted-social-review small, .submitted-social-review textarea, .submitted-social-review .content-review-actions, .submitted-social-review .review-feedback { grid-column: 1 / -1; }
        .submitted-social-icon { width: 32px; height: 32px; min-width: 32px; flex-basis: 32px; }
        .submitted-social-icon svg { width: 17px; height: 17px; min-width: 17px; flex-basis: 17px; }
        .image-moderation-row img, .moderation-thumb-empty { width: 100%; max-height: 260px; object-fit: contain; }
        .submission-review-card textarea, .submitted-social-review textarea, .content-review-actions button { width: 100%; max-width: 100%; }
        .submission-thumb img { max-height: 260px; object-fit: contain; }
        h1, h2, h3, p, small, span, strong { overflow-wrap: anywhere; }
        .admin-head { gap: 10px; margin-bottom: 18px; }
        .admin-workspace-nav { top: 4px; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
        .admin-workspace-nav button { min-height: 43px; padding: 7px 8px; font-size: 11px; scroll-snap-align: start; }
        .operations-status-line { align-items: flex-start; flex-direction: column; }
        .attention-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .attention-grid button { min-height: 82px; }
        .operations-layout, .operations-metric-grid, .quick-links { grid-template-columns: 1fr; }
        .operations-list > div { grid-template-columns: 1fr; }
        .operations-list em { justify-self: start; }
        .account-table { padding: 0 10px; }
        .account-table [role="row"] { grid-template-columns: 1fr auto; gap: 7px; }
        .account-table [role="cell"]:first-child, .account-table [role="cell"]:last-child { grid-column: 1 / -1; }
        .dancer-roster-summary { grid-template-columns: 1fr; }
        .dancer-roster-filters { grid-template-columns: 1fr; padding: 10px; }
        .dancer-roster-search { grid-column: 1; }
        .dancer-directory-row { grid-template-columns: 1fr; gap: 10px; }
        .dancer-roster-data { padding-left: 62px; }
        .dancer-directory-actions button { width: 100%; }
        .dancer-roster-pagination { justify-content: space-between; }
        .admin-dancer-tabs { top: -16px; }
        .admin-profile-lifecycle-actions { display: grid; grid-template-columns: 1fr; }
        .admin-profile-lifecycle-actions > button, .admin-profile-lifecycle-actions details { width: 100%; }
      }

      /* Keep the routed admin workspace visually and behaviorally aligned with the
         production customer and venue dashboards. */
      .admin-shell.dashboard-shell-admin {
        --mydancr-dashboard-gap: 18px;
        --mydancr-dashboard-panel: #0b0b10;
        --mydancr-dashboard-panel-raised: #111118;
        --mydancr-dashboard-border: rgba(255,255,255,.11);
        --mydancr-dashboard-radius: 16px;
        --mydancr-dashboard-muted: rgba(218,214,230,.72);
        min-height: 100vh;
        padding: max(18px, calc(env(safe-area-inset-top) + 12px)) clamp(12px, 4vw, 56px) 56px;
        scroll-padding-top: max(18px, calc(env(safe-area-inset-top) + 12px));
        color-scheme: dark;
        background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.1), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.14), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%);
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
      }
      .dashboard-head, .admin-grid, .admin-warning, .sign-in, .admin-workspace-nav, .operations-center, .workspace-lead, .admin-workspace-heading { width: 100%; max-width: 1120px; margin-left: auto; margin-right: auto; }
      .dashboard-head { min-height: 0; box-sizing: border-box; display: grid; gap: 18px; margin-bottom: var(--mydancr-dashboard-gap); padding: 24px 26px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 24px; background: #07070a; box-shadow: 0 20px 48px rgba(0,0,0,.34); }
      .dashboard-head-row { display: grid; grid-template-columns: minmax(0, 1fr) 42px; align-items: start; gap: 18px; }
      .dashboard-head-copy { min-width: 0; display: grid; gap: 8px; align-content: center; overflow: visible; }
      .dashboard-head h1 { max-width: 100%; overflow: visible; color: #f8f7fb; font-family: var(--font-display, "Space Grotesk", "Outfit", sans-serif); font-size: clamp(32px, 5vw, 48px); font-weight: 850; line-height: 1; letter-spacing: -.025em; text-overflow: clip; white-space: normal; }
      .dashboard-head p { color: var(--mydancr-dashboard-muted); font-size: clamp(15px, 2.2vw, 17px); line-height: 1.45; }
      .dashboard-head .eyebrow { color: #94e5ff; }
      .dashboard-close { flex: 0 0 42px; width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(180,169,196,.2); border-radius: 50%; color: #f8f7fb; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 10px 24px rgba(0,0,0,.3); text-decoration: none; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
      .dashboard-close svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; }
      .dashboard-close:hover { border-color: rgba(126,234,255,.42); background: rgba(38,34,48,.92); }
      .dashboard-close:active { transform: scale(.96); }
      .dashboard-close:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .admin-dashboard-session { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .admin-dashboard-session > span { display: inline-flex; align-items: center; gap: 8px; color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 850; }
      .admin-dashboard-session i { flex: 0 0 9px; width: 9px; height: 9px; border-radius: 50%; background: #32ffa4; box-shadow: 0 0 13px rgba(50,255,164,.45); }
      .admin-dashboard-session .admin-logout { min-height: 38px; padding: 0 14px; box-shadow: none; }
      .dashboard-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .admin-dashboard-loading { width: 100%; max-width: 1120px; display: grid; gap: var(--mydancr-dashboard-gap); margin: 0 auto; }
      .admin-dashboard-loading-command, .admin-dashboard-loading-actions, .admin-dashboard-loading-metrics { border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .admin-dashboard-loading-command { min-height: 226px; display: grid; grid-template-columns: 112px minmax(0,1fr); align-items: start; gap: 18px; padding: 22px; }
      .admin-dashboard-loading-pill, .admin-dashboard-loading-copy span, .admin-dashboard-loading-actions span, .admin-dashboard-loading-metrics span { display: block; background: linear-gradient(100deg, rgba(255,255,255,.055) 20%, rgba(139,92,246,.13) 45%, rgba(255,255,255,.055) 70%); background-size: 240% 100%; animation: adminDashboardLoadingPulse 1.25s ease-in-out infinite; }
      .admin-dashboard-loading-pill { width: 86px; height: 42px; border-radius: 999px; }
      .admin-dashboard-loading-copy { display: grid; gap: 13px; padding-top: 3px; }
      .admin-dashboard-loading-copy span { height: 18px; border-radius: 7px; }
      .admin-dashboard-loading-copy span:first-child { width: min(78%, 330px); height: 28px; }
      .admin-dashboard-loading-copy span:last-child { width: min(62%, 260px); }
      .admin-dashboard-loading-actions { min-height: 86px; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; padding: 12px; }
      .admin-dashboard-loading-actions span { border-radius: 12px; }
      .admin-dashboard-loading-metrics { min-height: 74px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; overflow: hidden; }
      .admin-dashboard-loading-metrics span { border-radius: 0; }
      @keyframes adminDashboardLoadingPulse { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
      .admin-workspace-nav { top: max(8px, env(safe-area-inset-top)); grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; margin-bottom: var(--mydancr-dashboard-gap); padding: 5px; border-color: rgba(255,255,255,.1); border-radius: 16px; background: rgba(7,7,11,.92); box-shadow: 0 16px 38px rgba(0,0,0,.4); backdrop-filter: blur(16px); }
      .admin-workspace-nav button { min-width: 0; min-height: 42px; padding: 0 8px; border: 0; border-radius: 11px; color: #d8cfeb; font-size: 13px; text-align: center; }
      .admin-workspace-nav button:hover { color: #fff; background: rgba(126,234,255,.08); }
      .admin-workspace-nav button:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .admin-workspace-nav button.active { color: #fff; border: 0; background: linear-gradient(135deg, rgba(139,92,246,.42), rgba(34,199,255,.12)); box-shadow: inset 0 0 22px rgba(139,92,246,.12); }
      .admin-workspace-nav button span { top: 2px; right: 3px; }
      .admin-grid { grid-template-columns: 1fr; gap: var(--mydancr-dashboard-gap); }
      .admin-panel { border-color: var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); box-shadow: none; }
      .support-admin-panel { grid-column: auto; }
      .admin-warning { margin-bottom: var(--mydancr-dashboard-gap); border-radius: 14px; }
      .sign-in { max-width: 520px; border-color: var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .sign-in input { min-height: 48px; border-radius: 12px; background: #15141b; }
      .sign-in > button[type="submit"] { min-height: 48px; border-radius: 12px; }

      @media (prefers-reduced-motion: reduce) {
        .admin-dashboard-loading-pill, .admin-dashboard-loading-copy span, .admin-dashboard-loading-actions span, .admin-dashboard-loading-metrics span, .admin-workspace-loading span:not(.dashboard-sr-only) { animation: none; }
        .dashboard-close { transition: none; }
      }
      @media (max-width: 680px) {
        .admin-shell.dashboard-shell-admin { padding-left: 12px; padding-right: 12px; padding-bottom: max(132px, calc(env(safe-area-inset-bottom) + 104px)); }
        .admin-dashboard-head { padding: 18px; border-radius: 20px; }
        .dashboard-head-row { gap: 10px; }
        .dashboard-head h1 { font-size: clamp(30px, 9vw, 38px); }
        .admin-dashboard-session { align-items: flex-start; flex-direction: column; }
        .admin-dashboard-session .admin-logout { width: 100%; }
        .admin-dashboard-loading-command { min-height: 206px; grid-template-columns: 1fr; }
        .admin-dashboard-loading-actions { grid-template-columns: 1fr; }
        .admin-dashboard-loading-metrics { grid-template-columns: 1fr; min-height: 174px; }
        .admin-dashboard-loading-metrics span { border-top: 1px solid var(--mydancr-dashboard-border); }
        .admin-dashboard-loading-metrics span:first-child { border-top: 0; }
        .admin-workspace-nav { top: max(4px, env(safe-area-inset-top)); grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
        .admin-workspace-nav button { min-height: 44px; padding: 0 6px; font-size: 12px; }
        .admin-workspace-loading > div { grid-template-columns: 1fr; }
        .admin-panel, .approval-row, .submission-detail { padding: 12px; }
      }
    `}</style>
  );
}
