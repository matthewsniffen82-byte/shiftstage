"use client";
import dynamic from "next/dynamic";
import { useVisibleAutoRefresh } from "../components/useVisibleAutoRefresh";
import { mergeLiveRows } from "@/src/lib/merge-live-rows";
import { AdminGlobalSearch, AdminStaffPermissions, AdminUrgentWork, type WorkspaceAccess } from "./AdminWorkspaceTools";
import AdminClubChangeRequests, { type ClubChangeRequest } from "./AdminClubChangeRequests";
import AdminInboxActions from "./AdminInboxActions";
import AdminInboxArchive from "./AdminInboxArchive";
import AdminAccountSettings from "./AdminAccountSettings";
import AdminSectionNav from "./AdminSectionNav";
import { ADMIN_REVIEW_SECTIONS, ADMIN_CLUB_SECTIONS, ADMIN_TOOL_SECTIONS, adminSectionForPanel } from "./admin-section-navigation";
import AdminClubDealRequests, { type ClubDealRequest } from "./AdminClubDealRequests";
const AdminMediaWorkbench = dynamic(() => import("./AdminMediaWorkbench"));
const AdminCompliance = dynamic(() => import("./AdminCompliance"));
import RefreshButton from "../components/RefreshButton";

import { FormEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import DashboardHelp from "../components/DashboardHelp";
import { DashboardHelpProvider, useDashboardHelpArea } from "../components/dashboard-help-scope";
import { adminHelpContext } from "../../src/lib/dancr/dashboard-help-context";
import SupportMessageReadTracker from "../components/SupportMessageReadTracker";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import EmailNotificationGuidance from "@/app/components/EmailNotificationGuidance";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { adminReviewEmailDestination } from "@/src/lib/dancr/admin-review-email-links";
import { BROWSER_AUTH_SESSION_KEY, captureBrowserAuthSessionGuard, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { safeSocialProfileUrl } from "@/src/lib/dancr/social-profile-url";
import { isContentReviewVersion, type ContentReviewVersion } from "@/src/lib/dancr/content-review-version";
import { isProfileReviewVersion } from "@/src/lib/dancr/profile-review-version";
import { phoneTapCopy } from "@/src/lib/dancr/phone-tap-copy";
import { payoutCopy } from "@/src/lib/dancr/payout-copy";
import { findAvailableMyDancrCity, MYDANCR_AVAILABLE_CITIES } from "@/src/lib/dancr/markets";
import {
  CLUB_DEAL_OFFER_PRESETS,
  defaultClubDealOfferPreset,
} from "@/src/lib/dancr/club-deal-presets";
import type { AdminOperationsCenter } from "@/src/lib/dancr/admin-operations";
import type { AdminDancerRosterItem, AdminDancerRosterResult } from "@/src/lib/dancr/admin-dancers";
const AdminDmcaPanel = dynamic(() => import("./AdminDmcaPanel"));
const AdminNfcInventoryPanel = dynamic(() => import("./AdminNfcInventoryPanel"));
const AdminPilotAnalytics = dynamic(() => import("./AdminPilotAnalytics"));
const AdminSalesAgentPanel = dynamic(() => import("./AdminSalesAgentPanel"));
import AdminVenueSubscriptions from "./AdminVenueSubscriptions";
import AdminTvPanel from "./AdminTvPanel";
import AdminGuestOperations from "./AdminGuestOperations";
import AdminVenueColors from "./AdminVenueColors";
import AdminInternalNfcTables from "./AdminInternalNfcTables";
import AdminClubSetupChecklist from "./AdminClubSetupChecklist";
import AdminClubApprovalHistory from "./AdminClubApprovalHistory";
import AdminClubHoursFields from "./AdminClubHoursFields";
import { clearAdminFormDrafts, loadAdminFormDraft, saveAdminFormDraft, type ClubPageDraft } from "./admin-form-drafts";
import { AdminDashboardIcon } from "./AdminDashboardIcon";
import "./admin-dashboard.css";
import "./admin-operations-workspace.css";
import "../components/dashboard-header.css";
import "./admin-dashboard-consistency.css";
import { adminWorkspaceCounts, adminCountLabel } from "./admin-workspace-counts";
import { adminAttentionItems } from "./admin-attention";
import { ADMIN_DATA_CHANGED, ADMIN_INBOX_ARCHIVE_CHANGED } from "./admin-data-events";
import { adminReviewQueue, type ReviewTarget, type ReviewKind } from "./admin-review-queue";
import type { AdminGuestSection } from "@/src/lib/dancr/admin-guest-operations-types";
import { DANCER_PLACEMENT_DAYS, DANCER_SCORE_WEIGHTS, EXTERNAL_RANKING_START_MINUTES } from "@/src/lib/dancr/venue-dancer-scores";
import { NFC_WORKING_WINDOW_HOURS, NFC_COOLDOWN_HOURS } from "@/src/lib/dancr/shift-presence";
import {
  clearAdminSession,
  isAdminAuthenticationError,
  persistAdminSession,
  revokeAdminSession,
  requestAdminJson,
  readAdminSession,
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
  reviewVideos?: Array<Record<string, unknown>>;
  operations?: AdminOperationsCenter | null;
  authRequired?: boolean;
  warnings?: string[];
  error?: string;
};

type AdminActionNotice = {
  id: number;
  message: string;
};

type AdminWorkspace = "home" | "approvals" | "people" | "clubs" | "money" | "more";
type AdminClientRequest = { controller: AbortController; requestId: number };
type AdminWorkspaceRequest = AdminClientRequest & { generation: number; workspace: AdminWorkspace };

const OPEN_APPROVALS_SESSION_KEY = "dancrAdminOpenApprovalsV1";

// A UI lifecycle key only; API access still requires server-verified credentials.
function readBrowserAccountIdentity() {
  const session = readBrowserAuthSession();
  if (!session?.accessToken) return "";
  const accountId = typeof session.account?.id === "string" ? session.account.id : session.accessToken;
  return JSON.stringify([session.account?.role || "", accountId]);
}

const ADMIN_WORKSPACES: Array<{ id: AdminWorkspace; label: string }> = [
  { id: "home", label: "Home" },
  { id: "approvals", label: "Approvals" },
  { id: "people", label: "People" },
  { id: "clubs", label: "Clubs" },
  { id: "money", label: "Billing" },
  { id: "more", label: "Tools" },
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
        label: "Clubs",
        path: "/api/admin/venues",
        apply: (data) => ({ venues: data.venues || [], venueClaimCodes: data.claimCodes || [] }),
      },
      {
        label: "Club signup requests",
        path: "/api/admin/venue-signup-requests",
        apply: (data) => ({ venueSignupRequests: data.requests || [] }),
      },
      {
        label: "Club Deals",
        path: "/api/admin/deals",
        apply: (data) => ({ deals: data.activity || [], clubDeals: data.clubDeals || [], dealRequests: data.dealRequests || [] }),
      },
    ];
  }
  if (workspace === "money") {
    return [
      {
        label: "Clubs",
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
  return <DashboardHelpProvider><AdminClientContent /></DashboardHelpProvider>;
}

function AdminClientContent() {
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [helpOpened, setHelpOpened] = useState(false);
  const scrollPositions = useRef<Partial<Record<AdminWorkspace, number>>>({});
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
  const [requestedPanel, setRequestedPanel] = useState("");
  const [loadedWorkspaces, setLoadedWorkspaces] = useState<Partial<Record<AdminWorkspace, boolean>>>({});
  const completedWorkspaces = useRef<Partial<Record<AdminWorkspace, boolean>>>({});
  const [loadingWorkspace, setLoadingWorkspace] = useState<AdminWorkspace | null>(null);
  const [requestedDancerId, setRequestedDancerId] = useState("");
  const [guestDestination, setGuestDestination] = useState<{ venueId: string; section: AdminGuestSection; revision: number } | null>(null);
  const [countRefreshError, setCountRefreshError] = useState("");
  const [clubPageChangeCount, setClubPageChangeCount] = useState<number | null>(null);
  const [clubDealRequestCount, setClubDealRequestCount] = useState<number | null>(null);
  const [dealOpenError, setDealOpenError] = useState("");
  const dealOpenSequenceRef = useRef(0);
  const [requestedDealTarget, setRequestedDealTarget] = useState<{ id: string; venueId: string; revision: number } | null>(null);
  const [requestedReviewFilter, setRequestedReviewFilter] = useState<ReviewKind | "all">("all");
  const [requestedClubId, setRequestedClubId] = useState("");
  const openApprovalIdsRef = useRef<Record<string, boolean>>({});
  const mountedRef = useRef(false);
  const dataGenerationRef = useRef(0);
  const adminLoadAbortRef = useRef<AbortController | null>(null);
  const workspaceLoadSequenceRef = useRef(0);
  const workspaceLoadRef = useRef<AdminWorkspaceRequest | null>(null);
  const authActionSequenceRef = useRef(0);
  const authActionAbortRef = useRef<AbortController | null>(null);
  const authActionInFlightRef = useRef(false);
  const browserAccountRef = useRef("");
  const authBusy = isSigningIn || isResettingPassword;
  const [reviewSection, setReviewSection] = useState("media");
  const [clubSection, setClubSection] = useState("directory");
  const [toolSection, setToolSection] = useState("support");
  useDashboardHelpArea(adminHelpContext(access?.role || "owner", workspace, reviewSection, clubSection, toolSection), Boolean(access));

  useEffect(() => {
    mountedRef.current = true;
    browserAccountRef.current = readBrowserAccountIdentity();
    void loadAdmin();
    const synchronizeAccount = () => {
      const identity = readBrowserAccountIdentity();
      if (identity === browserAccountRef.current) return;
      browserAccountRef.current = identity;
      clearAdminFormDrafts();
      invalidateAdminDataRequests();
      cancelAuthAction();
      setState({ authRequired: true });
      // Remount every private child panel after clearing the shell's cached data.
      window.location.reload();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === BROWSER_AUTH_SESSION_KEY || event.key === null) synchronizeAccount();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", synchronizeAccount);
    window.addEventListener("focus", synchronizeAccount);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", synchronizeAccount);
      window.removeEventListener("focus", synchronizeAccount);
      mountedRef.current = false;
      invalidateAdminDataRequests();
      cancelAuthAction();
    };
    // This one-time lifecycle boundary reads stable refs and state setters; rerunning it would restart the admin session load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (access?.role !== "owner") return;
    let timer: number | undefined;
    let request: AbortController | null = null;
    const refreshCounts = () => {
      if (document.visibilityState !== "visible") return;
      request?.abort();
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (!readAdminSession()) return;
        const controller = new AbortController(); request = controller;
        const generation = dataGenerationRef.current, identity = readBrowserAccountIdentity();
        try {
          const data = await requestAdminJson("/api/admin/operations", { cache: "no-store", signal: controller.signal });
          if (!mountedRef.current || controller.signal.aborted || generation !== dataGenerationRef.current || identity !== readBrowserAccountIdentity()) return;
          if (!data.operations?.attention) throw new Error("Counts could not be confirmed.");
          setState(current => ({ ...current, operations: data.operations }));
          setCountRefreshError("");
        } catch {
          if (mountedRef.current && !controller.signal.aborted && generation === dataGenerationRef.current && identity === readBrowserAccountIdentity()) {
            setCountRefreshError("Counts could not refresh. Your saved changes are still recorded.");
          }
        }
      }, 250);
    };
    window.addEventListener(ADMIN_DATA_CHANGED, refreshCounts);
    document.addEventListener("visibilitychange", refreshCounts);
    const interval = window.setInterval(refreshCounts, 60_000);
    return () => { window.removeEventListener(ADMIN_DATA_CHANGED, refreshCounts); document.removeEventListener("visibilitychange", refreshCounts); window.clearInterval(interval); window.clearTimeout(timer); request?.abort(); };
  }, [access?.role]);

  useEffect(() => {
    if (access?.role !== "owner") return;
    let controller: AbortController | null = null;
    const syncArchive = async (event: Event) => {
      const { action, items } = (event as CustomEvent<{ action: string; items: Array<{ kind: string; id: string }> }>).detail;
      if (!Array.isArray(items)) return;
      const applications = items.filter(item => item.kind === "club_application"), deals = items.filter(item => item.kind === "deal_request");
      if (!applications.length && !deals.length) return;
      if (action === "archive") {
        setState(current => ({ ...current,
          venueSignupRequests: (current.venueSignupRequests || []).filter(item => !applications.some(value => value.id === item.id)),
          dealRequests: (current.dealRequests || []).filter(item => !deals.some(value => value.id === item.id)),
        }));
      }
      controller?.abort(); const request = new AbortController(); controller = request;
      const generation = dataGenerationRef.current, identity = readBrowserAccountIdentity();
      const results = await Promise.allSettled([
        requestAdminJson("/api/admin/venue-signup-requests", { cache: "no-store", signal: request.signal }),
        requestAdminJson("/api/admin/deals", { cache: "no-store", signal: request.signal }),
      ]);
      if (!mountedRef.current || request.signal.aborted || generation !== dataGenerationRef.current || identity !== readBrowserAccountIdentity()) return;
      setState(current => ({ ...current,
        venueSignupRequests: results[0].status === "fulfilled" && Array.isArray(results[0].value?.requests) ? results[0].value.requests : current.venueSignupRequests,
        dealRequests: results[1].status === "fulfilled" && Array.isArray(results[1].value?.dealRequests) ? results[1].value.dealRequests : current.dealRequests,
      }));
      if (results.some(result => result.status === "rejected")) setCountRefreshError("Inbox updated. Refresh the dashboard to reload its queues.");
    };
    window.addEventListener(ADMIN_INBOX_ARCHIVE_CHANGED, syncArchive);
    return () => { controller?.abort(); window.removeEventListener(ADMIN_INBOX_ARCHIVE_CHANGED, syncArchive); };
  }, [access?.role]);

  function openDancerManagement(dancerId: string) {
    setRequestedDancerId(dancerId);
    openWorkspace("people", "admin-dancer-management");
  }

  function openClubOperations(venueId: string, section: AdminGuestSection) {
    setRequestedClubId(venueId);
    setGuestDestination(current => ({ venueId, section, revision: (current?.revision || 0) + 1 }));
    openWorkspace("clubs", "admin-guest-operations");
  }

  async function refreshReviewSources(signal: AbortSignal, preserveProfileId?: string, canApply: () => boolean = () => true) {
    const generation = dataGenerationRef.current, identity = readBrowserAccountIdentity();
    const sections = adminSectionsForWorkspace("approvals").filter(section => ["Dancer approvals", "Image moderation", "Video moderation"].includes(section.label));
    const results = await Promise.all(sections.map(section => requestAdminJson(section.path, { signal, cache: "no-store" })));
    if (!mountedRef.current || signal.aborted || !canApply() || generation !== dataGenerationRef.current || identity !== readBrowserAccountIdentity()) return;
    const update = Object.assign({}, ...results.map((data, index) => sections[index].apply(data)));
    setState(current => !canApply() ? current : ({ ...current, ...update,
      ...(Array.isArray(update.queue) ? { queue: mergeLiveRows(current.queue || [], update.queue, new Set(preserveProfileId ? [preserveProfileId] : [])) } : {}),
      warnings: (current.warnings || []).filter(warning => !sections.some(section => warning.startsWith(`${section.label}:`))) }));
  }

  function cancelWorkspaceLoad() {
    workspaceLoadSequenceRef.current += 1;
    const active = workspaceLoadRef.current;
    active?.controller.abort();
    workspaceLoadRef.current = null;
    if (mountedRef.current) setLoadingWorkspace(null);
  }

  function invalidateAdminDataRequests() {
    dataGenerationRef.current += 1;
    adminLoadAbortRef.current?.abort();
    adminLoadAbortRef.current = null;
    cancelWorkspaceLoad();
    return dataGenerationRef.current;
  }

  function beginAuthAction(): AdminClientRequest | null {
    if (!mountedRef.current || authActionInFlightRef.current) return null;
    authActionInFlightRef.current = true;
    const requestId = authActionSequenceRef.current + 1;
    authActionSequenceRef.current = requestId;
    authActionAbortRef.current?.abort();
    const controller = new AbortController();
    authActionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentAuthAction(action: AdminClientRequest) {
    return mountedRef.current && !action.controller.signal.aborted && action.requestId === authActionSequenceRef.current;
  }

  function finishAuthAction(action: AdminClientRequest) {
    if (authActionAbortRef.current === action.controller) authActionAbortRef.current = null;
    if (action.requestId === authActionSequenceRef.current) authActionInFlightRef.current = false;
  }

  function cancelAuthAction() {
    authActionSequenceRef.current += 1;
    authActionAbortRef.current?.abort();
    authActionAbortRef.current = null;
    authActionInFlightRef.current = false;
  }

  const workspaceReady = Boolean(loadedWorkspaces[workspace]);
  useEffect(() => {
    if (!requestedPanel || !workspaceReady || isLoading || state.authRequired) return;
    const frame = window.requestAnimationFrame(() => {
      // Club rows mount only after their collapsed directory is opened.
      const panel = document.getElementById(requestedPanel)
        || (workspace === "clubs" && requestedPanel.startsWith("admin-club-") ? document.getElementById("admin-club-accounts") : null);
      if (!(panel instanceof HTMLElement)) return;
      if (panel instanceof HTMLDetailsElement) panel.open = true;
      for (let parent = panel.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      (panel.querySelector<HTMLElement>("summary") || panel).focus({ preventScroll: true });
      panel.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedPanel, workspace, workspaceReady, isLoading, state.authRequired]);

  function openWorkspace(nextWorkspace: AdminWorkspace, panel = "") {
    if (["admin-club-requests", "admin-club-approval-history"].includes(panel)) nextWorkspace = "clubs";
    const section = adminSectionForPanel(nextWorkspace, panel);
    if (section && nextWorkspace === "approvals") setReviewSection(section);
    if (section && nextWorkspace === "clubs") setClubSection(section);
    if (section && nextWorkspace === "more") setToolSection(section);
    if (nextWorkspace === "approvals" && ["admin-dancer-approvals", "admin-photo-review", "admin-tv-review"].includes(panel)) {
      setRequestedReviewFilter("all");
      panel = panel === "admin-dancer-approvals" ? "admin-review-queue" : "admin-media-workbench";
    }
    scrollPositions.current[workspace] = window.scrollY;
    setRequestedPanel(panel);
    setWorkspace(nextWorkspace);
    try { sessionStorage.setItem(`admin-workspace:${access?.userId}`, nextWorkspace); } catch {}
    void loadWorkspaceData(nextWorkspace);
    window.requestAnimationFrame(() => {
      if (!panel && scrollPositions.current[nextWorkspace] != null) window.scrollTo({ top: scrollPositions.current[nextWorkspace]!, behavior: "instant" });
      else document.querySelector(".admin-workspace-nav")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  async function openClubDealRequest(request: ClubDealRequest) {
    const identity = readBrowserAccountIdentity();
    const sequence = ++dealOpenSequenceRef.current;
    setDealOpenError("");
    try {
      const data = await requestAdminJson(`/api/admin/deals?venueId=${encodeURIComponent(request.venue_id)}`, { cache: "no-store", fallbackMessage: "Unable to open this deal request." });
      if (!mountedRef.current || identity !== readBrowserAccountIdentity() || sequence !== dealOpenSequenceRef.current) return;
      if (!Array.isArray(data.dealRequests) || !data.dealRequests.some((item: Record<string, unknown>) => item.id === request.id)) {
        setDealOpenError("This request is no longer pending. Refresh the request list.");
        window.dispatchEvent(new Event(ADMIN_DATA_CHANGED));
        return;
      }
      if (!(state.venues || []).some(venue => asText(venue.id) === request.venue_id)) completedWorkspaces.current.clubs = false;
      await loadWorkspaceData("clubs");
      if (!mountedRef.current || identity !== readBrowserAccountIdentity() || sequence !== dealOpenSequenceRef.current) return;
      setState(current => ({ ...current, clubDeals: data.clubDeals || current.clubDeals, dealRequests: [...(current.dealRequests || []).filter(item => item.venueId !== request.venue_id), ...data.dealRequests] }));
      setRequestedClubId(request.venue_id);
      setRequestedDealTarget(current => ({ id: request.id, venueId: request.venue_id, revision: (current?.revision || 0) + 1 }));
      openWorkspace("clubs", `admin-club-${request.venue_id}`);
    } catch (error) {
      if (mountedRef.current && identity === readBrowserAccountIdentity() && sequence === dealOpenSequenceRef.current) setDealOpenError(error instanceof Error ? error.message : "Unable to open this deal request.");
    }
  }

  function openClubChangeRequest(request: ClubChangeRequest) {
    // Refresh only review metadata; keep any unsaved club form values intact.
    setState(current => ({ ...current, venues: current.venues?.map(venue => asText(venue.id) === request.id ? {
      ...venue, page_review_status: request.page_review_status, page_review_notes: request.page_review_notes, page_reviewed_at: request.page_reviewed_at,
    } : venue) }));
    if (!(state.venues || []).some(venue => asText(venue.id) === request.id)) completedWorkspaces.current.clubs = false;
    setRequestedClubId(request.id);
    openWorkspace("clubs", `admin-club-${request.id}`);
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`admin-club-${request.id}`);
      if (row instanceof HTMLDetailsElement) { row.open = true; row.scrollIntoView({ block: "start", behavior: "smooth" }); }
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
    const action = beginAuthAction();
    if (!action) return;
    const isSessionUnchanged = captureBrowserAuthSessionGuard();
    setIsSigningIn(true);
    setState({ authRequired: true });

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, role: "admin", username, password, adminCode }),
      });
      const data = await response.json();
      if (!isCurrentAuthAction(action)) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (!data.session?.accessToken) throw new Error("Admin sign in requires a live session.");
      if (!isSessionUnchanged()) throw new Error("Your sign-in changed in another window. Please try again if you still want to switch accounts.");

      persistAdminSession(data.session, data.account);
      browserAccountRef.current = readBrowserAccountIdentity();
      await loadAdmin();
    } catch (error) {
      if (!isCurrentAuthAction(action)) return;
      setState({
        authRequired: true,
        error: error instanceof Error ? error.message : "Unable to sign in.",
      });
    } finally {
      if (isCurrentAuthAction(action)) setIsSigningIn(false);
      finishAuthAction(action);
    }
  }

  async function sendPasswordReset() {
    if (!username.trim()) {
      setState({ authRequired: true, error: "Enter your admin username first, then tap Forgot password." });
      return;
    }

    const action = beginAuthAction();
    if (!action) return;
    setIsResettingPassword(true);
    setState({ authRequired: true });

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        signal: action.controller.signal,
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
      if (!isCurrentAuthAction(action)) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to send reset email.");
      setState({
        authRequired: true,
        error: "Password reset email sent. Open the newest Mydancr email to continue.",
      });
    } catch (error) {
      if (!isCurrentAuthAction(action)) return;
      setState({
        authRequired: true,
        error: error instanceof Error ? error.message : "Unable to send reset email.",
      });
    } finally {
      if (isCurrentAuthAction(action)) setIsResettingPassword(false);
      finishAuthAction(action);
    }
  }

  function signOut() {
    clearAdminFormDrafts();
    setIsSigningOut(true);
    invalidateAdminDataRequests();
    cancelAuthAction();
    void revokeAdminSession();
    browserAccountRef.current = readBrowserAccountIdentity();
    window.sessionStorage.removeItem(OPEN_APPROVALS_SESSION_KEY);
    openApprovalIdsRef.current = {};
    setOpenApprovalIds({});
    setUsername("");
    setPassword("");
    setAdminCode("");
    setShowPassword(false);
    setWorkspace("home");
    setReviewSection("media");
    setClubSection("directory");
    setToolSection("support");
    setLoadedWorkspaces({});
    completedWorkspaces.current = {};
    setAccess(null);
    setLoadingWorkspace(null);
    setActionNotice(null);
    setCountRefreshError("");
    setClubPageChangeCount(null);
    setRequestedDancerId("");
    setRequestedClubId("");
    setGuestDestination(null);
    setState({ authRequired: true, error: "Admin session ended. Sign in to continue." });
    setIsSigningIn(false);
    setIsResettingPassword(false);
    setIsSigningOut(false);
  }

  async function loadWorkspaceData(nextWorkspace: AdminWorkspace) {
    if (nextWorkspace === "home" || completedWorkspaces.current[nextWorkspace]) {
      cancelWorkspaceLoad();
      return;
    }
    if (workspaceLoadRef.current?.workspace === nextWorkspace) return;

    cancelWorkspaceLoad();
    const sections = adminSectionsForWorkspace(nextWorkspace);
    const requestId = workspaceLoadSequenceRef.current + 1;
    workspaceLoadSequenceRef.current = requestId;
    const controller = new AbortController();
    const request: AdminWorkspaceRequest = {
      controller,
      generation: dataGenerationRef.current,
      requestId,
      workspace: nextWorkspace,
    };
    workspaceLoadRef.current = request;
    setLoadingWorkspace(nextWorkspace);
    setLoadedWorkspaces(current => ({ ...current, [nextWorkspace]: true }));
    const requestSession = readAdminSession();

    const isCurrentRequest = () => mountedRef.current
      && !controller.signal.aborted
      && workspaceLoadRef.current === request
      && request.generation === dataGenerationRef.current;

    try {
      const results = await Promise.allSettled(
        sections.map((section) => requestAdminJson(section.path, {
          signal: controller.signal,
          fallbackMessage: `${section.label} could not be loaded.`,
        }).then(data => { if (isCurrentRequest()) setState(current => ({ ...current, ...section.apply(data) })); return data; })),
      );
      if (!isCurrentRequest()) return;
      const authenticationFailure = results.find(
        (result) => result.status === "rejected" && isAdminAuthenticationError(result.reason),
      );
      if (authenticationFailure?.status === "rejected") {
        const message = authenticationFailure.reason instanceof Error
          ? authenticationFailure.reason.message
          : "Admin sign in required.";
        invalidateAdminDataRequests();
        if (clearAdminSession(requestSession)) browserAccountRef.current = readBrowserAccountIdentity();
        setState({
          authRequired: true,
          error: message,
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
      completedWorkspaces.current[nextWorkspace] = warnings.length === 0;
    } catch (error) {
      if (!isCurrentRequest()) return;
      setState((current) => ({
        ...current,
        warnings: [
          ...(current.warnings || []).filter((warning) => !warning.startsWith(`${labelize(nextWorkspace)}:`)),
          `${labelize(nextWorkspace)}: ${error instanceof Error ? error.message : "Unable to load this workspace."}`,
        ],
      }));
      setLoadedWorkspaces((current) => ({ ...current, [nextWorkspace]: true }));
    } finally {
      if (workspaceLoadRef.current === request) {
        workspaceLoadRef.current = null;
        if (mountedRef.current) setLoadingWorkspace((current) => (current === nextWorkspace ? null : current));
      }
    }
  }

  async function loadAdmin() {
    const requestSession = readAdminSession();
    const generation = invalidateAdminDataRequests();
    const controller = new AbortController();
    adminLoadAbortRef.current = controller;
    const isCurrentRequest = () => mountedRef.current
      && !controller.signal.aborted
      && adminLoadAbortRef.current === controller
      && generation === dataGenerationRef.current;

    if (!access) setIsLoading(true);
    setLoadingWorkspace(null);

    try {
      const workspaceAccess: WorkspaceAccess = await requestAdminJson("/api/admin/workspace", { signal: controller.signal });
      if (!isCurrentRequest()) return;
      setAccess(workspaceAccess);
      setState(current => ({ ...current, authRequired: false, venues: current.venues?.length ? current.venues : workspaceAccess.venues }));
      setIsLoading(false);
      if (!access) {
        try {
          const club = sessionStorage.getItem(`admin-club:${workspaceAccess.userId}`) || "";
          if (workspaceAccess.venues.some(venue => venue.id === club)) setRequestedClubId(club);
        } catch {}
      }
      if (workspaceAccess.role !== "owner") {
        if (workspaceAccess.role === "support") {
          const support = await requestAdminJson("/api/admin/support", { signal: controller.signal });
          if (isCurrentRequest()) setState(current => ({ ...current, supportThreads: support.threads || [] }));
        }
        return;
      }
      const sections = adminSectionsForWorkspace("home");
      const results = await Promise.allSettled(
        sections.map((section) => requestAdminJson(section.path, {
          signal: controller.signal,
          fallbackMessage: `${section.label} could not be loaded.`,
        }).then(data => { if (isCurrentRequest()) setState(current => ({ ...current, ...section.apply(data) })); return data; })),
      );
      if (!isCurrentRequest()) return;
      const authenticationFailure = results.find(
        (result) => result.status === "rejected" && isAdminAuthenticationError(result.reason),
      );

      if (authenticationFailure?.status === "rejected") {
        if (clearAdminSession(requestSession)) browserAccountRef.current = readBrowserAccountIdentity();
        setState({
          authRequired: true,
          error: authenticationFailure.reason instanceof Error
            ? authenticationFailure.reason.message
            : "Admin sign in required.",
        });
        return;
      }

      const nextState: AdminState = { authRequired: false };
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
      setState(current => ({ ...current, ...nextState }));
      setLoadedWorkspaces(current => ({ ...current, home: true }));
      if (access && workspace !== "home") { completedWorkspaces.current[workspace] = false; void loadWorkspaceData(workspace); }
      if (!access) {
        try {
          const emailDestination = adminReviewEmailDestination(new URLSearchParams(window.location.search).get("alert"));
          if (emailDestination && workspaceAccess.workspaces.includes(emailDestination.workspace)) {
            const section = adminSectionForPanel(emailDestination.workspace, emailDestination.panel);
            if (section && emailDestination.workspace === "clubs") setClubSection(section);
            if (section && emailDestination.workspace === "approvals") setReviewSection(section);
            if (section && emailDestination.workspace === "more") setToolSection(section);
            setRequestedPanel(emailDestination.panel); setWorkspace(emailDestination.workspace);
            void loadWorkspaceData(emailDestination.workspace);
          } else {
            const saved = sessionStorage.getItem(`admin-workspace:${workspaceAccess.userId}`) as AdminWorkspace;
            if (workspaceAccess.workspaces.includes(saved) && saved !== "home") { setWorkspace(saved); void loadWorkspaceData(saved); }
          }
        } catch {}
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      setState({
        authRequired: !access || isAdminAuthenticationError(error),
        error: error instanceof Error ? error.message : "Unable to load admin dashboard.",
        warnings: [error instanceof Error ? error.message : "Unable to load admin dashboard."],
      });
    } finally {
      const isCurrent = isCurrentRequest();
      if (adminLoadAbortRef.current === controller) adminLoadAbortRef.current = null;
      if (isCurrent) setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!access) return;
    try { sessionStorage.setItem(`admin-club:${access.userId}`, requestedClubId); } catch {}
  }, [requestedClubId, access]);
  const needsSignIn = state.authRequired === true;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (document.querySelector('[data-admin-unsaved="true"]')) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const showClubScope = access?.role === "reviewer" || access?.role === "billing"
    || access?.role === "owner" && (workspace === "approvals" && reviewSection === "media"
      || ["people", "money"].includes(workspace) || workspace === "clubs" && clubSection !== "requests");
  const dashboardWarnings = state.warnings || [];
  const workspaceCounts = adminWorkspaceCounts(state.operations);
  const pendingClubCount = state.operations?.warnings.some(warning => warning.section === "Club signup requests")
    ? null : state.operations?.attention.clubRequests;
  function updateClubRequests(venueSignupRequests: Array<Record<string, unknown>>) {
    setState(current => {
      const removed = (current.venueSignupRequests || []).filter(item => item.status === "pending").length
        - venueSignupRequests.filter(item => item.status === "pending").length;
      return { ...current, venueSignupRequests, operations: current.operations ? {
        ...current.operations, attention: { ...current.operations.attention,
          clubRequests: Math.max(0, current.operations.attention.clubRequests - removed),
          total: Math.max(0, current.operations.attention.total - removed),
        },
      } : current.operations };
    });
  }
  const clubRequestPanel = <><Panel id="admin-club-requests" title="Pending club requests" badge={
    (state.warnings || []).some(warning => warning.startsWith("Club signup requests:"))
      ? "Unavailable" : `${adminCountLabel(pendingClubCount)} awaiting approval`
  }>
    {(state.warnings || []).some(warning => warning.startsWith("Club signup requests:"))
      ? <p role="status">Club requests could not be loaded. Refresh the dashboard to try again.</p>
      : <VenueSignupRequestQueue
      requests={state.venueSignupRequests || []}
      venues={state.venues || []}
      onRequestsChange={updateClubRequests}
      onVenuesChange={(venues) => setState(current => ({ ...current, venues,
        operations: current.operations ? { ...current.operations, counts: { ...current.operations.counts,
          clubs: current.operations.counts.clubs == null ? null : current.operations.counts.clubs + venues.length - (current.venues || []).length,
        } } : current.operations,
      }))}
      onClaimCodesChange={(venueClaimCodes) => setState(current => ({ ...current, venueClaimCodes }))}
      claimCodes={state.venueClaimCodes || []}
      onActionConfirmed={confirmAdminAction}
      onContinueSetup={venueId => { setRequestedClubId(venueId); openWorkspace("clubs", "admin-club-accounts"); }}
    />}
  </Panel><Panel id="admin-club-approval-history" title="Club approval history & resend links">
    <AdminClubApprovalHistory onActionConfirmed={confirmAdminAction} />
  </Panel></>;
  const dashboardDescription = isLoading
    ? "Loading live operations..."
    : needsSignIn
      ? state.error || "Admin sign in required."
      : dashboardWarnings.length
        ? `${dashboardWarnings.length} dashboard ${dashboardWarnings.length === 1 ? "section is" : "sections are"} temporarily unavailable. All other admin tools are ready.`
        : "Review requests, manage people and clubs, and check platform health.";

  return (
    <main className="admin-shell dashboard-shell-admin">
      <AdminStyles />
      {actionNotice ? (
        <div className="admin-action-toast" role="status" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">✓</span>
          <strong>{actionNotice.message}</strong>
          <button type="button" data-close-control="" aria-label="Dismiss confirmation" onClick={() => setActionNotice(null)}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        </div>
      ) : null}
      <section className="dashboard-head admin-dashboard-head dashboard-identity-header" data-account-kind="admin" aria-busy={isLoading || undefined}>
        <div className="dashboard-identity-back-row">
          <DashboardCloseButton
            fallbackHref={homeDiscoveryHref("tonight")}
            label="Back to MyDancr"
          />
          {!isLoading && !needsSignIn && access && <DashboardHelp key={access.userId} role={access.role === "owner" ? "admin" : access.role} accountId={access.userId}
            context={adminHelpContext(access.role, workspace, reviewSection, clubSection, toolSection)}
            onOpenChange={setHelpOpened}
            renderMessages={access.role === "owner" || access.role === "support" ? active => <AdminSupportInbox
              threads={state.supportThreads || []} accountId={access.userId} visible={active}
              onThreadsChange={supportThreads => setState(current => ({ ...current, supportThreads }))} /> : undefined} />}
        </div>
        <div className="dashboard-identity-row">
          <div className="dashboard-identity-avatar"><span className="admin-dashboard-identity" aria-hidden="true"><AdminDashboardIcon section="shield" /></span></div>
          <div className="dashboard-identity-copy">
            <span className="dashboard-identity-label">Platform operations</span>
            <h1>Admin dashboard</h1>
            <p className="dashboard-identity-subtitle">{dashboardDescription}</p>
          </div>
        </div>
        {!isLoading && !needsSignIn ? (
          <div className="admin-dashboard-session" style={{ flexWrap: "wrap" }}>
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
            <button className={mode === "login" ? "active" : ""} type="button" disabled={authBusy} onClick={() => setMode("login")}>
              Sign in
            </button>
            <button className={mode === "signup" ? "active" : ""} type="button" disabled={authBusy} onClick={() => setMode("signup")}>
              Create
            </button>
          </div>
          <label>
            Admin username or email
            <input value={username} disabled={authBusy} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <span className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={authBusy}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={mode === "signup" ? 6 : undefined}
                required
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                type="button"
                disabled={authBusy}
                onClick={() => setShowPassword((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </span>
          </label>
          <PasswordRequirements password={password} />
          {mode === "signup" ? (
            <label>
              Admin code
              <input
                type="password"
                value={adminCode}
                disabled={authBusy}
                onChange={(event) => setAdminCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
          ) : null}
          {mode === "login" ? (
            <button className="forgot-password" type="button" onClick={sendPasswordReset} disabled={authBusy}>
              {isResettingPassword ? "Sending reset email..." : "Forgot password?"}
            </button>
          ) : null}
          <button data-sign-in-action={mode === "login" || undefined} type="submit" disabled={authBusy}>
            {isSigningIn ? "Working..." : mode === "signup" ? "Create admin account" : "Sign in"}
          </button>
        </form>
      ) : (
        <>
          {access && <AdminAccountSettings key={access.userId} accountId={access.userId} />}
          <EmailNotificationGuidance accountId={String(readBrowserAuthSession()?.account?.id || "")} accountRole="admin" />
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
          {access && <div className={`admin-context-bar${showClubScope ? "" : " is-search-only"}`}>
            {showClubScope && <label>Club<select value={requestedClubId} onChange={event => { if (!document.querySelector('.admin-review-detail[data-admin-unsaved="true"]') || window.confirm("Discard unsaved review notes and change clubs?")) setRequestedClubId(event.target.value); }}><option value="">All clubs</option>{access.venues.map(venue => <option key={String(venue.id)} value={String(venue.id)}>{String(venue.name)}</option>)}</select></label>}
            {(access.role === "owner" || access.role === "support") && <AdminGlobalSearch onOpen={result => {
              if (access.role !== "owner") return;
              if (result.type === "dancer") openDancerManagement(result.id);
              if (result.venueId) { setRequestedClubId(result.venueId); openWorkspace("clubs", "admin-club-accounts"); }
            }} />}
          </div>}
          {access?.role === "reviewer" && <AdminMediaWorkbench venueId={requestedClubId} userId={access.userId} onSaved={confirmAdminAction} />}
          {access?.role === "support" && <AdminInboxArchive supportOnly />}
          {access?.role === "support" && <section id="admin-support" tabIndex={-1} aria-label="Messages"><AdminSupportInbox threads={state.supportThreads || []} accountId={access.userId} visible={!helpOpened} onThreadsChange={supportThreads => setState(current => ({ ...current, supportThreads }))} /></section>}
          {access?.role === "billing" && <AdminVenueSubscriptions venues={access.venues.filter(venue => !requestedClubId || venue.id === requestedClubId)} />}
          {access?.role === "compliance" && <Panel id="admin-compliance" title="Safety & privacy cases" collapsible={false}><AdminCompliance visible={!helpOpened} /></Panel>}
          {access?.role === "owner" && <>
          <nav className="admin-workspace-nav" aria-label="Admin workspaces">
            {ADMIN_WORKSPACES.map((item) => {
              const count = item.id === "clubs" ? pendingClubCount == null || clubPageChangeCount == null || clubDealRequestCount == null ? null : pendingClubCount + clubPageChangeCount + clubDealRequestCount : workspaceCounts[item.id].value;
              const showCount = ["home", "approvals", "clubs", "more"].includes(item.id) && (count == null || count > 0);
              return (
              <button
                key={item.id}
                type="button"
                className={workspace === item.id ? "active" : ""}
                aria-current={workspace === item.id ? "page" : undefined}
                onClick={() => openWorkspace(item.id)}
              >
                <AdminDashboardIcon section={item.id} />
                {item.label}
                {showCount ? <span className="admin-workspace-count" aria-label={count == null ? "Count unavailable" : `${adminCountLabel(count)} ${item.id === "clubs" ? "club requests need attention" : workspaceCounts[item.id].label}`}>
                  {adminCountLabel(count)}
                </span> : null}
              </button>
            ); })}
          </nav>
          {countRefreshError ? <p role="status">{countRefreshError} <button type="button" onClick={() => window.dispatchEvent(new Event(ADMIN_DATA_CHANGED))}>Retry counts</button></p> : null}
          {loadedWorkspaces.home || workspace === "home" ? (
            <section hidden={workspace !== "home"} className="admin-retained-workspace">
              <AdminAttentionInbox operations={state.operations || null} onOpenWorkspace={openWorkspace} onRefresh={() => window.dispatchEvent(new Event(ADMIN_DATA_CHANGED))} />
              <AdminUrgentWork onOpen={openWorkspace} />
              <details><summary>Activity &amp; system overview</summary>
              <OperationsOverview
                operations={state.operations || null}
                monitoring={state.monitoring || null}
                onOpenWorkspace={openWorkspace}
                onRefresh={() => void loadAdmin()}
              />
              <ActivityTimeline operations={state.operations || null} />
              </details>
            </section>
          ) : null}

          {workspace !== "home" && loadingWorkspace === workspace && !loadedWorkspaces[workspace]
            ? <AdminWorkspaceLoadingState workspace={workspace} />
            : null}

          {loadedWorkspaces.approvals ? (
            <section hidden={workspace !== "approvals"} className="admin-retained-workspace">
              <WorkspaceHeader
                title="Approvals"
                description="Choose a queue to review."
              />
              <AdminSectionNav id="admin-review" label="Approval queues" items={ADMIN_REVIEW_SECTIONS} selected={reviewSection} onSelect={setReviewSection} />
              <section className="admin-grid">
                <section id="admin-review-media-panel" role="tabpanel" aria-labelledby="admin-review-media-tab" hidden={reviewSection !== "media"}>
                <div id="admin-media-workbench"><AdminMediaWorkbench venueId={requestedClubId} userId={access.userId} active={workspace === "approvals"} onSaved={confirmAdminAction} /></div>
                </section>
                <section id="admin-review-profiles-panel" role="tabpanel" aria-labelledby="admin-review-profiles-tab" hidden={reviewSection !== "profiles"}>
                <Panel id="admin-review-queue" title="Applications & social links" collapsible={false}>
                  <UnifiedReviewQueue active={workspace === "approvals" && reviewSection === "profiles"} profiles={state.queue || []} images={[]} videos={[]} includeMedia={false}
                    requestedFilter={requestedReviewFilter}
                    warnings={(state.warnings || []).filter(warning => /^(Dancer approvals|Image moderation|Video moderation):/.test(warning))}
                    onRefresh={refreshReviewSources} onActionConfirmed={confirmAdminAction} onManageDancer={openDancerManagement}
                    onProfilesChange={queue => setState(current => ({ ...current, queue }))}
                    onImagesChange={imageModeration => setState(current => ({ ...current, imageModeration }))}
                    onVideosChange={reviewVideos => setState(current => ({ ...current, reviewVideos }))} />
                </Panel>
                </section>
                <section id="admin-review-reports-panel" role="tabpanel" aria-labelledby="admin-review-reports-tab" hidden={reviewSection !== "reports"}>
                <Panel id="admin-reports" title="Reports" collapsible={false} badge={`${state.reports?.length || 0} open`}>
                  <ReportManager
                    active={workspace === "approvals" && reviewSection === "reports"}
                    reports={state.reports || []}
                    onReportsChange={(reports) => setState((current) => ({ ...current, reports }))}
                  />
                </Panel>
                </section>
              </section>
            </section>
          ) : null}

          {loadedWorkspaces.people ? (
            <section hidden={workspace !== "people"} className="admin-retained-workspace">
              <WorkspaceHeader
                title="People"
                description="Find a dancer, review their profile, or manage other accounts."
              />
              <section className="admin-grid">
                <Panel id="admin-dancer-management" title="Dancer management" badge={`${adminCountLabel(state.operations?.counts?.dancers)} profiles`}>
                  <DancerDirectory
                    requestedDancerId={requestedDancerId}
                    requestedClubId={requestedClubId}
                    onClubChange={setRequestedClubId}
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
                <Panel title="Recent accounts">
                  <AccountOverview operations={state.operations || null} />
                </Panel>
                <Panel title="Sales agents">
                  <AdminSalesAgentPanel onActionConfirmed={confirmAdminAction} />
                </Panel>
              </section>
            </section>
          ) : null}

            <section hidden={workspace !== "clubs"} className="admin-retained-workspace">
              {loadedWorkspaces.clubs && <>
              <WorkspaceHeader
                title="Clubs"
                description="Manage a club or open its requests and tools."
              />
              <AdminSectionNav id="admin-clubs" label="Club management" items={ADMIN_CLUB_SECTIONS} selected={clubSection} onSelect={setClubSection} />
              </>}
              <section id="admin-clubs-requests-panel" role="tabpanel" aria-labelledby="admin-clubs-requests-tab" hidden={clubSection !== "requests"}>
                <AdminClubDealRequests key={`deals:${access.userId}`} visible={workspace === "clubs" && clubSection === "requests"} onOpen={openClubDealRequest} onCountChange={setClubDealRequestCount} />
                {dealOpenError && (workspace === "clubs" && clubSection === "requests") ? <p role="alert">{dealOpenError}</p> : null}
                <AdminClubChangeRequests key={access.userId} visible={workspace === "clubs" && clubSection === "requests"} onOpen={openClubChangeRequest} onCountChange={setClubPageChangeCount} />

                {loadedWorkspaces.clubs && clubRequestPanel}
              </section>
              {loadedWorkspaces.clubs && <section className="admin-grid">
                <section id="admin-clubs-directory-panel" role="tabpanel" aria-labelledby="admin-clubs-directory-tab" hidden={clubSection !== "directory"}>
                <Panel id="admin-club-accounts" title="Club accounts" badge={`${adminCountLabel(state.operations?.counts?.clubs)} managed`}>
                  <VenueManager
                    clubDeals={state.clubDeals || []}
                    dealRequests={state.dealRequests || []}
                    onClubDealsChange={(clubDeals) => setState(current => ({ ...current, clubDeals }))}
                    onDealRequestsChange={(dealRequests) => setState(current => ({ ...current, dealRequests }))}
                    onActionConfirmed={confirmAdminAction}
                    venues={state.venues || []}
                    onOpenOperations={openClubOperations}
                    requestedClubId={requestedClubId}
                    requestedDealTarget={requestedDealTarget}
                    onClubChange={setRequestedClubId}
                    claimCodes={state.venueClaimCodes || []}
                    onVenuesChange={(venues) => setState((current) => ({ ...current, venues }))}
                    onClaimCodesChange={(venueClaimCodes) => setState((current) => ({ ...current, venueClaimCodes }))}
                  />
                </Panel>
                </section>
                <section id="admin-clubs-guests-panel" role="tabpanel" aria-labelledby="admin-clubs-guests-tab" hidden={clubSection !== "guests"}>
                <Panel id="admin-guest-operations" title="VIP & guest operations">
                  <AdminGuestOperations active={workspace === "clubs" && clubSection === "guests"} key={guestDestination?.revision || 0} initialVenueId={requestedClubId} onVenueChange={setRequestedClubId} initialSection={guestDestination?.section} venues={state.venues || []} onActionConfirmed={confirmAdminAction} />
                </Panel>
                </section>
                <section id="admin-clubs-tools-panel" role="tabpanel" aria-labelledby="admin-clubs-tools-tab" hidden={clubSection !== "tools"}>
                <Panel id="admin-deal-attribution" title="Deal attribution" badge={`${state.deals?.length || 0} records`}>
                  <DealActivityManager activity={state.deals || []} onActivityChange={(deals) => setState(current => ({ ...current, deals }))} />
                </Panel>
                <Panel id="admin-tap-stickers" title="Dancer Check-In Tags" badge={`${adminCountLabel(state.operations?.counts?.tapStickers)} tags`}>
                  <p>Dancer check-in taps start Working Now for {NFC_WORKING_WINDOW_HOURS} hours, followed by a {NFC_COOLDOWN_HOURS}-hour cooldown across clubs. Tapping again does not extend the session. Table NFC stickers are managed inside each club account.</p>
                  <AdminNfcInventoryPanel key={requestedClubId} scopedVenueId={requestedClubId || undefined} />
                </Panel>
                </section>
              </section>}
            </section>

          {loadedWorkspaces.money ? (
            <section hidden={workspace !== "money"} className="admin-retained-workspace">
              <WorkspaceHeader
                title="Subscriptions"
                description="Clubs pay a subscription for MyDancr. Review the club roster and billing availability here."
              />
              <AdminVenueSubscriptions venues={state.warnings?.some(warning => warning.startsWith("Clubs:")) ? undefined : state.venues?.filter(venue => !requestedClubId || venue.id === requestedClubId)} />
            </section>
          ) : null}

          {loadedWorkspaces.more ? (
            <section hidden={workspace !== "more"} className="admin-retained-workspace">
              <WorkspaceHeader
                title="Tools"
                description="Messages, platform tools, staff access and archived items."
              />
              <AdminSectionNav id="admin-tools" label="Admin tools" items={ADMIN_TOOL_SECTIONS} selected={toolSection} onSelect={setToolSection} />
              <section className="admin-grid">
                <section id="admin-tools-support-panel" role="tabpanel" aria-labelledby="admin-tools-support-tab" hidden={toolSection !== "support"}>
                <Panel id="admin-support" title="Support Inbox" collapsible={false} badge={`${state.supportThreads?.filter((thread) => String(thread.status) === "open").length || 0} open`}>
                  <AdminSupportInbox
                    threads={state.supportThreads || []}
                    accountId={access.userId}
                    visible={workspace === "more" && toolSection === "support" && !helpOpened}
                    onThreadsChange={(supportThreads) => setState((current) => ({ ...current, supportThreads }))}
                  />
                </Panel>
                <Panel title="Pickup requests" badge="Club contact forms">
                  <p>Review contact forms sent to club managers for pickup coordination.</p>
                  <Link className="primary-link" href="/pickups">Open pickup requests →</Link>
                </Panel>
                </section>
                <section id="admin-tools-compliance-panel" role="tabpanel" aria-labelledby="admin-tools-compliance-tab" hidden={toolSection !== "compliance"}>
                  <Panel id="admin-compliance" title="Safety & privacy operations" collapsible={false}>
                    <AdminCompliance visible={workspace === "more" && toolSection === "compliance"} />
                  </Panel>
                </section>
                <section id="admin-tools-platform-panel" role="tabpanel" aria-labelledby="admin-tools-platform-tab" hidden={toolSection !== "platform"}>
                <Panel id="admin-dmca" title="Copyright / DMCA" badge={`${adminCountLabel(state.operations?.attention.dmca)} open`}>
                  <AdminDmcaPanel active={workspace === "more" && toolSection === "platform"} />
                </Panel>
                <Panel id="admin-monitoring" title="Monitoring" badge={`${Object.keys(state.monitoring || {}).length} checks`}>
                  {Object.entries(state.monitoring || {}).slice(0, 6).map(([key, value]) => (
                    <Metric key={key} label={labelize(key)} value={formatValue(value)} />
                  ))}
                  {!state.monitoring ? <Metric label="Status" value="Not checked" /> : null}
                </Panel>
                <Panel id="admin-rankings" title="Rankings" badge={`${adminCountLabel(state.operations?.analytics.activeDancers)} approved dancers`}>
                  <RankingManager />
                </Panel>
                <Panel id="admin-pilot-analytics" title="Pilot analytics">
                  <AdminPilotAnalytics venues={state.venues || []} onActionConfirmed={confirmAdminAction} />
                </Panel>
                </section>
                <section id="admin-tools-team-panel" role="tabpanel" aria-labelledby="admin-tools-team-tab" hidden={toolSection !== "team"}>
                  <Panel id="admin-staff-access" title="Staff permissions"><AdminStaffPermissions access={access} onSaved={confirmAdminAction} /></Panel>
                </section>
                <section id="admin-tools-history-panel" role="tabpanel" aria-labelledby="admin-tools-history-tab" hidden={toolSection !== "history"}>
                  <Panel id="admin-inbox-archive" title="Archived items"><AdminInboxArchive /></Panel>
                </section>
              </section>
            </section>
          ) : null}
          </>}
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

function useAdminCommercialEditorState(dirty: boolean, busy: boolean, onChange?: (state: { dirty: boolean; busy: boolean }) => void) {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => { callback.current?.({ dirty, busy }); }, [dirty, busy]);
}

function AdminClubDealManager({
  scopedVenueId,
  onEditorStateChange,
  venues,
  clubDeals,
  dealRequests,
  onClubDealsChange,
  onDealRequestsChange,
  onActionConfirmed,
}: {
  scopedVenueId?: string;
  onEditorStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  venues: Array<Record<string, unknown>>;
  clubDeals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  onClubDealsChange: (clubDeals: Array<Record<string, unknown>>) => void;
  onDealRequestsChange: (dealRequests: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const preset = defaultClubDealOfferPreset();
  const draftScope = scopedVenueId || "all";
  const [recoveredDraft] = useState(() => {
    const draft = loadAdminFormDraft("club-deal", draftScope);
    if (!draft || (scopedVenueId && draft.venueId !== scopedVenueId)
      || (draft.dealId && !clubDeals.some(deal => deal.id === draft.dealId && deal.venueId === draft.venueId))) return null;
    return draft;
  });
  const [initialSavedDeal] = useState(() => {
    const selection = loadAdminFormDraft("club-deal-selection", draftScope);
    const availableDeals = clubDeals.filter(deal => asText(deal.venueId) === scopedVenueId);
    return availableDeals.find(deal => deal.id === selection?.dealId) || (availableDeals.length === 1 ? availableDeals[0] : null);
  });
  const [venueId, setVenueId] = useState(recoveredDraft?.venueId || scopedVenueId || "");
  const [isDirty, setIsDirty] = useState(Boolean(recoveredDraft));
  const [dealId, setDealId] = useState(recoveredDraft?.dealId ?? asText(initialSavedDeal?.id));
  const [requestId, setRequestId] = useState(recoveredDraft?.requestId || "");
  const [dealTitle, setDealTitle] = useState<string>(recoveredDraft?.dealTitle ?? (asText(initialSavedDeal?.dealTitle) || preset.title));
  const [dealDescription, setDealDescription] = useState<string>(recoveredDraft?.dealDescription ?? (asText(initialSavedDeal?.dealDescription) || preset.description));
  const [dealTerms, setDealTerms] = useState<string>(recoveredDraft?.dealTerms ?? (initialSavedDeal ? asText(initialSavedDeal.dealTerms) : preset.terms));
  const [sortOrder, setSortOrder] = useState(recoveredDraft?.sortOrder ?? String(initialSavedDeal?.sortOrder ?? "0"));
  const [isActive, setIsActive] = useState(recoveredDraft?.isActive ?? initialSavedDeal?.isActive === true);
  const [status, setStatus] = useState(recoveredDraft ? "Your unfinished deal was restored. Review it before saving." : "");
  const [isSaving, setIsSaving] = useState(false);
  useAdminCommercialEditorState(isDirty, isSaving, onEditorStateChange);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const venueDeals = clubDeals
    .filter((deal) => asText(deal.venueId) === venueId)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const openDealRequests = dealRequests.filter((request) => (!scopedVenueId || asText(request.venueId) === scopedVenueId) && (request.status === "pending" || request.status === "under_review"));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginDealAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentDealAction(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishDealAction(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setIsSaving(false);
  }

  function resetEditor(nextVenueId = venueId) {
    saveAdminFormDraft("club-deal", draftScope, null);
    saveAdminFormDraft("club-deal-selection", draftScope, null);
    setVenueId(nextVenueId);
    setIsDirty(false);
    setDealId("");
    setRequestId("");
    setDealTitle(preset.title);
    setDealDescription(preset.description);
    setDealTerms(preset.terms);
    setSortOrder(String(clubDeals.filter((deal) => asText(deal.venueId) === nextVenueId).length * 10));
    setIsActive(false);
    setStatus("");
  }

  function editDeal(deal: Record<string, unknown>) {
    saveAdminFormDraft("club-deal", draftScope, null);
    saveAdminFormDraft("club-deal-selection", draftScope, { venueId: asText(deal.venueId), dealId: asText(deal.id) });
    setIsDirty(false);
    setRequestId("");
    setDealId(asText(deal.id));
    setDealTitle(asText(deal.dealTitle) || preset.title);
    setDealDescription(asText(deal.dealDescription) || (CLUB_DEAL_OFFER_PRESETS.find((offer) => offer.title === asText(deal.dealTitle)) || preset).description);
    setDealTerms(asText(deal.dealTerms) || preset.terms);
    setSortOrder(String(Number(deal.sortOrder || 0)));
    setIsActive(deal.isActive === true);
    setStatus("");
  }

  function prepareDealRequest(dealRequest: Record<string, unknown>) {
    setIsDirty(true);
    const nextVenueId = asText(dealRequest.venueId);
    const linkedDeal = clubDeals.find((deal) => asText(deal.id) === asText(dealRequest.linkedDealId));
    const requestedPreset = CLUB_DEAL_OFFER_PRESETS.find((offer) => offer.title === asText(dealRequest.offerTitle)) || preset;
    setVenueId(nextVenueId);
    setRequestId(asText(dealRequest.id));
    setDealId(linkedDeal ? asText(linkedDeal.id) : "");
    setDealTitle(linkedDeal ? asText(linkedDeal.dealTitle) || requestedPreset.title : requestedPreset.title);
    setDealDescription(linkedDeal ? asText(linkedDeal.dealDescription) || requestedPreset.description : requestedPreset.description);
    setDealTerms(linkedDeal ? asText(linkedDeal.dealTerms) || requestedPreset.terms : requestedPreset.terms);
    setSortOrder(linkedDeal ? String(Number(linkedDeal.sortOrder || 0)) : String(clubDeals.filter((deal) => asText(deal.venueId) === nextVenueId).length * 10));
    setIsActive(linkedDeal?.isActive === true);
    saveAdminFormDraft("club-deal", draftScope, {
      venueId: nextVenueId, requestId: asText(dealRequest.id), dealId: linkedDeal ? asText(linkedDeal.id) : "",
      dealTitle: linkedDeal ? asText(linkedDeal.dealTitle) || requestedPreset.title : requestedPreset.title,
      dealDescription: linkedDeal ? asText(linkedDeal.dealDescription) || requestedPreset.description : requestedPreset.description,
      dealTerms: linkedDeal ? asText(linkedDeal.dealTerms) || requestedPreset.terms : requestedPreset.terms,
      sortOrder: linkedDeal ? String(Number(linkedDeal.sortOrder || 0)) : String(clubDeals.filter(deal => asText(deal.venueId) === nextVenueId).length * 10),
      isActive: linkedDeal?.isActive === true,
    });
    setStatus("Request loaded. Review the guest offer before publishing.");
  }

  function keepDealDraft(form: HTMLFormElement) {
    const values = new FormData(form);
    const selectedTitle = String(values.get("dealTitle") || "");
    const selectedPreset = CLUB_DEAL_OFFER_PRESETS.find(offer => offer.title === selectedTitle) || preset;
    const changedOffer = selectedTitle !== dealTitle;
    const saved = saveAdminFormDraft("club-deal", draftScope, {
      venueId, dealId, requestId, dealTitle: selectedTitle,
      dealDescription: changedOffer ? selectedPreset.description : String(values.get("dealDescription") || ""),
      dealTerms: changedOffer ? selectedPreset.terms : String(values.get("dealTerms") || ""),
      sortOrder: String(values.get("sortOrder") || "0"), isActive: values.has("isActive"),
    });
    if (!saved) setStatus("Draft recovery is unavailable in this browser. Save before refreshing.");
  }

  function chooseOffer(nextTitle: string) {
    const offer = CLUB_DEAL_OFFER_PRESETS.find((candidate) => candidate.title === nextTitle) || preset;
    setDealTitle(offer.title);
    setDealDescription(offer.description);
    setDealTerms(offer.terms);
  }

  async function saveDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venueId) return setStatus("Choose the contracted club first.");
    const request = beginDealAction();
    if (!request) return;
    setIsSaving(true);
    setStatus(isActive ? "Publishing the contract Club Deal…" : "Saving the contract Club Deal…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_contract_deal",
          venueId,
          dealId: dealId || null,
          requestId: requestId || null,
          dealTitle,
          dealDescription,
          dealTerms,
          isActive,
          sortOrder: Number(sortOrder || 0),
        }),
        fallbackMessage: "Unable to save the contract Club Deal.",
      });
      if (!isCurrentDealAction(request)) return;
      saveAdminFormDraft("club-deal", draftScope, null);
      saveAdminFormDraft("club-deal-selection", draftScope, { venueId, dealId: asText(data.deal?.id) });
      setIsDirty(false);
      onClubDealsChange(data.clubDeals || []);
      onDealRequestsChange(data.dealRequests || dealRequests);
      setDealId(asText(data.deal?.id));
      if (isActive) setRequestId("");
      const message = isActive ? "Contract Club Deal published by MyDancr." : "Contract Club Deal saved as an unpublished draft.";
      setStatus(message);
      onActionConfirmed(message);
    } catch (error) {
      if (!isCurrentDealAction(request)) return;
      setStatus(error instanceof Error ? error.message : "Unable to save the contract Club Deal.");
    } finally {
      finishDealAction(request);
    }
  }

  async function removeDeal(deal: Record<string, unknown>) {
    const targetVenueId = asText(deal.venueId);
    const targetDealId = asText(deal.id);
    if (!targetVenueId || !targetDealId) return setStatus("Choose a saved Club Deal first.");
    const removesLastLiveDeal = deal.isActive === true && !clubDeals.some((candidate) => candidate.venueId === targetVenueId && candidate.id !== targetDealId && candidate.isActive === true);
    const visibilityNote = removesLastLiveDeal ? " This is the last live deal, so the club will be hidden from public listings until another deal is published." : "";
    if (!window.confirm(`Remove ${asText(deal.dealTitle) || "this Club Deal"}? Guests will no longer be able to claim it. Past redemptions and payment records will be kept.${visibilityNote}`)) return;
    const request = beginDealAction();
    if (!request) return;
    setIsSaving(true);
    setStatus("Removing Club Deal…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove_contract_deal", venueId: targetVenueId, dealId: targetDealId }),
        fallbackMessage: "Unable to remove the Club Deal.",
      });
      if (!isCurrentDealAction(request)) return;
      onClubDealsChange(data.clubDeals || []);
      onDealRequestsChange(data.dealRequests || dealRequests);
      if (targetDealId === dealId) resetEditor(venueId);
      const message = "Club Deal removed. Past redemptions and payment records have been kept.";
      setStatus(message);
      onActionConfirmed(message);
    } catch (error) {
      if (!isCurrentDealAction(request)) return;
      setStatus(error instanceof Error ? error.message : "Unable to remove the Club Deal.");
    } finally {
      finishDealAction(request);
    }
  }

  async function rejectDealRequest(dealRequest: Record<string, unknown>) {
    const reason = window.prompt("Why is this Club Deal request not approved? This note will be visible to the club.")?.trim();
    if (!reason) return;
    const request = beginDealAction();
    if (!request) return;
    setIsSaving(true);
    setStatus("Rejecting Club Deal request…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST",
        signal: request.controller.signal,
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
      if (!isCurrentDealAction(request)) return;
      onDealRequestsChange(data.dealRequests || []);
      if (requestId === asText(dealRequest.id)) resetEditor();
      setStatus("Club Deal request rejected with an audit note.");
      onActionConfirmed("Club Deal request rejected.");
    } catch (error) {
      if (!isCurrentDealAction(request)) return;
      setStatus(error instanceof Error ? error.message : "Unable to reject the Club Deal request.");
    } finally {
      finishDealAction(request);
    }
  }

  async function approveDealRemoval(dealRequest: Record<string, unknown>) {
    const request = beginDealAction();
    if (!request) return;
    setIsSaving(true);
    setStatus("Approving Club Deal removal…");
    try {
      const data = await requestAdminJson("/api/admin/deals", {
        method: "POST", signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve_deal_removal", requestId: asText(dealRequest.id), venueId: asText(dealRequest.venueId) }),
        fallbackMessage: "Unable to approve this removal request.",
      });
      if (!isCurrentDealAction(request)) return;
      onClubDealsChange(data.clubDeals || []);
      onDealRequestsChange(data.dealRequests || []);
      if (dealId === asText(dealRequest.targetDealId)) resetEditor();
      setStatus("Removal approved. The Club Deal is no longer available to guests.");
      onActionConfirmed("Club Deal removal approved.");
    } catch (error) {
      if (isCurrentDealAction(request)) setStatus(error instanceof Error ? error.message : "Unable to approve this removal request.");
    } finally { finishDealAction(request); }
  }

  return (
    <section className="operations-center admin-club-deal-manager" aria-labelledby={`admin-club-deal-manager-heading-${scopedVenueId || "all"}`}>
      <Panel title="Contract Club Deals" badge={`${(scopedVenueId ? venueDeals : clubDeals).filter((deal) => deal.isActive === true).length} live`}>
        <span className="eyebrow">MyDancr controlled</span>
        <h2 id={`admin-club-deal-manager-heading-${scopedVenueId || "all"}`}>Create and publish club offers</h2>
        <p>Enter only the admission offer authorized by the signed deal order. Club dashboards receive a read-only copy of every offer, fee, status, and settlement metric.</p>
        {!scopedVenueId || openDealRequests.length ? <section className="admin-deal-request-inbox" aria-labelledby={`admin-deal-request-inbox-heading-${scopedVenueId || "all"}`}>
          <div>
            <h3 id={`admin-deal-request-inbox-heading-${scopedVenueId || "all"}`}>Club deal requests</h3>
            <span>{openDealRequests.length} open</span>
          </div>
          {openDealRequests.map((dealRequest) => (
            <article key={asText(dealRequest.id)} id={`admin-deal-request-${asText(dealRequest.id)}`} tabIndex={-1}>
              <div>
                <strong>{asText((dealRequest.venue as Record<string, unknown> | null)?.name) || "Club"} · {dealRequest.requestType === "remove" ? "Remove: " : ""}{asText(dealRequest.offerTitle)}</strong>
                <small>{asText(dealRequest.requestNotes) || "No additional contract notes."}</small>
                {dealRequest.requestType === "remove" && clubDeals.some((deal) => deal.id === dealRequest.targetDealId && deal.isActive === true) && clubDeals.filter((deal) => deal.venueId === dealRequest.venueId && deal.isActive === true).length === 1 ? <small>Removing the last active deal hides this club. Dancer profiles, videos, and saved affiliations remain active.</small> : null}
              </div>
              <span>{dealRequest.status === "under_review" ? "Under review" : "New request"}</span>
              {dealRequest.requestType === "remove" ? <button type="button" disabled={isSaving} onClick={() => void approveDealRemoval(dealRequest)}>Approve removal</button> : <button type="button" disabled={isSaving} onClick={() => prepareDealRequest(dealRequest)}>Prepare deal</button>}
              <button className="danger-action" type="button" disabled={isSaving} onClick={() => void rejectDealRequest(dealRequest)}>Reject</button>
            </article>
          ))}
          {!openDealRequests.length ? <p className="empty">No club Club Deal requests are waiting for review.</p> : null}
        </section> : null}
        <form className="admin-club-deal-form" data-admin-unsaved={isDirty} onSubmit={saveDeal} onChangeCapture={() => setIsDirty(true)} onChange={event => {
          if ((event.target as HTMLElement).getAttribute("name") !== "venueId") keepDealDraft(event.currentTarget);
        }}>
          <label>
            Contracted club
            <select name="venueId" value={venueId} disabled={isSaving || Boolean(scopedVenueId)} onChange={(event) => resetEditor(event.target.value)} required>
              <option value="">Choose club</option>
              {venues.map((venue) => <option key={asText(venue.id)} value={asText(venue.id)}>{asText(venue.name)}</option>)}
            </select>
          </label>
          <label>
            Deal offered
            <select name="dealTitle" value={dealTitle} disabled={isSaving} onChange={(event) => chooseOffer(event.target.value)}>
              {CLUB_DEAL_OFFER_PRESETS.map((offer) => <option key={offer.key} value={offer.title}>{offer.title}</option>)}
            </select>
          </label>
          <label className="wide">
            Public offer details
            <textarea name="dealDescription" required value={dealDescription} disabled={isSaving} onChange={(event) => setDealDescription(event.target.value)} maxLength={1200} rows={4} />
          </label>
          <label className="wide">
            Contract and guest terms
            <textarea name="dealTerms" value={dealTerms} disabled={isSaving} onChange={(event) => setDealTerms(event.target.value)} maxLength={1200} rows={4} />
          </label>
          <label>
            Display order
            <input name="sortOrder" type="number" min="0" max="1000" value={sortOrder} disabled={isSaving} onChange={(event) => setSortOrder(event.target.value)} />
          </label>
          <label className="admin-club-deal-publish-state">
            Publication state
            <span><input name="isActive" type="checkbox" checked={isActive} disabled={isSaving} onChange={(event) => setIsActive(event.target.checked)} /> Live on MyDancr</span>
          </label>
          {requestId ? <p className="admin-club-deal-request-link wide">This draft is linked to club request {requestId}. Publishing it will approve the request automatically.</p> : null}
          <div className="admin-club-deal-actions wide">
            <button disabled={isSaving} type="submit">{isSaving ? "Saving…" : isActive ? "Publish contract deal" : "Save unpublished deal"}</button>
            {dealId ? <button className="secondary-action" disabled={isSaving} type="button" onClick={() => resetEditor(venueId)}>New deal</button> : null}
          </div>
        </form>
        {isDirty ? <small>Unsaved deal changes. Save the deal to apply them.</small> : null}
        {status ? <p role="status">{status}</p> : null}
        <div className="admin-club-deal-list">
          {venueDeals.map((deal) => (
            <div className={`admin-club-deal-item${asText(deal.id) === dealId ? " selected" : ""}`} key={asText(deal.id)}>
              <button className="admin-club-deal-edit" type="button" disabled={isSaving} onClick={() => editDeal(deal)} aria-label={`Edit ${asText(deal.dealTitle) || "Club Deal"}`}>
                <span><strong>{asText(deal.dealTitle) || "Club Deal"}</strong><small>{deal.isActive === true ? "Live" : "Unpublished"}</small></span>
                <em>Included with club subscription</em>
              </button>
              <button className="danger-action" type="button" disabled={isSaving} onClick={() => void removeDeal(deal)}>Remove deal</button>
            </div>
          ))}
          {venueId && !venueDeals.length ? <p className="empty">No contract Club Deals have been entered for this club.</p> : null}
        </div>
      </Panel>
    </section>
  );
}

function AdminAttentionInbox({ operations, onOpenWorkspace, onRefresh }: { operations: AdminOperationsCenter | null; onOpenWorkspace: (workspace: AdminWorkspace, panel?: string) => void; onRefresh: () => void }) {
  const [showAllQueues, setShowAllQueues] = useState(false);
  const allItems = adminAttentionItems(operations);
  const primary = ["support", "dealRequests", "clubPageChanges", "clubRequests"];
  const items = allItems.filter(item => showAllQueues || item.value == null || item.value > 0)
    .sort((a, b) => Number(primary.includes(b.key)) - Number(primary.includes(a.key)));
  const allClear = allItems.every(item => item.value === 0);
  const overdueUnknown = operations?.warnings.some(warning => warning.section.startsWith("Overdue "));
  return <section className="operations-center admin-attention-inbox" aria-label="Messages and requests">
    <header className="operations-status-line"><div><h2>Needs attention</h2><p>All clubs</p></div>
      <div className="admin-attention-controls">
        {overdueUnknown || operations?.attention.overdue ? <span className="health-pill warning">{overdueUnknown ? "Overdue status unavailable" : `${operations?.attention.overdue} overdue`}</span> : null}
        <button type="button" onClick={onRefresh}>Refresh counts</button>
        <button type="button" aria-pressed={showAllQueues} onClick={() => setShowAllQueues(value => !value)}>{showAllQueues ? "Only pending" : "Show all queues"}</button></div></header>
    <div className="admin-attention-list">{items.map(item => <button key={item.key} type="button" onClick={() => onOpenWorkspace(item.workspace, item.panel)}>
      <span>{item.label}</span><strong>{adminCountLabel(item.value)}</strong><small>{item.value == null ? "Unavailable" : "Open →"}</small>
    </button>)}</div>
    {allClear ? <p className="admin-queues-clear" role="status">All queues are clear. Nothing is waiting for review.</p> : null}
  </section>;
}

function OperationsOverview({
  operations,
  monitoring,
  onOpenWorkspace,
  onRefresh,
}: {
  operations: AdminOperationsCenter | null;
  monitoring: Record<string, unknown> | null;
  onOpenWorkspace: (workspace: AdminWorkspace, panel?: string) => void;
  onRefresh: () => void;
}) {
  if (!operations) return <section className="operations-center"><p>Operational data is unavailable.</p><RefreshButton label="Refresh overview" type="button" onClick={onRefresh} /></section>;
  return (
    <section className="operations-center">
      <nav className="admin-task-shortcuts" aria-label="Common admin tasks">
        <button type="button" onClick={() => onOpenWorkspace("clubs", "admin-club-accounts")}>Table NFC stickers &amp; embeds <span aria-hidden="true">→</span></button>
        <button type="button" onClick={() => onOpenWorkspace("clubs", "admin-tap-stickers")}>Dancer Check-In Tags <span aria-hidden="true">→</span></button>
        <button type="button" onClick={() => onOpenWorkspace("approvals", "admin-tv-review")}>MyDancrTV <span aria-hidden="true">→</span></button>
        <button type="button" onClick={() => onOpenWorkspace("more", "admin-rankings")}>Rankings <span aria-hidden="true">→</span></button>
      </nav>

      <div className="operations-layout">
        <Panel title="VIP & guest operations" badge="Club controls">
          <div className="operations-metric-grid">
            <Metric label="Pending VIP visits" value={adminCountLabel(operations.guests?.pendingVip ?? null)} />
            <Metric label="Active VIP access" value={adminCountLabel(operations.guests?.activeVip ?? null)} />
            <Metric label="Guest-list signups / 24h" value={adminCountLabel(operations.guests?.guestList24h ?? null)} />
            <Metric label="Ride requests / 24h" value={adminCountLabel(operations.guests?.rides24h ?? null)} />
            <Metric label="Email update opt-ins" value={adminCountLabel(operations.guests?.emailUpdates ?? null)} />
            <Metric label="Text update opt-ins" value={adminCountLabel(operations.guests?.textUpdates ?? null)} />
          </div>
          <p>Review visits, manage VIP access, see guest and ride details, withdraw update subscriptions, and compare club results.</p>
          <button type="button" onClick={() => onOpenWorkspace("clubs", "admin-guest-operations")}>Open guest operations →</button>
        </Panel>
        <Panel title="Live operations" badge={`${operations.live.checkedInDancers.length} checked in`}>
          <div className="operations-metric-grid">
            <Metric label="Operating clubs" value={String(operations.live.activeVenueCount)} />
            <Metric label="QR generated / 24h" value={String(operations.live.qrGeneratedToday)} />
            <Metric label="QR redeemed / 24h" value={String(operations.live.qrRedeemedToday)} />
            <Metric label="Suspicious QR / 24h" value={String(operations.live.suspiciousQrToday)} />
          </div>
          <OperationsList
            items={operations.live.checkedInDancers}
            empty="No dancers are currently checked in."
            render={(item) => ({
              title: relationLabel(item.dancer_profiles, "stage_name", "Dancer"),
              detail: `${relationLabel(item.venues, "name", "Club")} · checked in ${relativeTime(item.checked_in_at)}`,
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
                  detail: `${relationLabel(item.venues, "name", "Club")} · shift began ${relativeTime(item.starts_at)}`,
                  status: "needs review",
                })}
              />
            </div>
          ) : null}
          <div className="quick-links">
            <button type="button" onClick={() => onOpenWorkspace("clubs", "admin-deal-attribution")}>Review deal activity</button>
            <button type="button" onClick={() => onOpenWorkspace("people")}>Open people</button>
          </div>
        </Panel>

        <Panel title="Club subscriptions" badge="Subscription only">
          <p>Club subscriptions are the MyDancr billing model. Club Deals and verified admissions are included.</p>
          <p>Subscription amounts and payment status are unavailable until club billing records are connected.</p>
          <button className="panel-link-button" type="button" onClick={() => onOpenWorkspace("money")}>View club subscriptions</button>
        </Panel>

        <Panel title="Growth & engagement" badge={`${operations.analytics.totalAccounts} accounts`}>
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

        <SystemHealthSummary monitoring={monitoring} warnings={operations.warnings} onOpenSystem={() => onOpenWorkspace("more", "admin-monitoring")} />
      </div>
      <div className="admin-overview-footer">
        <small className="data-freshness">Live data checked {relativeTime(operations.checkedAt)}.</small>
        <RefreshButton label="Refresh overview" type="button" onClick={onRefresh} />
      </div>
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
  const disconnected = integrations.filter((item) => item.ok === false);
  const databaseErrors = database.filter((item) => item.ok === false || Boolean(item.error));
  const unavailable = !monitoring
    || !Array.isArray(monitoring.integrations) || !Array.isArray(monitoring.database)
    || !integrations.length || !database.length
    || integrations.length !== monitoring.integrations.length || database.length !== monitoring.database.length
    || integrations.some((item) => typeof item.ok !== "boolean")
    || database.some((item) => typeof item.ok !== "boolean"
      || (item.ok === true && (typeof item.count !== "number" || !Number.isSafeInteger(item.count) || item.count < 0)));
  const issues = warnings.length + disconnected.length + databaseErrors.length;
  const confirmed = !issues && !unavailable;
  return (
    <Panel title="Platform health" badge={issues ? `${issues} ${issues === 1 ? "issue" : "issues"}` : unavailable ? "Not confirmed" : "0 issues"}>
      <div className="health-row">
        <span className={confirmed ? "health-dot healthy" : "health-dot warning"} aria-hidden="true" />
        <div>
          <strong>{issues ? "Checks need attention" : unavailable ? "Status checks unavailable" : "Last checks passed"}</strong>
          <small>{integrations.length} integration {integrations.length === 1 ? "setting" : "settings"} · {database.length} database {database.length === 1 ? "check" : "checks"}</small>
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
    <section className="workspace-lead admin-activity-panel">
      <Panel title="Recent admin activity" badge={`${activity.length} recent`}>
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
      </Panel>
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
        <h2>Dancers, guests, clubs & admins</h2>
        <p>Search the latest production accounts, then use the full dancer and club records below for operational changes.</p>
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
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="admin-workspace-heading">
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
  const [suspicious, setSuspicious] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState("");
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const controlsBusy = isLoading || isMutating;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      actionSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginDealActivityAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentDealActivityAction(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishDealActivityAction(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setIsMutating(false);
  }

  async function loadFiltered() {
    if (!mountedRef.current) return;
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setIsLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    if (venueId) params.set("venueId", venueId);
    if (dancerId) params.set("dancerId", dancerId);
    if (dealId) params.set("dealId", dealId);
    if (sourceType) params.set("sourceType", sourceType);
    if (status) params.set("status", status);
    if (suspicious) params.set("suspicious", suspicious);

    try {
      const data = await requestAdminJson(`/api/admin/deals?${params.toString()}`, {
        signal: controller.signal,
        fallbackMessage: "Unable to load deal activity.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      onActivityChange(data.activity || []);
      setMessage(`${data.activity?.length || 0} records loaded.`);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setMessage(error instanceof Error ? error.message : "Unable to load deal activity.");
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (mountedRef.current && requestId === loadSequenceRef.current) setIsLoading(false);
    }
  }

  async function voidRedemption(redemptionId: string) {
    const request = beginDealActivityAction();
    if (!request) return;
    setIsMutating(true);
    setMessage("Voiding redemption...");
    try {
      await requestAdminJson("/api/admin/deals", {
        method: "PATCH",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redemptionId }),
        fallbackMessage: "Unable to void redemption.",
      });
      if (!isCurrentDealActivityAction(request)) return;
      await loadFiltered();
      if (!isCurrentDealActivityAction(request)) return;
      setMessage("Redemption voided.");
    } catch (error) {
      if (!isCurrentDealActivityAction(request)) return;
      setMessage(error instanceof Error ? error.message : "Unable to void redemption.");
    } finally {
      finishDealActivityAction(request);
    }
  }

  return (
    <div className="deal-activity-manager">
      <div className="deal-filters">
        <label>
          Club ID
          <input value={venueId} disabled={controlsBusy} onChange={(event) => setVenueId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Dancer ID
          <input value={dancerId} disabled={controlsBusy} onChange={(event) => setDancerId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Deal ID
          <input value={dealId} disabled={controlsBusy} onChange={(event) => setDealId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Source
          <select value={sourceType} disabled={controlsBusy} onChange={(event) => setSourceType(event.target.value)}>
            <option value="">All sources</option>
            <option value="club_page">Club page</option>
            <option value="dancer_profile">Dancer profile</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} disabled={controlsBusy} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="generated">Generated</option>
            <option value="redeemed">Redeemed</option>
            <option value="expired">Expired</option>
            <option value="voided">Voided</option>
          </select>
        </label>
        <label>
          Suspicious
          <select value={suspicious} disabled={controlsBusy} onChange={(event) => setSuspicious(event.target.value)}>
            <option value="">All activity</option>
            <option value="true">Flagged only</option>
          </select>
        </label>
        <button type="button" onClick={loadFiltered} disabled={controlsBusy}>
          {isLoading ? "Loading..." : "Filter"}
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="deal-activity-list">
        {activity.slice(0, 8).map((item) => {
          return (
            <div className="deal-activity-row" key={String(item.id)}>
              <strong>{previewDealName(item)}</strong>
              <span>{String(item.source_type || "source")} / {String(item.status || "status")}</span>
              {item.suspicious ? <span>Flagged suspicious</span> : null}
              {item.status === "generated" ? (
                <button type="button" disabled={isMutating} onClick={() => voidRedemption(String(item.id))}>
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
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginRankingAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentRankingAction(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishRankingAction(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setIsWorking(false);
  }

  async function recalculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = beginRankingAction();
    if (!request) return;
    setIsWorking(true);
    setStatus("");
    try {
      const data = await requestAdminJson("/api/admin/rankings/recalculate", {
        method: "POST",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city }),
        fallbackMessage: "Unable to recalculate rankings.",
      });
      if (!isCurrentRankingAction(request)) return;
      const nextRankings = Array.isArray(data.rankings) ? data.rankings : [];
      setRankings(nextRankings);
      setStatus(`${nextRankings.length} rankings recalculated. ${Array.isArray(data.warnings) ? data.warnings.join(" ") : ""}`.trim());
    } catch (error) {
      if (!isCurrentRankingAction(request)) return;
      setStatus(error instanceof Error ? error.message : "Unable to recalculate rankings. Check your connection and try again.");
    } finally {
      finishRankingAction(request);
    }
  }

  return (
    <div className="ranking-manager">
      <div className="admin-feature-note">
        <strong>Current placement rules</strong>
        <p>Club rosters, public dancer listings and MyDancrTV use the dancer performance score over {DANCER_PLACEMENT_DAYS} days. External or Both time is the largest factor at {DANCER_SCORE_WEIGHTS.externalTime}%, starting after {EXTERNAL_RANKING_START_MINUTES} recorded minutes.</p>
        <p>Internal and public visibility still determine where a dancer can appear. Current scores update automatically.</p>
      </div>
      <details className="admin-record-section">
      <summary>Legacy city rankings</summary>
      <p>This recalculates the older city trending ranks and may send milestone notifications. It does not refresh the current performance score.</p>
      <form onSubmit={recalculate}>
        <label>
          City
          <input value={city} disabled={isWorking} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <button type="submit" disabled={isWorking}>
          {isWorking ? "Working..." : "Recalculate city ranks"}
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
      </details>
    </div>
  );
}

function ImageModerationQueue({
  records,
  onRecordsChange,
  onActionConfirmed,
  focused = false, onBusyChange, onReviewed,
}: {
  records: Array<Record<string, unknown>>;
  onRecordsChange: (records: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
  focused?: boolean; onBusyChange?: (busy: boolean) => void;
  onReviewed?: (id: string, decision: "approved" | "rejected") => void;
}) {
  const [filter, setFilter] = useState("review");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const controlsBusy = isLoading || isMutating;
  useEffect(() => { onBusyChange?.(controlsBusy); return () => onBusyChange?.(false); }, [controlsBusy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      actionSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginImageModerationAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentImageModerationAction(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishImageModerationAction(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setIsMutating(false);
  }

  async function loadQueue(nextFilter = filter) {
    if (!mountedRef.current) return;
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setIsLoading(true);
    setMessage("");
    try {
      const data = await requestAdminJson(`/api/admin/image-moderation?decision=${encodeURIComponent(nextFilter)}`, {
        cache: "no-store",
        signal: controller.signal,
        fallbackMessage: "Unable to load image moderation queue.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      const nextRecords = Array.isArray(data.records) ? data.records : [];
      onRecordsChange(nextRecords);
      setMessage(`${nextRecords.length} image moderation records loaded.`);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setMessage(error instanceof Error ? error.message : "Unable to load image moderation queue. Check your connection and try again.");
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (mountedRef.current && requestId === loadSequenceRef.current) setIsLoading(false);
    }
  }

  async function decide(recordId: string, decision: "approved" | "rejected") {
    if (decision === "approved" && !window.confirm("Approve this photo and publish it?")) return;
    const request = beginImageModerationAction();
    if (!request) return;

    setIsMutating(true);
    setMessage(decision === "approved" ? "Publishing approved photo..." : "Rejecting photo...");
    try {
      const data = await requestAdminJson("/api/admin/image-moderation", {
        method: "POST",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId, decision, version: records.find(record => String(record.id) === recordId)?.updated_at, notes: "" }),
        fallbackMessage: "Unable to update moderation record.",
      });
      if (!isCurrentImageModerationAction(request)) return;
      if (data.record?.id !== recordId || data.record.decision !== decision) throw new Error("The photo decision could not be confirmed. Refresh the queue before trying again.");
      onRecordsChange(records.filter((record) => String(record.id) !== recordId));
      const confirmation =
        decision === "approved"
          ? "Picture approved and published successfully."
          : "Picture rejected successfully and removed from private review storage.";
      setMessage(confirmation);
      onActionConfirmed(confirmation);
      onReviewed?.(recordId, decision);
    } catch (error) {
      if (!isCurrentImageModerationAction(request)) return;
      setMessage(error instanceof Error ? error.message : "Unable to update moderation record. Check your connection and try again.");
    } finally {
      finishImageModerationAction(request);
    }
  }

  return (
    <div className="image-moderation-manager">
      <div className="image-moderation-filters" hidden={focused}>
        <select
          value={filter}
          disabled={controlsBusy}
          onChange={(event) => {
            setFilter(event.target.value);
            loadQueue(event.target.value);
          }}
        >
          <option value="review">Pending review</option>
          <option value="approved">Approved</option>
        </select>
        <RefreshButton label="Refresh photo queue" busy={isLoading} type="button" onClick={() => loadQueue()} disabled={controlsBusy} />
      </div>
      {message ? <p>{message}</p> : null}
      <div className="image-moderation-list">
        {records.slice(0, 12).map((record) => {
          const recordId = String(record.id || "");
          const reasonCodes = Array.isArray(record.reasonCodes) ? record.reasonCodes : Array.isArray(record.reason_codes) ? record.reason_codes : [];
          return (
            <article className="image-moderation-row" key={recordId}>
              {record.thumbnailUrl ? <a href={String(record.thumbnailUrl)} target="_blank" rel="noopener noreferrer" aria-label="Open full image for review"><img src={String(record.thumbnailUrl)} alt="Image awaiting review" style={{ objectFit: "contain" }} /></a> : <div className="moderation-thumb-empty">Private</div>}
              <div className="image-moderation-copy">
                <strong>{String(record.upload_context || "photo upload")}</strong>
                <span>{String(record.decision || "review")} / {String(record.status || "pending")}</span>
                <small>{String(record.created_at || "")}</small>
                <small>{record.club_reviewed_at ? "Club approved · MyDancr final review" : "MyDancr review"}</small>
                <small>Reasons: {reasonCodes.length ? reasonCodes.join(", ") : "None"}</small>

                {String(record.decision) === "review" ? (
                  <>
                    <p>Final review: inspect the full image against MyDancr guidelines. Dancer media must show only that dancer, with no prohibited nudity, sexual activity, branding, contact details, or unsafe content.</p>
                    <div className="image-moderation-actions">
                      <button type="button" disabled={controlsBusy || !record.thumbnailUrl} onClick={() => decide(recordId, "approved")}>Approve and publish</button>
                      <button type="button" disabled={controlsBusy} onClick={() => decide(recordId, "rejected")}>Reject</button>
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
  accountId,
  visible = true,
}: {
  threads: Array<Record<string, unknown>>;
  onThreadsChange: (threads: Array<Record<string, unknown>>) => void;
  accountId: string;
  visible?: boolean;
}) {
  const messageContainer = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const [statusByThread, setStatusByThread] = useState<Record<string, string>>({});
  const pendingReplyAttempt = useRef<{ key: string; id?: string } | null>(null);
  const [busyThreadId, setBusyThreadId] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(threads.length === 100);
  const pageRef = useRef(0);
  const readAbortRef = useRef<AbortController | null>(null);
  const threadsRef = useRef(threads);
  const onThreadsChangeRef = useRef(onThreadsChange);
  useEffect(() => { threadsRef.current = threads; onThreadsChangeRef.current = onThreadsChange; }, [threads, onThreadsChange]);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      readAbortRef.current?.abort();
      readAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  async function refreshMessages(more = false) {
    if (!visibleRef.current || readAbortRef.current || actionInFlightRef.current || document.visibilityState !== "visible") return;
    const controller = new AbortController(); readAbortRef.current = controller;
    const page = more ? pageRef.current + 1 : 0;
    setIsRefreshing(true);
    try {
      const data = await requestAdminJson("/api/admin/support?page=" + page, { cache: "no-store", signal: controller.signal, fallbackMessage: "Unable to refresh messages." });
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!Array.isArray(data.threads)) throw new Error("Messages could not be confirmed.");
      const fresh = data.threads as Array<Record<string, unknown>>;
      const ids = new Set(fresh.map(thread => String(thread.id)));
      const retained = more ? threadsRef.current : threadsRef.current.slice(100);
      const merged = more ? [...retained.filter(thread => !ids.has(String(thread.id))), ...fresh] : [...fresh, ...retained.filter(thread => !ids.has(String(thread.id)))];
      onThreadsChangeRef.current(merged);
      if (more || pageRef.current === 0) setHasMore(data.hasMore === true);
      if (more) pageRef.current = page;
      setRefreshError("");
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) setRefreshError(error instanceof Error ? error.message : "Unable to refresh messages.");
    } finally {
      if (readAbortRef.current === controller) readAbortRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (!visible) { setIsRefreshing(false); return; }
    const load = () => void refreshMessages();
    load();
    const interval = window.setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener(ADMIN_DATA_CHANGED, load);
    return () => {
      window.clearInterval(interval); document.removeEventListener("visibilitychange", load); window.removeEventListener(ADMIN_DATA_CHANGED, load);
      readAbortRef.current?.abort(); readAbortRef.current = null;
    };
  }, [visible]);

  function beginSupportAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    readAbortRef.current?.abort(); readAbortRef.current = null; setIsRefreshing(false);
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentSupportAction(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishSupportAction(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setBusyThreadId("");
  }

  async function reply(threadId: string) {
    const message = (replyByThread[threadId] || "").trim();
    if (!message) {
      setStatusByThread((current) => ({ ...current, [threadId]: "Enter a reply first." }));
      return;
    }
    const request = beginSupportAction();
    if (!request) return;

    setBusyThreadId(threadId);
    setStatusByThread((current) => ({ ...current, [threadId]: "" }));
    try {
      const session = readAdminSession();
      const key = JSON.stringify([session?.account?.id || session?.accessToken, threadId, message]);
      if (pendingReplyAttempt.current?.key !== key) pendingReplyAttempt.current = { key, id: globalThis.crypto?.randomUUID?.() };
      const data = await requestAdminJson("/api/admin/support", {
        method: "POST",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message, requestId: pendingReplyAttempt.current?.id }),
        fallbackMessage: "Unable to send reply.",
      });
      if (!isCurrentSupportAction(request)) return;
      pendingReplyAttempt.current = null;
      onThreadsChange([data.thread, ...threads.filter((thread) => String(thread.id) !== threadId)]);
      setReplyByThread((current) => ({ ...current, [threadId]: "" }));
      setStatusByThread((current) => ({ ...current, [threadId]: "Reply sent." }));
    } catch (error) {
      if (!isCurrentSupportAction(request)) return;
      setStatusByThread((current) => ({
        ...current,
        [threadId]: error instanceof Error ? error.message : "Unable to send reply. Check your connection and try again.",
      }));
    } finally {
      finishSupportAction(request);
    }
  }

  function messageTime(value: unknown) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
    });
  }

  return (
    <div className="support-inbox-list" ref={messageContainer}>
      <SupportMessageReadTracker container={messageContainer} revision={threads} active={visible} accountId={accountId} />
      <div className="support-inbox-toolbar">
      <button type="button" disabled={isRefreshing || Boolean(busyThreadId) || archiving} onClick={() => void refreshMessages()}>{isRefreshing ? "Refreshing…" : "Refresh"}</button>
      <AdminInboxActions disabled={Boolean(busyThreadId) || archiving} items={threads.map(thread => ({ kind: "support", id: String(thread.id), version: String(thread.lastMessageAt || ""), title: String(thread.subject || "Support message") }))}
        onStart={() => { actionInFlightRef.current = true; readAbortRef.current?.abort(); readAbortRef.current = null; setIsRefreshing(false); setArchiving(true); }}
        onSettled={() => { actionInFlightRef.current = false; setArchiving(false); void refreshMessages(); }}
        onComplete={archived => { const remaining = threadsRef.current.filter(thread => !archived.some(item => item.id === String(thread.id))); threadsRef.current = remaining; pageRef.current = 0; onThreadsChangeRef.current(remaining); }} />
      </div>
      {refreshError ? <p role="alert">{refreshError} Your current messages and draft replies are kept.</p> : null}
      {!threads.length ? <p className="empty">{isRefreshing ? "Checking messages…" : refreshError ? "Messages are unavailable." : "No support messages yet."}</p> : null}
      {[...threads].sort((a, b) => Number(b.status === "open") - Number(a.status === "open")).map((thread) => {
        const threadId = String(thread.id || "");
        const messages = asRecordArray(thread.messages);
        const userLabel = String(thread.userName || thread.userEmail || thread.userRole || "User");
        const accountRole = ({ venue: "Club", customer: "Guest", dancer: "Dancer" } as Record<string, string>)[String(thread.userRole)] || "Account";
        const subject = String(thread.subject || "Support message");
        const needsReply = thread.status === "open";
        return (
          <article className="support-inbox-thread" key={threadId} aria-label={`${userLabel}: ${subject}`}>
            <header className="support-thread-heading">
              <div><h3>{userLabel}</h3><p>{accountRole} · {subject}</p></div>
              <span className={needsReply ? "support-thread-status needs-reply" : "support-thread-status"}>{needsReply ? "Needs reply" : thread.status === "closed" ? "Closed" : "Replied"}</span>
            </header>
            <div className="support-inbox-messages" role="log" aria-label={`Conversation with ${userLabel}`} aria-live="polite" aria-relevant="additions">
              {messages.map((message) => {
                const senderLabel = String(message.senderRole) === "admin" ? "MyDancr" : userLabel;
                return (
                <div data-support-message-id={String(message.senderRole) !== "admin" && !message.readAt ? String(message.id) : undefined} className={String(message.senderRole) === "admin" ? "support-inbox-message from-admin" : "support-inbox-message"} key={String(message.id)}>
                  <div className="support-message-meta"><strong>{senderLabel}</strong><span>{messageTime(message.createdAt)}</span></div>
                  <p>{String(message.body || "")}</p>
                </div>
                );
              })}
            </div>
            <form className="support-reply-composer" onSubmit={event => { event.preventDefault(); void reply(threadId); }}>
            <label className="support-reply-label">Your reply
            <textarea
              aria-label={`Reply to ${userLabel}`}
              rows={4}
              maxLength={4000}
              value={replyByThread[threadId] || ""}
              disabled={Boolean(busyThreadId) || archiving}
              onChange={(event) => setReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
              placeholder="Type your reply here…"
            />
            </label>
            <div className="support-reply-actions">
              {statusByThread[threadId] ? <p role="status">{statusByThread[threadId]}</p> : null}
              <button type="submit" disabled={Boolean(busyThreadId) || archiving}>{busyThreadId === threadId ? "Sending…" : "Send reply"}</button>
            </div>
            </form>
          </article>
        );
      })}
      {hasMore ? <button type="button" disabled={isRefreshing || Boolean(busyThreadId) || archiving} onClick={() => void refreshMessages(true)}>Load more messages</button> : null}
    </div>
  );
}

function ReportManager({
  active = true,
  reports,
  onReportsChange,
}: {
  active?: boolean;
  reports: Array<Record<string, unknown>>;
  onReportsChange: (reports: Array<Record<string, unknown>>) => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [busyReportId, setBusyReportId] = useState("");
  const [profileLoadingId, setProfileLoadingId] = useState("");
  const [previewReport, setPreviewReport] = useState<Record<string, unknown> | null>(null);
  const [previewProfile, setPreviewProfile] = useState<Record<string, unknown> | null>(null);
  const [previewStatus, setPreviewStatus] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const profileAbortRef = useRef<AbortController | null>(null);
  const draftNotesRef = useRef<Record<string, string>>({});

  useVisibleAutoRefresh({ active, refresh: async (signal, isCurrent) => {
    if (actionInFlightRef.current) return;
    const version = actionSequenceRef.current;
    const data = await requestAdminJson("/api/admin/reports", { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store" });
    if (!isCurrent() || version !== actionSequenceRef.current || actionInFlightRef.current) return;
    if (!Array.isArray(data.reports)) throw new Error("Reports are unavailable.");
    onReportsChange(mergeLiveRows(reports, data.reports, new Set(Object.keys(draftNotesRef.current).filter(id => draftNotesRef.current[id]))));
  } });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      profileAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginReportAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentReportAction(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishReportAction(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setBusyReportId("");
  }

  if (!reports.length) return <p className="empty">No open reports.</p>;

  async function updateReport(reportId: string, action: "resolved" | "removed") {
    const notes = (notesById[reportId] || "").trim();
    if (notes.length < 10) { setStatusById(current => ({ ...current, [reportId]: "Record the decision, notification or follow-up before closing." })); return; }
    if (action === "removed" && !window.confirm("Restrict this reported item and linked stored-file copies from display? Profile or club reports restrict the entire profile or club.")) return;
    const request = beginReportAction();
    if (!request) return;
    setBusyReportId(reportId);
    setStatusById((current) => ({ ...current, [reportId]: "Saving..." }));
    try {
      await requestAdminJson("/api/admin/reports", {
        method: "PATCH",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId, action, notes }),
        fallbackMessage: "Unable to update report.",
      });
      if (!isCurrentReportAction(request)) return;
      onReportsChange(reports.filter((report) => String(report.id) !== reportId));
    } catch (error) {
      if (!isCurrentReportAction(request)) return;
      setStatusById((current) => ({
        ...current,
        [reportId]: error instanceof Error ? error.message : "Unable to update report. Check your connection and try again.",
      }));
    } finally {
      finishReportAction(request);
    }
  }

  function closeReportedProfile() {
    profileAbortRef.current?.abort();
    profileAbortRef.current = null;
    setProfileLoadingId("");
    setPreviewReport(null);
    setPreviewProfile(null);
    setPreviewStatus("");
  }

  async function openReportedProfile(report: Record<string, unknown>) {
    const profileTarget = asRecordObject(report.profileTarget);
    const profileId = asText(profileTarget.id);
    const reportId = asText(report.id);
    if (asText(profileTarget.kind) !== "dancer" || !profileId || !reportId) return;

    profileAbortRef.current?.abort();
    const controller = new AbortController();
    profileAbortRef.current = controller;
    setProfileLoadingId(reportId);
    setPreviewReport(report);
    setPreviewProfile(null);
    setPreviewStatus("Loading the reported profile...");
    try {
      const profile = await requestAdminDancerProfile(profileId, controller.signal);
      if (!mountedRef.current || controller.signal.aborted || profileAbortRef.current !== controller) return;
      setPreviewProfile(profile);
      setPreviewStatus("");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || profileAbortRef.current !== controller) return;
      setPreviewStatus(error instanceof Error ? error.message : "Unable to load the reported profile.");
    } finally {
      if (profileAbortRef.current === controller) profileAbortRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setProfileLoadingId("");
    }
  }

  return (
    <>
    <div className="report-list">
      <p><Link href="/admin?alert=compliance_case">Open Safety & privacy operations</Link> to assign cases, record notices and follow-up, or restrict content while keeping the case open.</p>
      {reports.map((report) => {
        const reportId = String(report.id || "");
        const intake = asRecordObject(report.intake);
        const profileTarget = asRecordObject(report.profileTarget);
        const profileKind = asText(profileTarget.kind);
        const profileSlug = asText(profileTarget.slug);
        return (
          <div className="report-row" key={reportId}>
            <strong>{String(report.targetLabel || report.targetType || "Reported item")}</strong>
            <span className="report-reason"><b>Why it was reported</b>{String(report.reason || "Reason pending")}</span>
            {report.details ? <p><b>Reporter details</b>{String(report.details)}</p> : null}
            <p><b>{String(report.caseKind || "safety")} - {String(report.priority || "normal")}</b> - Case {reportId}</p>
            <p>Received: {String(report.createdAt || "")}<br />Next action due: {String(report.nextActionDueAt || "Review required")}<br />{String(report.deadlineBasis || "")}</p>
            {Object.entries(intake).filter(([, value]) => value !== "" && value !== null).map(([key, value]) => <p key={key}><b>{key}: </b>{String(value)}</p>)}
            <p>Contact the reporter using the supplied address. This queue does not send a response automatically. For media removal, search for separately uploaded identical copies and record the result.</p>
            <label>Decision and follow-up<textarea maxLength={2000} value={notesById[reportId] || ""} onChange={event => { draftNotesRef.current[reportId] = event.target.value; setNotesById(current => ({ ...current, [reportId]: event.target.value })); }} placeholder="Action taken, duplicate search, reporter response and any further work" /></label>
            <div className="report-actions">
              {profileKind === "dancer" && asText(profileTarget.id) ? (
                <button type="button" className="secondary-action" onClick={() => openReportedProfile(report)} disabled={profileLoadingId === reportId}>
                  {profileLoadingId === reportId ? "Opening profile..." : "View reported profile"}
                </button>
              ) : null}
              {profileKind === "venue" && profileSlug ? (
                <Link className="secondary-action report-profile-link" href={`/venues/${encodeURIComponent(profileSlug)}`} target="_blank">
                  View reported club profile
                </Link>
              ) : null}
              <button type="button" onClick={() => updateReport(reportId, "resolved")} disabled={Boolean(busyReportId)}>
                {busyReportId === reportId ? "Saving..." : "Resolve"}
              </button>
              {report.targetId && ["dancer_profile", "profile_photo", "tv_video", "venue", "shift"].includes(String(report.targetType)) ? <button type="button" onClick={() => updateReport(reportId, "removed")} disabled={Boolean(busyReportId)}>Restrict content and close</button> : null}
            </div>
            {statusById[reportId] ? <p>{statusById[reportId]}</p> : null}
          </div>
        );
      })}
    </div>
    {previewReport ? (
      <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label="Reported dancer profile" onClick={closeReportedProfile}>
        <div className="admin-preview-modal admin-profile-modal reported-profile-modal" onClick={(event) => event.stopPropagation()}>
          <button className="admin-preview-close" type="button" onClick={closeReportedProfile} data-close-control="" aria-label="Close reported profile"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
          <h3>{previewProfile ? `${asText(previewProfile.stageName || previewProfile.stage_name) || "Dancer"} — reported profile` : "Reported profile"}</h3>
          <section className="reported-profile-context" aria-label="Report context">
            <small>Reported target</small>
            <strong>{asText(previewReport.targetLabel || previewReport.targetType) || "Reported profile"}</strong>
            <dl>
              <div><dt>Why it was reported</dt><dd>{asText(previewReport.reason) || "Reason pending"}</dd></div>
              <div><dt>Reporter details</dt><dd>{asText(previewReport.details) || "No additional details were supplied."}</dd></div>
              <div><dt>Reported</dt><dd>{formatDate(previewReport.createdAt)}</dd></div>
              <div><dt>Target record</dt><dd>{labelize(asText(previewReport.targetType))} · {asText(previewReport.targetId) || "No record ID"}</dd></div>
            </dl>
          </section>
          {previewStatus ? <p role={previewStatus.startsWith("Unable") ? "alert" : "status"}>{previewStatus}</p> : null}
          {previewProfile ? (
            <AdminDancerFullProfile
              profile={previewProfile}
              activeTab="all"
              actionBusy
              deletingContentKey=""
              onDeletePhoto={() => undefined}
              onDeleteSocial={() => undefined}
            />
          ) : null}
        </div>
      </div>
    ) : null}
    </>
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
  onContinueSetup,
}: {
  requests: Array<Record<string, unknown>>;
  venues: Array<Record<string, unknown>>;
  claimCodes: Array<Record<string, unknown>>;
  onRequestsChange: (requests: Array<Record<string, unknown>>) => void;
  onVenuesChange: (venues: Array<Record<string, unknown>>) => void;
  onClaimCodesChange: (claimCodes: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
  onContinueSetup?: (venueId: string) => void;
}) {
  const [notesByRequest, setNotesByRequest] = useState<Record<string, string>>({});
  const [statusByRequest, setStatusByRequest] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState("");
  const [approvedVenue, setApprovedVenue] = useState<{ id: string; name: string } | null>(null);
  const [issuedAccess, setIssuedAccess] = useState<{
    requestId: string;
    venueName: string;
    code: string;
    emailDelivered: boolean;
  } | null>(null);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginVenueSignupReview() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentVenueSignupReview(request: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !request.controller.signal.aborted && request.requestId === actionSequenceRef.current;
  }

  function finishVenueSignupReview(request: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === request.controller) actionAbortRef.current = null;
    if (request.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && request.requestId === actionSequenceRef.current) setBusyRequestId("");
  }

  async function reviewRequest(request: Record<string, unknown>, decision: "approved" | "rejected") {
    const requestId = asText(request.id);
    const notes = notesByRequest[requestId]?.trim() || "";
    if (decision === "rejected" && !notes) {
      setStatusByRequest((current) => ({ ...current, [requestId]: "Add a reason before rejecting this request." }));
      return;
    }
    if (decision === "rejected" && !window.confirm(`Reject ${asText(request.venueName) || "this club"}'s access request?`)) return;
    const review = beginVenueSignupReview();
    if (!review) return;

    setBusyRequestId(requestId);
    setStatusByRequest((current) => ({
      ...current,
      [requestId]: decision === "approved" ? "Approving club and creating private access..." : "Rejecting request...",
    }));

    try {
      const data = await requestAdminJson("/api/admin/venue-signup-requests", {
        method: "POST",
        signal: review.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId,
          decision,
          notes: notes || null,
          confirmAgentReferral: decision === "approved" && Boolean(asText(request.referringAgentId)),
        }),
        fallbackMessage: "Unable to review the club request.",
      });
      if (!isCurrentVenueSignupReview(review)) return;

      onRequestsChange(requests.filter((item) => asText(item.id) !== requestId));
      if (decision === "approved" && data.venue?.id) {
        const venueId = asText(data.venue.id);
        setApprovedVenue({ id: venueId, name: asText(data.venue.name) || asText(request.venueName) });
        const normalizedVenue = {
          ...data.venue,
          signup_request: data.request || request,
          is_active: data.venue.isActive !== false,
          owner_user_id: data.managerAccountReady ? asText(data.request?.requesterUserId) : null,
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
        if (data.accessCode) setIssuedAccess({
          requestId,
          venueName: asText(data.venue.name) || asText(request.venueName),
          code: asText(data.accessCode),
          emailDelivered: data.emailDelivery?.delivered === true,
        });
        else setIssuedAccess(null);
      }
      onActionConfirmed(data.message || (decision === "approved" ? "Club request approved." : "Club request rejected."));
    } catch (error) {
      if (!isCurrentVenueSignupReview(review)) return;
      setStatusByRequest((current) => ({
        ...current,
        [requestId]: error instanceof Error ? error.message : "Unable to review the club request.",
      }));
    } finally {
      finishVenueSignupReview(review);
    }
  }

  async function copyIssuedAccessCode() {
    if (!issuedAccess?.code) return;
    try {
      await copyAdminText(issuedAccess.code);
      onActionConfirmed("Private club access code copied.");
    } catch {
      onActionConfirmed("Select and copy the private access code manually.");
    }
  }

  return (
    <section className="venue-request-queue" aria-labelledby="venue-request-queue-title">
      <div className="venue-request-queue-head">
        <span>
          <strong id="venue-request-queue-title">Club signup requests</strong>
          <small>Verify the business before issuing manager access.</small>
        </span>
        <em>{requests.length} pending</em>
      </div>
      <AdminInboxActions disabled={Boolean(busyRequestId) || archiving} items={requests.map(request => ({ kind: "club_application", id: asText(request.id), version: asText(request.updatedAt), title: asText(request.venueName) || "Club application" }))}
        onStart={() => { actionInFlightRef.current = true; setArchiving(true); }}
        onSettled={() => { actionInFlightRef.current = false; setArchiving(false); }}
        onComplete={archived => onRequestsChange(requests.filter(request => !archived.some(item => item.id === asText(request.id))))} />
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
      {approvedVenue && onContinueSetup ? <button type="button" disabled={Boolean(busyRequestId) || archiving} onClick={() => onContinueSetup(approvedVenue.id)}>Continue {approvedVenue.name} setup →</button> : null}
      <div className="venue-request-list">
        {requests.map((request) => {
          const requestId = asText(request.id);
          const isBusy = busyRequestId === requestId;
          return (
            <details className="venue-request-row" key={requestId}>
              <summary>
                <span>
                  <strong>{asText(request.venueName) || "Club request"}</strong>
                  <small>{[asText(request.city), asText(request.state)].filter(Boolean).join(", ")} · {asText(request.contactName)}{request.referringAgentId ? ` · Referred by ${asText(request.referringAgentName) || "sales agent"}` : ""}</small>
                </span>
                <span className="venue-disclosure" aria-hidden="true">⌄</span>
              </summary>
              <div className="venue-request-details">
                <dl>
                  <div><dt>Public address</dt><dd>{[asText(request.streetAddress), asText(request.city), asText(request.state), asText(request.postalCode)].filter(Boolean).join(", ")}</dd></div>
                  <div><dt>Contact</dt><dd>{asText(request.contactName)} · {asText(request.contactTitle)}</dd></div>
                  <div><dt>Business email</dt><dd><a href={`mailto:${asText(request.contactEmail)}`}>{asText(request.contactEmail)}</a></dd></div>
                  {request.loginEmail ? <div><dt>Manager login</dt><dd>{asText(request.loginEmail)} · Login already created</dd></div> : null}
                  <div><dt>Business phone</dt><dd><a href={`tel:${asText(request.contactPhone)}`}>{asText(request.contactPhone)}</a></dd></div>
                  {request.website ? <div><dt>Website</dt><dd><a href={asText(request.website)} target="_blank" rel="noopener noreferrer">Open website</a></dd></div> : null}
                  {request.message ? <div><dt>Request note</dt><dd>{asText(request.message)}</dd></div> : null}
                  {request.referringAgentId ? <div><dt>Agent referral</dt><dd>{asText(request.referringAgentName) || "Active sales agent"} · confirm this relationship before approval</dd></div> : null}
                  <div><dt>Submitted</dt><dd>{formatDate(request.submittedAt)}</dd></div>
                </dl>
                <div className="venue-request-private-workspace">
                  <strong>{request.referringAgentId ? "Approval confirms the agent referral" : "Approval creates a private club workspace"}</strong>
                  <small>{request.referringAgentId
                    ? `Confirm that ${asText(request.referringAgentName) || "the listed sales agent"} introduced this club. Approval records the agent attribution and creates the private club workspace.`
                    : "The club manager receives a one-time signup code and completes the club page. MyDancr reviews and publishes Club Deals included with the club subscription."}</small>
                </div>
                <label>
                  Review notes
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={notesByRequest[requestId] || ""}
                    onChange={(event) => setNotesByRequest((current) => ({ ...current, [requestId]: event.target.value }))}
                    placeholder="Required when rejecting; optional internal note when approving"
                    disabled={Boolean(busyRequestId) || archiving}
                  />
                </label>
                <div className="venue-request-actions">
                  <button type="button" disabled={Boolean(busyRequestId) || archiving} onClick={() => reviewRequest(request, "approved")}>
                    {isBusy ? "Working..." : request.referringAgentId ? "Confirm agent & approve" : "Approve & send access"}
                  </button>
                  <button className="secondary" type="button" disabled={Boolean(busyRequestId) || archiving} onClick={() => reviewRequest(request, "rejected")}>
                    Reject request
                  </button>
                </div>
                {statusByRequest[requestId] ? <p role="status" aria-live="polite">{statusByRequest[requestId]}</p> : null}
              </div>
            </details>
          );
        })}
        {!requests.length ? <p className="empty">No club signup requests are waiting for review.</p> : null}
      </div>
    </section>
  );
}

function VenueManager({
  clubDeals, dealRequests, onClubDealsChange, onDealRequestsChange, onActionConfirmed,
  venues,
  claimCodes,
  onVenuesChange,
  onClaimCodesChange,
  onOpenOperations,
  requestedClubId = "", onClubChange, requestedDealTarget,
}: {
  clubDeals: Array<Record<string, unknown>>;
  dealRequests: Array<Record<string, unknown>>;
  onClubDealsChange: (deals: Array<Record<string, unknown>>) => void;
  onDealRequestsChange: (requests: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
  venues: Array<Record<string, unknown>>;
  claimCodes: Array<Record<string, unknown>>;
  onVenuesChange: (venues: Array<Record<string, unknown>>) => void;
  onClaimCodesChange: (claimCodes: Array<Record<string, unknown>>) => void;
  onOpenOperations: (venueId: string, section: AdminGuestSection) => void;
  requestedClubId?: string; onClubChange?: (id: string) => void;
  requestedDealTarget?: { id: string; venueId: string; revision: number } | null;
}) {
  const [openedVenues, setOpenedVenues] = useState<Record<string, boolean>>({});
  const [commercialStates, setCommercialStates] = useState<Record<string, { dirty: boolean; busy: boolean }>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [pageDrafts, setPageDrafts] = useState<Record<string, ClubPageDraft>>(() => Object.fromEntries(
    venues.flatMap(venue => { const id = asText(venue.id), draft = loadAdminFormDraft("club-page", id); return draft ? [[id, draft]] : []; }),
  ));
  const [unsavedByVenue, setUnsavedByVenue] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(pageDrafts).map(id => [id, true])));
  const [hoursResetByVenue, setHoursResetByVenue] = useState<Record<string, number>>({});
  const [statusByVenue, setStatusByVenue] = useState<Record<string, string>>({});
  const [busyVenueId, setBusyVenueId] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const controlsBusy = Boolean(busyVenueId);
  const requestedVenueAvailable = venues.some(venue => asText(venue.id) === requestedClubId);
  const revealedDealRevision = useRef(0);

  useEffect(() => {
    if (!requestedDealTarget || !openedVenues[requestedDealTarget.venueId] || revealedDealRevision.current === requestedDealTarget.revision) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`admin-deal-request-${requestedDealTarget.id}`);
      if (!target) return;
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      revealedDealRevision.current = requestedDealTarget.revision;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedDealTarget, openedVenues, dealRequests]);

  useEffect(() => {
    if (!requestedClubId || !requestedVenueAvailable) return;
    setSearchQuery("");
    setOpenedVenues(current => ({ ...current, [requestedClubId]: true }));
    const frame = window.requestAnimationFrame(() => {
      const row = document.getElementById(`admin-club-${requestedClubId}`);
      if (row instanceof HTMLDetailsElement) { row.open = true; row.scrollIntoView({ block: "start", behavior: "smooth" }); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedClubId, requestedVenueAvailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginVenueAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentVenueAction(action: { controller: AbortController; requestId: number }) {
    return mountedRef.current && !action.controller.signal.aborted && action.requestId === actionSequenceRef.current;
  }

  function finishVenueAction(action: { controller: AbortController; requestId: number }) {
    if (actionAbortRef.current === action.controller) actionAbortRef.current = null;
    if (action.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && action.requestId === actionSequenceRef.current) setBusyVenueId("");
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleVenues = normalizedSearch
    ? venues.filter((venue) => [venue.name, venue.city, venue.state, venue.address]
      .some((value) => asText(value).toLowerCase().includes(normalizedSearch)))
    : venues;

  function setVenueStatus(venueId: string, message: string) {
    setStatusByVenue((current) => ({ ...current, [venueId]: message }));
  }

  function clearPageDraft(venueId: string) {
    saveAdminFormDraft("club-page", venueId, null);
    setPageDrafts(current => { const next = { ...current }; delete next[venueId]; return next; });
  }

  function keepPageDraft(venueId: string, form: HTMLFormElement, hours?: { opensAt: string; closesAt: string; openDays?: string; weeklyHours?: string }) {
    const values = new FormData(form);
    const fields = ["name", "address", "city", "state", "phone", "website", "timezone", "opensAt", "closesAt", "openDays", "weeklyHours", "transportEnabled"];
    const draft = { ...Object.fromEntries(fields.map(key => [key, String(values.get(key) || "")])), ...hours } as ClubPageDraft;
    setPageDrafts(current => ({ ...current, [venueId]: draft }));
    setUnsavedByVenue(current => ({ ...current, [venueId]: true }));
    if (!saveAdminFormDraft("club-page", venueId, draft)) setVenueStatus(venueId, "Draft recovery is unavailable in this browser. Save progress before refreshing.");
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
    const form = new FormData(event.currentTarget);
    const isPublished = venue.is_active !== false;
    const fields = ["name", "address", "city", "state", "phone", "website", "timezone", "opensAt", "closesAt"];
    const body = Object.fromEntries(fields
      .map((key) => [key, String(form.get(key) || "").trim()]));
    const action = beginVenueAction();
    if (!action) return;
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, isPublished ? "Updating published club page..." : "Saving private club page...");
      const data = await requestAdminJson("/api/admin/venues", {
        method: "PATCH",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, ...body, ...(form.get("weeklyHours") ? { weeklyHours: JSON.parse(String(form.get("weeklyHours"))) } : {}), openDays: String(form.get("openDays") ?? "0,1,2,3,4,5,6").split(",").filter(Boolean).map(Number), transportEnabled: form.get("transportEnabled") === "yes" }),
        fallbackMessage: "Unable to save club page.",
      });
      if (!isCurrentVenueAction(action)) return;
      if (!data.venue) throw new Error("Unable to save club page.");
      clearPageDraft(venueId);
      mergeVenue(venueId, data.venue);
      setUnsavedByVenue(current => ({ ...current, [venueId]: false }));
      setVenueStatus(venueId, isPublished ? "Club page updated. Your changes are live." : venue.page_review_status === "published" ? "Club details updated. Approval is saved and the club remains hidden." : "Private page saved. Complete the remaining items before sending it for approval.");
    } catch (error) {
      if (!isCurrentVenueAction(action)) return;
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to save club page.");
    } finally {
      finishVenueAction(action);
    }
  }

  async function uploadVenueImage(venue: Record<string, unknown>, kind: "logo" | "cover", file: File | null) {
    const venueId = asText(venue.id);
    if (!file) return setVenueStatus(venueId, `Choose a ${kind} image first.`);
    const action = beginVenueAction();
    if (!action) return;
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, `Checking and uploading club ${kind}...`);
      const body = new FormData();
      body.set("venueId", venueId);
      body.set("kind", kind);
      body.set("file", file);
      const data = await requestAdminJson("/api/admin/venues/media", {
        method: "POST",
        signal: action.controller.signal,
        body,
        fallbackMessage: `Unable to upload club ${kind}.`,
      });
      if (!isCurrentVenueAction(action)) return;
      if (!data.venue) throw new Error(`Unable to upload club ${kind}.`);
      mergeVenue(venueId, data.venue);
      if (data.pendingReview) {
        setVenueStatus(venueId, asText(data.message));
        return;
      }
      setVenueStatus(venueId, venue.is_active !== false ? `Club ${kind} updated on the live page.` : venue.page_review_status === "published" ? `Club ${kind} updated. Approval is saved and the club remains hidden.` : `Club ${kind} uploaded. Complete the page, then send it for approval.`);
    } catch (error) {
      if (!isCurrentVenueAction(action)) return;
      setVenueStatus(venueId, error instanceof Error ? error.message : `Unable to upload club ${kind}.`);
    } finally {
      finishVenueAction(action);
    }
  }

  async function removeVenueImage(venue: Record<string, unknown>, kind: "logo" | "cover") {
    const venueId = asText(venue.id);
    if (!window.confirm(`Remove this club ${kind}?`)) return;
    const action = beginVenueAction();
    if (!action) return;
    try {
      setBusyVenueId(venueId);
      const data = await requestAdminJson("/api/admin/venues/media", {
        method: "DELETE",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, kind }),
        fallbackMessage: `Unable to remove club ${kind}.`,
      });
      if (!isCurrentVenueAction(action)) return;
      if (!data.venue) throw new Error(`Unable to remove club ${kind}.`);
      mergeVenue(venueId, data.venue);
      setVenueStatus(venueId, `Club ${kind} removed.`);
    } catch (error) {
      if (!isCurrentVenueAction(action)) return;
      setVenueStatus(venueId, error instanceof Error ? error.message : `Unable to remove club ${kind}.`);
    } finally {
      finishVenueAction(action);
    }
  }

  async function sendVenuePageForReview(venue: Record<string, unknown>) {
    const venueId = asText(venue.id);
    const action = beginVenueAction();
    if (!action) return;
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, "Sending private page to the club...");
      const data = await requestAdminJson("/api/admin/venues", {
        method: "PATCH",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, action: "send_for_review" }),
        fallbackMessage: "Unable to update club page workflow.",
      });
      if (!isCurrentVenueAction(action)) return;
      if (!data.venue) throw new Error("Unable to update club page workflow.");
      mergeVenue(venueId, data.venue);
      setVenueStatus(venueId, "Review sent. The club can now approve the exact page and make it live.");
    } catch (error) {
      if (!isCurrentVenueAction(action)) return;
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to update club page workflow.");
    } finally {
      finishVenueAction(action);
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

  function openSetupStep(venueId: string, step: string) {
    const row = document.getElementById(`admin-club-${venueId}`);
    const target = row?.querySelector<HTMLElement>(`[data-setup-step="${step}"]`);
    if (!target) return;
    const disclosure = target.querySelector("details");
    if (disclosure) disclosure.open = true;
    for (let parent: HTMLElement | null = target; parent && parent !== row; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    target.querySelector<HTMLElement>("summary, input, button, a")?.focus({ preventScroll: true });
  }

  async function changeVenueVisibility(venue: Record<string, unknown>, visible: boolean) {
    const venueId = asText(venue.id);
    const name = asText(venue.name) || "this club";
    if (!window.confirm(visible
      ? `Restore ${name} to the public site using its existing approval?`
      : `Hide ${name} from the public site? Its approval, dancers and setup will be kept.`)) return;
    const action = beginVenueAction();
    if (!action) return;
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, visible ? "Restoring club to the public site…" : "Hiding club from the public site…");
      const data = await requestAdminJson("/api/admin/venues", {
        method: "PATCH",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, action: visible ? "restore" : "hide" }),
        fallbackMessage: "Unable to update club.",
      });
      if (!isCurrentVenueAction(action)) return;
      if (!data.venue || data.venue.id !== venueId || data.venue.is_active !== visible || data.venue.page_review_status !== "published") throw new Error("Could not confirm the club visibility change. Refresh and try again.");

      onVenuesChange(venues.map((item) => (String(item.id) === venueId ? { ...item, ...data.venue } : item)));
      setVenueStatus(venueId, visible ? "Club restored. Its existing approval and setup were kept." : "Club hidden. Its approval and setup are saved; you can restore it here.");
    } catch (error) {
      if (!isCurrentVenueAction(action)) return;
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to update club.");
    } finally {
      finishVenueAction(action);
    }
  }

  async function revokeAccessCode(venueId: string, claimCode: Record<string, unknown>) {
    if (!window.confirm("Revoke this access code? It will stop working immediately.")) return;
    const action = beginVenueAction();
    if (!action) return;
    try {
      setBusyVenueId(venueId);
      setVenueStatus(venueId, "Revoking access code...");
      const data = await requestAdminJson("/api/admin/venue-claim-codes", {
        method: "POST",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", codeId: asText(claimCode.id) }),
        fallbackMessage: "Unable to revoke club access code.",
      });
      if (!isCurrentVenueAction(action)) return;
      if (!data.claimCode) throw new Error("Unable to revoke club access code.");

      onClaimCodesChange(claimCodes.map((item) => (
        asText(item.id) === asText(data.claimCode.id) ? data.claimCode : item
      )));
      setVenueStatus(venueId, "Access code revoked.");
    } catch (error) {
      if (!isCurrentVenueAction(action)) return;
      setVenueStatus(venueId, error instanceof Error ? error.message : "Unable to revoke club access code.");
    } finally {
      finishVenueAction(action);
    }
  }

  return (
    <div className="venue-manager">
      <p className="admin-info-note">Approve a submitted request to create its private workspace. MyDancr then builds the full club page and sends the exact page to the connected club manager. The manager can request changes or approve it to make it live.</p>
      <label className="venue-search">
        Find club
        <input
          type="search"
          value={searchQuery}
          disabled={controlsBusy}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search name, city, state, or address"
        />
      </label>
      <div className="venue-list-heading">
        <strong>Club access</strong>
        <small>{visibleVenues.length} {visibleVenues.length === 1 ? "club" : "clubs"}</small>
      </div>
      <div className="venue-list">
        {visibleVenues.map((venue) => {
          const venueId = asText(venue.id);
          const pageDraft = pageDrafts[venueId];
          const activeCode = activeCodeForVenue(venueId);
          const availableCity = findAvailableMyDancrCity(venue.city);
          const registration = asRecordObject(venue.signup_request);
          const connectedManager = Boolean(asText(venue.owner_user_id || venue.ownerUserId));
          const isActive = venue.is_active !== false;
          const reviewStatus = asText(venue.page_review_status) || (isActive ? "published" : "admin_draft");
          const setupComplete = isActive || Boolean(venue.published_at);
          const canRestore = !isActive && reviewStatus === "published" && Boolean(venue.published_at);
          const commercialDirty = commercialStates[venueId + ":deal"]?.dirty;
          const commercialBusy = commercialStates[venueId + ":deal"]?.busy;
          const requirements = [
            { label: "Club details", complete: Boolean(asText(venue.name) && asText(venue.address) && availableCity && asText(venue.state)) },
            { label: "Public phone", complete: Boolean(asText(venue.phone)) },
            { label: "Club hours", complete: Boolean(asText(venue.opens_at) && asText(venue.closes_at)) },
            { label: "Club logo", complete: Boolean(asText(venue.logo_image_url)) },
            { label: "Active Club Deal", complete: clubDeals.some(deal => asText(deal.venueId) === venueId && deal.isActive === true) },
          ];
          const isReady = requirements.every((requirement) => requirement.complete);
          const reviewLabel = canRestore ? "Hidden · approval saved" : reviewStatus === "venue_review"
            ? "Waiting for club approval"
            : reviewStatus === "changes_requested"
              ? "Changes requested"
              : reviewStatus === "venue_approved"
                ? "Club approved"
                : reviewStatus === "published"
                  ? requirements[4].complete ? "Live" : "Hidden · needs an active deal"
                  : "MyDancr draft";
          return (
            <details className="venue-admin-row" id={`admin-club-${venueId}`} key={venueId} onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open) { setOpenedVenues(current => current[venueId] ? current : { ...current, [venueId]: true }); onClubChange?.(venueId); } }}>
              <summary>
                <span className="venue-admin-identity">
                  <strong>{asText(venue.name) || "Club"}</strong>
                  <small>{[asText(venue.city) || "City", asText(venue.state)].filter(Boolean).join(", ")}</small>
                </span>
                <span className="venue-admin-summary-state">
                  <em className={reviewStatus === "published" || reviewStatus === "venue_approved" ? "connected" : isActive ? "active" : "inactive"}>
                    {reviewLabel}
                  </em>
                  <span className="venue-disclosure" aria-hidden="true">⌄</span>
                </span>
              </summary>
              {reviewStatus === "changes_requested" && asText(venue.page_review_notes) ? (
                <div className="venue-page-change-request"><strong>Club requested changes</strong><p>{asText(venue.page_review_notes)}</p>{venue.page_reviewed_at ? <small>{formatDate(venue.page_reviewed_at)}</small> : null}</div>
              ) : null}
              {openedVenues[venueId] ? <AdminClubSetupChecklist venue={venue} pageReady={requirements.slice(0, 3).every(item => item.complete)} hasDeal={requirements[4].complete} onOpen={step => openSetupStep(venueId, step)} /> : null}
              <nav className="admin-club-shortcuts" aria-label={`${asText(venue.name)} operations`}>
                {([["visits", "VIP visits"], ["guests", "Guest list"], ["rides", "Ride requests"], ["results", "Results"]] as const).map(([section, label]) => <button key={section} type="button" disabled={controlsBusy} onClick={() => onOpenOperations(venueId, section)}>{label}</button>)}
              </nav>
              <div className="venue-admin-actions">
                <small>{asText(venue.address) || "No address submitted"}</small>
                {isActive ? <button type="button" disabled={controlsBusy} onClick={() => changeVenueVisibility(venue, false)}>Hide club</button>
                  : canRestore ? <button type="button" disabled={controlsBusy || !isReady || Boolean(commercialDirty || unsavedByVenue[venueId])} onClick={() => changeVenueVisibility(venue, true)}>Restore club</button>
                  : <span>{reviewLabel} · {connectedManager ? "manager connected" : "waiting for manager account"}</span>}
                {canRestore && !isReady ? <small>Complete the club details and active deal below before restoring.</small> : null}
                {statusByVenue[venueId] ? <p role="status" aria-live="polite">{statusByVenue[venueId]}</p> : null}
              </div>
              {registration.id ? <details className="admin-record-section" data-setup-step="application">
                <summary>Original signup details</summary>
                <section className="submission-section" aria-label="Club registration details">
                <h3>Provided during signup</h3>
                <p className="empty">Original club submission. The managed page below contains the current public details.</p>
                <div className="submission-grid">
                  <SubmissionValue label="Club name" value={registration.venueName} />
                  <SubmissionValue label="Public address" value={[registration.streetAddress, registration.city, registration.state, registration.postalCode].filter(Boolean).join(", ")} wide />
                  <SubmissionValue label="Contact name" value={registration.contactName} />
                  <SubmissionValue label="Contact title" value={registration.contactTitle} />
                  <SubmissionValue label="Business email" value={registration.contactEmail} />
                  <SubmissionValue label="Business phone" value={registration.contactPhone} />
                  <SubmissionValue label="Manager login email" value={registration.loginEmail} />
                  <SubmissionValue label="Website" value={registration.website} />
                  {registration.message ? <SubmissionValue label="Signup note" value={registration.message} wide /> : null}
                  <SubmissionValue label="Submitted" value={formatDate(registration.submittedAt)} />
                </div>
              </section></details> : null}
              <details className="admin-record-section">
              <summary data-setup-step="access">Manager access</summary>
              <section className="venue-access-panel" aria-label={`${asText(venue.name) || "Club"} access code`}>
                <span className="eyebrow">Manager access</span>
                {connectedManager ? (
                  <div className="venue-access-state connected">
                    <strong>Club account connected</strong>
                    <p>A verified manager already controls this club. Access codes are disabled.</p>
                  </div>
                ) : activeCode ? (
                  <>
                    <div className="venue-access-state">
                      <strong>Active one-time access code</strong>
                      <p>
                        {`Created from the approved club request and expires ${formatDate(activeCode.expiresAt)}. The code can be used once to create this club's manager account.`}
                      </p>
                    </div>
                    <div className="venue-access-actions">
                      <button className="secondary" type="button" disabled={controlsBusy} onClick={() => revokeAccessCode(venueId, activeCode)}>
                        Revoke access code
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="venue-access-state inactive">
                    <strong>No active access code</strong>
                    <p>Review the original club request. New codes are issued only through the approved request workflow.</p>
                  </div>
                )}
              </section>
              </details>
              <details className="admin-record-section" data-setup-step="page">
              <summary>{setupComplete ? "Club details & deal" : "Prepare club page & deal"}</summary>
              <section className="venue-page-admin-panel" aria-label={`${asText(venue.name) || "Club"} managed page`}>
                <div className="venue-page-admin-heading">
                  <span><small>Managed club page</small><strong>{reviewLabel}</strong></span>
                  <b>{isReady ? "Ready" : "Details needed"}</b>
                </div>
                <form id={`venue-page-editor-${venueId}`} key={`${venueId}:${hoursResetByVenue[venueId] || 0}`} className="venue-page-editor" data-admin-unsaved={Boolean(unsavedByVenue[venueId])} onChange={event => {
                  if (!((event.target as HTMLElement).getAttribute("name") || "").startsWith("clubHours")) keepPageDraft(venueId, event.currentTarget);
                }} onReset={() => { clearPageDraft(venueId); setHoursResetByVenue(current => ({ ...current, [venueId]: (current[venueId] || 0) + 1 })); }} onSubmit={(event) => void saveVenuePage(event, venue)} onInvalidCapture={(event) => {
                  const input = event.target as HTMLInputElement;
                  setVenueStatus(venueId, `${input.labels?.[0]?.textContent || "Field"}: ${input.validationMessage}`);
                }}>
                  <label>Club name<input name="name" defaultValue={pageDraft?.name ?? asText(venue.name)} required readOnly={controlsBusy} /></label>
                  <label>Public address<input name="address" defaultValue={pageDraft?.address ?? asText(venue.address)} readOnly={controlsBusy} />{!asText(venue.address) && <small>Needed before approval</small>}</label>
                  <label>City
                    <select name="city" defaultValue={pageDraft?.city ?? availableCity ?? ""} required disabled={controlsBusy}>
                      <option value="" disabled>Select an available city</option>
                      {MYDANCR_AVAILABLE_CITIES.map(city => <option key={city} value={city}>{city}</option>)}
                    </select>
                    {!availableCity && asText(venue.city) ? <small>The submitted city, {asText(venue.city)}, is unavailable. Select an available city.</small> : null}
                  </label>
                  <label>State<input name="state" defaultValue={pageDraft?.state ?? asText(venue.state)} readOnly={controlsBusy} />{!asText(venue.state) && <small>Needed before approval</small>}</label>
                  <label>Public phone<input name="phone" defaultValue={pageDraft?.phone ?? asText(venue.phone)} readOnly={controlsBusy} type="tel" />{!asText(venue.phone) && <small>Needed before approval</small>}</label>
                  <label>Website<input name="website" defaultValue={pageDraft?.website ?? asText(venue.website)} readOnly={controlsBusy} inputMode="url" /></label>
                  <label>Offers transport
                    <select name="transportEnabled" defaultValue={pageDraft?.transportEnabled ?? (venue.transport_enabled === true ? "yes" : "no")} disabled={controlsBusy}>
                      <option value="no">No</option><option value="yes">Yes</option>
                    </select>
                    <small>Enables guest ride requests and the club’s transport inbox.</small>
                  </label>
                  <label>Time zone<input name="timezone" defaultValue={pageDraft?.timezone ?? (asText(venue.timezone) || "America/Los_Angeles")} required readOnly={controlsBusy} /></label>
                  <AdminClubHoursFields key={JSON.stringify([venue.opens_at, venue.closes_at, venue.open_days, venue.weekly_hours, hoursResetByVenue[venueId]])}
                    opensAt={pageDraft?.opensAt ?? asText(venue.opens_at)} closesAt={pageDraft?.closesAt ?? asText(venue.closes_at)} busy={controlsBusy}
                    openDays={pageDraft?.openDays !== undefined ? pageDraft.openDays.split(",").filter(Boolean).map(Number) : Array.isArray(venue.open_days) ? venue.open_days as number[] : undefined}
                    weeklyHours={pageDraft ? undefined : venue.weekly_hours} weeklyHoursDraft={pageDraft?.weeklyHours}
                    onHoursChange={(hours, form) => { if (form) keepPageDraft(venueId, form, hours); }} />
                  {!requirements[2].complete && <small>Set opening and closing hours before approval.</small>}
                  {isActive ? <small>Save changes to update the live club page.</small> : null}
                </form>
                <div className="venue-page-media-admin" data-setup-step="branding">
                  {(["logo", "cover"] as const).map((kind) => {
                    const imageUrl = asText(venue[`${kind}_image_url`]);
                    return (
                      <form key={kind} onSubmit={(event) => {
                        event.preventDefault();
                        const file = new FormData(event.currentTarget).get("file");
                        void uploadVenueImage(venue, kind, file instanceof File ? file : null);
                      }}>
                        <strong>{kind === "logo" ? "Official logo" : "Club detail cover (optional)"}</strong>
                        <small>{kind === "logo" ? "Use the original high-resolution logo file." : "Use the original camera image for the clearest club page."}</small>
                        {imageUrl ? <img src={imageUrl} data-club-logo={kind === "logo" ? "" : undefined} alt={`${asText(venue.name)} ${kind}`} /> : <span>{kind === "logo" ? "Logo needed before approval" : "No cover uploaded"}</span>}
                        <input accept="image/*,.heic,.heif" name="file" type="file" required disabled={controlsBusy} />
                        <button type="submit" disabled={controlsBusy}>{imageUrl ? `Replace ${kind}` : `Upload ${kind}`}</button>
                        {imageUrl ? <button className="secondary" type="button" disabled={controlsBusy} onClick={() => void removeVenueImage(venue, kind)}>Remove</button> : null}
                      </form>
                    );
                  })}
                </div>
                {openedVenues[venueId] ? <section className="venue-commercial-setup" data-setup-step="deal" aria-label={`${asText(venue.name)} Club Deal and contract`}>
                  <AdminClubDealManager scopedVenueId={venueId} venues={[venue]} clubDeals={clubDeals} dealRequests={dealRequests}
                    onClubDealsChange={onClubDealsChange} onDealRequestsChange={onDealRequestsChange} onActionConfirmed={onActionConfirmed}
                    onEditorStateChange={state => setCommercialStates(current => ({ ...current, [venueId + ":deal"]: state }))} />
                </section> : null}
                {!requirements[4].complete && <p>Save an active Club Deal before sending for approval.</p>}
                <div className="venue-page-workflow-actions" data-setup-step="publish">
                  <div className="venue-page-workflow-copy">
                    <small>{setupComplete ? "Club maintenance" : "Club approval"}</small>
                    <strong>{setupComplete ? "Save changes to the club page." : "Preview the page, then send it to the club."}</strong>
                    <p>{setupComplete ? "Routine updates keep the existing approval. Visibility is managed separately above." : "The club reviews its information and deal together, then approves the page to go live."}</p>
                  </div>
                  <button className="secondary-action" type="submit" form={`venue-page-editor-${venueId}`} disabled={controlsBusy || (setupComplete && !unsavedByVenue[venueId])}>{busyVenueId === venueId ? "Saving..." : setupComplete ? "Save changes" : "Save progress"}</button>
                  {unsavedByVenue[venueId] && <><span>Unsaved page changes</span><button type="button" disabled={controlsBusy} onClick={() => {
                    (document.getElementById(`venue-page-editor-${venueId}`) as HTMLFormElement | null)?.reset();
                    setUnsavedByVenue(current => ({ ...current, [venueId]: false }));
                  }}>Cancel changes</button></>}
                  {!setupComplete ? <small>Save progress at any time. Send for approval when the page and deal are ready.</small> : null}
                  {statusByVenue[venueId] ? <p className="venue-status" role="status" aria-live="polite">{statusByVenue[venueId]}</p> : null}
                  <a className="venue-page-preview-action" href={venuePagePreviewHref(venue)} rel="noopener noreferrer" target="_blank">Preview full customer page</a>
                  {!setupComplete && reviewStatus !== "venue_approved" ? (
                    <button type="button" disabled={controlsBusy || Boolean(commercialBusy || commercialDirty || unsavedByVenue[venueId]) || !isReady || !connectedManager} onClick={() => void sendVenuePageForReview(venue)}>{reviewStatus === "venue_review" ? "Resend club review" : "Send for approval"}</button>
                  ) : null}
                  {commercialDirty ? <small>{setupComplete ? "Save the Club Deal and agreement edits in their sections." : "Save the Club Deal and agreement edits in their sections before sending for approval."}</small> : unsavedByVenue[venueId] ? <small>{setupComplete ? "Save your page changes." : "Save your changes before sending this page for approval."}</small> : !isReady && !setupComplete ? <small>Complete every requirement before sending this page to the club.</small> : !connectedManager && !setupComplete ? <small>The manager must redeem the approved access code before review can be sent.</small> : null}
                </div>
              </section>
              </details>
              <details className="admin-record-section">
                <summary>NFC stickers &amp; check-in tags</summary>
              <div data-setup-step="tables">{openedVenues[venueId] ? <AdminInternalNfcTables key={venueId} venueId={venueId} name={asText(venue.name)} /> : null}</div>
              <div data-setup-step="stickers"><Panel title="Dancer Check-In Tags"><AdminNfcInventoryPanel scopedVenueId={venueId} /></Panel></div>
              </details>
              <details className="admin-record-section">
                <summary>Colors &amp; website embed</summary>
                {openedVenues[venueId] ? <AdminVenueColors key={venueId} venueId={venueId} slug={asText(venue.slug)} name={asText(venue.name)} /> : null}
              </details>
            </details>
          );
        })}
        {!visibleVenues.length ? <p className="empty">{venues.length ? "No clubs match this search." : "No clubs returned."}</p> : null}
      </div>
    </div>
  );
}

type ApprovalActionRequest = { controller: AbortController; requestId: number };

function UnifiedReviewQueue({ active = true, profiles, images, videos, warnings, requestedFilter = "all", includeMedia = true, onProfilesChange, onImagesChange, onVideosChange, onRefresh, onActionConfirmed, onManageDancer }: {
  active?: boolean;
  profiles: Array<Record<string, unknown>>; images: Array<Record<string, unknown>>; videos: Array<Record<string, unknown>>;
  warnings: string[]; onProfilesChange: (rows: Array<Record<string, unknown>>) => void;
  requestedFilter?: ReviewKind | "all";
  includeMedia?: boolean;
  onImagesChange: (rows: Array<Record<string, unknown>>) => void; onVideosChange: (rows: Array<Record<string, unknown>>) => void;
  onRefresh: (signal: AbortSignal, preserveProfileId?: string, canApply?: () => boolean) => Promise<void>; onActionConfirmed: (message: string) => void; onManageDancer: (id: string) => void;
}) {
  const [filter, setFilter] = useState<ReviewKind | "all">(requestedFilter);
  useEffect(() => { setFilter(requestedFilter); }, [requestedFilter]);
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const items = adminReviewQueue(profiles, images, videos).filter(item => includeMedia || (item.kind !== "photo" && item.kind !== "video"));
  const filtered = items.filter(item => filter === "all" || item.kind === filter);
  const selected = filtered.find(item => item.key === selectedKey) || filtered[0];
  const index = selected ? filtered.indexOf(selected) : -1;
  const reviewVersion = useRef(0), draft = useRef(false);
  const changeBusy = useCallback((value: boolean) => { reviewVersion.current += 1; setBusy(value); }, []);
  useEffect(() => { draft.current = false; reviewVersion.current += 1; }, [selected?.key]);
  useVisibleAutoRefresh({ active: active && !busy, scopeKey: `${filter}:${selected?.key || ""}`, refresh: async (signal, isCurrent) => {
    if (refreshing) return;
    const version = reviewVersion.current;
    if (selected) setSelectedKey(selected.key);
    await onRefresh(AbortSignal.any([signal, AbortSignal.timeout(15000)]), draft.current ? selected?.dancerId : undefined, () => isCurrent() && reviewVersion.current === version);
  } });
  async function refresh() {
    reviewVersion.current += 1;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setRefreshing(true); setError("");
    try { await onRefresh(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to refresh the review queue."); }
    finally { if (!controller.signal.aborted) setRefreshing(false); }
  }
  function reviewedContent(dancerId: string, kind: "photo" | "social_link", targetId: string, status: "approved" | "rejected", notes: string, version: ContentReviewVersion) {
    onProfilesChange(profiles.map(profile => {
      if (asText(profile.id) !== dancerId) return profile;
      const field = kind === "photo" ? "photos" : "socialLinks";
      return { ...profile, [field]: asRecordArray(profile[field] || profile.social_links).map(row => asText(row.id) === targetId
        ? { ...row, reviewStatus: status, reviewNotes: notes, reviewVersion: version } : row) };
    }));
    setSelectedKey(filtered[index + 1]?.key || "");
  }
  return <section className="admin-unified-review" aria-label="Unified approval queue">
    <div className="admin-review-toolbar">
      <label>Review<select value={filter} disabled={busy || refreshing} onChange={event => { setFilter(event.target.value as typeof filter); setSelectedKey(""); }}>
        {([["all", "All items"], ["application", "Applications"], ["photo", "Photos"], ["video", "Videos"], ["social", "Social links"]] as const).filter(([id]) => includeMedia || (id !== "photo" && id !== "video")).map(([id, label]) => <option key={id} value={id}>{label} · {items.filter(item => id === "all" || item.kind === id).length}</option>)}
      </select></label>
      <RefreshButton label="Refresh approval queue" busy={refreshing} type="button" disabled={busy || refreshing} onClick={() => void refresh()} />
    </div>
    <p className="admin-info-note">{includeMedia ? "Club-approved dancer media waits here for MyDancr’s final review before going live. Required club and verification checks still apply." : "Applications arrive after club approval. Club-approved photos and videos go to Media for final review."}</p>
    {warnings.length ? <p role="alert">Some review sources are unavailable. Refresh to retry. {warnings.join(" ")}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {selected ? <>
      <div className="admin-review-current"><strong>{selected.label}</strong><span>{index + 1} of {filtered.length} loaded items</span></div>
      <div className="admin-review-toolbar">
        <button type="button" disabled={busy || refreshing || index <= 0} onClick={() => setSelectedKey(filtered[index - 1].key)}>Previous</button>
        <button type="button" disabled={busy || refreshing || filtered.length < 2} onClick={() => setSelectedKey(filtered[(index + 1) % filtered.length].key)}>Skip for now</button>
        {selected.dancerId ? <button type="button" disabled={busy || refreshing} onClick={() => onManageDancer(selected.dancerId!)}>Manage dancer</button> : null}
      </div>
      <fieldset disabled={refreshing} className="admin-review-item" key={selected.key} onChangeCapture={() => { draft.current = true; reviewVersion.current += 1; }}>
        {selected.source === "submission" ? <ApprovalQueue items={[selected.record]} reviewTarget={selected}
          openById={{ [selected.dancerId!]: true }} onToggleOpen={() => {}} onKeepOpen={() => {}} onSocialReviewed={() => {}}
          onContentReviewed={reviewedContent} onBusyChange={changeBusy} onManageDancer={onManageDancer}
          onProfileUpdated={profile => onProfilesChange(profiles.map(row => row.id === profile.id ? { ...row, ...profile } : row))}
          onReviewed={id => { onProfilesChange(profiles.filter(profile => profile.id !== id)); setSelectedKey(""); }} onActionConfirmed={onActionConfirmed} /> : null}
        {selected.source === "moderation" ? <ImageModerationQueue records={[selected.record]} focused onBusyChange={changeBusy}
          onRecordsChange={() => {}} onReviewed={(id, decision) => {
            onImagesChange(images.filter(row => row.id !== id));
            if (selected.record.image_id) onProfilesChange(profiles.map(profile => ({ ...profile, photos: asRecordArray(profile.photos).map(photo => photo.id === selected.record.image_id ? { ...photo, reviewStatus: decision } : photo) })));
            setSelectedKey(filtered[index + 1]?.key || ""); if (images.length === 1) void refresh();
          }} onActionConfirmed={onActionConfirmed} /> : null}
        {selected.source === "video" ? <AdminTvPanel selectedVideo={selected.record as unknown as import("./AdminTvPanel").AdminTvVideo} onBusyChange={changeBusy}
          onReviewed={(id, status) => { onVideosChange(videos.map(row => row.id === id ? { ...row, status } : row)); setSelectedKey(filtered[index + 1]?.key || ""); if (videos.filter(row => row.status === "submitted").length === 1) void refresh(); }} onActionConfirmed={onActionConfirmed} /> : null}
      </fieldset>
    </> : <p role="status">{warnings.length || error ? "Available items have been reviewed. Retry the unavailable sources." : "No pending items in this view. Refresh to check for new submissions."}</p>}
  </section>;
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
  reviewTarget, onContentReviewed, onBusyChange, onManageDancer,
}: {
  items: Array<Record<string, unknown>>;
  openById: Record<string, boolean>;
  onToggleOpen: (dancerId: string) => void;
  onKeepOpen: (dancerId: string) => void;
  onSocialReviewed: (dancerId: string, targetId: string, status: "approved" | "rejected", notes: string) => void;
  onProfileUpdated: (profile: Record<string, unknown>) => void;
  onReviewed: (dancerId: string) => void;
  onActionConfirmed: (message: string) => void;
  reviewTarget?: ReviewTarget;
  onContentReviewed?: (dancerId: string, kind: "photo" | "social_link", targetId: string, status: "approved" | "rejected", notes: string, version: ContentReviewVersion) => void;
  onBusyChange?: (busy: boolean) => void;
  onManageDancer?: (id: string) => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [selectedProfile, setSelectedProfile] = useState<Record<string, unknown> | null>(null);
  const [selectedProfileStatus, setSelectedProfileStatus] = useState("");
  const [deletingContentKey, setDeletingContentKey] = useState("");
  const [actionBusyKey, setActionBusyKey] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const controlsBusy = Boolean(actionBusyKey);

  useEffect(() => { onBusyChange?.(controlsBusy); return () => onBusyChange?.(false); }, [controlsBusy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginApprovalAction(): ApprovalActionRequest | null {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, requestId };
  }

  function isCurrentApprovalAction(action: ApprovalActionRequest) {
    return mountedRef.current && !action.controller.signal.aborted && action.requestId === actionSequenceRef.current;
  }

  function finishApprovalAction(action: ApprovalActionRequest) {
    if (actionAbortRef.current === action.controller) actionAbortRef.current = null;
    if (action.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && action.requestId === actionSequenceRef.current) setActionBusyKey("");
  }

  if (!items.length) return <p className="empty">No real pending dancer applications.</p>;

  async function openFullProfile(item: Record<string, unknown>) {
    if (onManageDancer) { onManageDancer(asText(item.id)); return; }
    const action = beginApprovalAction();
    if (!action) return;
    setActionBusyKey(`profile:${asText(item.id)}`);
    setSelectedProfile(item);
    setSelectedProfileStatus("Loading full profile...");
    try {
      const detail = await requestAdminDancerProfile(asText(item.id), action.controller.signal);
      if (!isCurrentApprovalAction(action)) return;
      setSelectedProfile(detail);
      setSelectedProfileStatus("");
    } catch (error) {
      if (!isCurrentApprovalAction(action)) return;
      setSelectedProfileStatus(error instanceof Error ? error.message : "Unable to load dancer profile.");
    } finally {
      finishApprovalAction(action);
    }
  }

  async function deleteProfileContent(kind: "photo" | "social-link", targetId: string, label: string) {
    if (!selectedProfile) return;
    const dancerId = asText(selectedProfile.id);
    const confirmed = window.confirm(
      `Permanently delete ${label} from ${asText(selectedProfile.stageName || selectedProfile.stage_name) || "this dancer"}'s profile? This cannot be undone.`,
    );
    if (!confirmed) return;
    const action = beginApprovalAction();
    if (!action) return;

    const key = `${kind}:${targetId}`;
    setActionBusyKey(key);
    setDeletingContentKey(key);
    setSelectedProfileStatus(`Deleting ${kind === "photo" ? "picture" : "social link"}...`);
    try {
      const updated = await requestAdminDancerContentDeletion(dancerId, kind, targetId, action.controller.signal);
      if (!isCurrentApprovalAction(action)) return;
      setSelectedProfile(updated.profile);
      onProfileUpdated(updated.profile);
      setSelectedProfileStatus("");
      onActionConfirmed(`${label} deleted from the dancer profile.`);
    } catch (error) {
      if (!isCurrentApprovalAction(action)) return;
      setSelectedProfileStatus(error instanceof Error ? error.message : `Unable to delete ${label}.`);
    } finally {
      if (isCurrentApprovalAction(action)) setDeletingContentKey("");
      finishApprovalAction(action);
    }
  }

  async function rejectProfile(dancerId: string) {
    const action = beginApprovalAction();
    if (!action) return;
    setActionBusyKey(`reject:${dancerId}`);
    setStatusById((current) => ({ ...current, [dancerId]: "Saving..." }));
    try {
      const expectedVersion = items.find(item => asText(item.id) === dancerId)?.profileReviewVersion;
      if (!isProfileReviewVersion(expectedVersion)) throw new Error("Refresh the approval queue before reviewing this profile.");
      const data = await requestAdminJson("/api/admin/approvals", {
        method: "POST",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dancerId, status: "rejected", notes: notesById[dancerId] || null, expectedVersion }),
        fallbackMessage: "Unable to review profile.",
      });
      if (!isCurrentApprovalAction(action)) return;
      if (data.review?.dancerId !== dancerId || data.review?.status !== "rejected" || data.review?.decision !== "rejected"
        || typeof data.review?.reviewId !== "string" || !data.review.reviewId
        || typeof data.review?.reviewedAt !== "string" || !Number.isFinite(Date.parse(data.review.reviewedAt))
        || !isProfileReviewVersion(data.review?.reviewVersion) || data.review.reviewVersion.status !== "rejected"
        || data.review.reviewVersion.is_public !== false || data.review.reviewVersion.verification_status !== "rejected") {
        throw new Error("The review could not be confirmed. Refresh the approval queue before trying again.");
      }
      const confirmation = "Dancer profile rejected successfully." + (data.review.notificationNeedsReview ? " Notification could not be confirmed." : "");
      setStatusById((current) => ({ ...current, [dancerId]: confirmation }));
      onActionConfirmed(confirmation);
      onReviewed(dancerId);
    } catch (error) {
      if (!isCurrentApprovalAction(action)) return;
      setStatusById((current) => ({
        ...current,
        [dancerId]: error instanceof Error ? error.message : "Unable to review profile. Check your connection and try again.",
      }));
    } finally {
      finishApprovalAction(action);
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
                <button className="admin-profile-name-link" type="button" disabled={controlsBusy} onClick={() => openFullProfile(item)}>
                  {stageName || "Stage name not submitted"}
                </button>
                <small>{[city || "City not submitted", status || "pending"].join(" - ")}</small>
              </span>
              <button
                className="secondary-action"
                type="button"
                disabled={controlsBusy}
                onClick={() => onToggleOpen(dancerId)}
                hidden={Boolean(reviewTarget)}
              >
                {isOpen ? "Hide submission" : "View submission"}
              </button>
            </div>
            {isOpen ? (
              <SubmissionDetails
                item={item}
                reviewTarget={reviewTarget}
                onContentReviewed={onContentReviewed}
                onKeepOpen={() => onKeepOpen(dancerId)}
                onSocialReviewed={onSocialReviewed}
                onActionConfirmed={onActionConfirmed}
                actionBusy={controlsBusy}
                beginAction={beginApprovalAction}
                isCurrentAction={isCurrentApprovalAction}
                finishAction={finishApprovalAction}
                onActionStarted={setActionBusyKey}
              />
            ) : null}
            {hasPendingItems ? <p className="approval-blocked">Review pending items first: {pendingItems.join(", ")}.</p> : null}
            <textarea
              placeholder="Review notes"
              hidden={Boolean(reviewTarget && reviewTarget.kind !== "application")}
              rows={2}
              value={notesById[dancerId] || ""}
              disabled={controlsBusy}
              onChange={(event) => setNotesById((current) => ({ ...current, [dancerId]: event.target.value }))}
            />
            <div className="approval-actions">
              <button className="secondary-action" type="button" disabled={controlsBusy} onClick={() => openFullProfile(item)}>
                View full profile
              </button>
              <button type="button" hidden={Boolean(reviewTarget && reviewTarget.kind !== "application")} onClick={() => rejectProfile(dancerId)} disabled={controlsBusy}>
                {isSaving ? "Saving..." : "Reject profile"}
              </button>
            </div>
            {reviewStatus ? <p role="status" aria-live="polite">{reviewStatus}</p> : null}
          </div>
        );
      })}
      {selectedProfile ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label="Full dancer profile" onClick={() => {
          if (!controlsBusy) setSelectedProfile(null);
        }}>
          <div className="admin-preview-modal admin-profile-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-preview-close"
              type="button"
              onClick={() => setSelectedProfile(null)}
              data-close-control="" aria-label="Close full profile"
              disabled={controlsBusy}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
            <h3>{`${asText(selectedProfile.stageName || selectedProfile.stage_name) || "Dancer"} — full profile`}</h3>
            {selectedProfileStatus ? <p role={selectedProfileStatus.startsWith("Unable") ? "alert" : "status"}>{selectedProfileStatus}</p> : null}
            {selectedProfileStatus !== "Loading full profile..." ? (
              <AdminDancerFullProfile
                profile={selectedProfile}
                activeTab="all"
                actionBusy={controlsBusy}
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
  actionBusy,
  beginAction,
  isCurrentAction,
  finishAction,
  onActionStarted,
  reviewTarget, onContentReviewed,
}: {
  item: Record<string, unknown>;
  onKeepOpen: () => void;
  onSocialReviewed: (dancerId: string, targetId: string, status: "approved" | "rejected", notes: string) => void;
  onActionConfirmed: (message: string) => void;
  actionBusy: boolean;
  beginAction: () => ApprovalActionRequest | null;
  isCurrentAction: (action: ApprovalActionRequest) => boolean;
  finishAction: (action: ApprovalActionRequest) => void;
  onActionStarted: (key: string) => void;
  reviewTarget?: ReviewTarget;
  onContentReviewed?: (dancerId: string, kind: "photo" | "social_link", targetId: string, status: "approved" | "rejected", notes: string, version: ContentReviewVersion) => void;
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
  const activeActionRef = useRef<ApprovalActionRequest | null>(null);
  const versionByKeyRef = useRef<Record<string, { source: string; version: ContentReviewVersion }>>({});

  useEffect(() => () => {
    activeActionRef.current?.controller.abort();
    activeActionRef.current = null;
  }, []);

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
    const loadedItem = (targetType === "photo" ? photos : socials).find(item => asText(item.id) === targetId);
    const source = JSON.stringify(loadedItem?.reviewVersion ?? null);
    const cached = versionByKeyRef.current[key];
    const expectedVersion = cached?.source === source ? cached.version : loadedItem?.reviewVersion;
    if (!isContentReviewVersion(expectedVersion, targetType)) {
      setFeedbackByKey(current => ({ ...current, [key]: { tone: "error", message: "Refresh the approval queue before reviewing this item." } }));
      return;
    }
    const action = beginAction();
    if (!action) return;
    activeActionRef.current = action;
    onActionStarted(key);

    setWorkingByKey((current) => ({ ...current, [key]: true }));
    setFeedbackByKey((current) => ({
      ...current,
      [key]: { tone: "working", message: "Saving review..." },
    }));

    try {
      const data = await requestAdminJson("/api/admin/approvals", {
        method: "POST",
        signal: action.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review_content",
          dancerId,
          targetType,
          targetId,
          expectedVersion,
          status,
          notes,
          label,
        }),
        fallbackMessage: "Unable to save this review.",
      });
      if (!isCurrentAction(action)) return;

      const responseStatus = asText(data.review?.status);
      if (responseStatus !== status || data.review?.dancerId !== dancerId || data.review?.targetId !== targetId
        || data.review?.targetType !== targetType || !isContentReviewVersion(data.review?.reviewVersion, targetType)
        || data.review.reviewVersion.review?.id !== data.review.reviewId
        || data.review.reviewVersion.review?.status !== responseStatus) {
        throw new Error("The review could not be confirmed. Refresh the approval queue.");
      }
      const savedStatus = responseStatus as "approved" | "rejected";
      versionByKeyRef.current[key] = { source, version: data.review.reviewVersion };
      const confirmation = `${label} ${savedStatus === "approved" ? "approved" : "rejected"} successfully.`;
      setStatusByKey((current) => ({ ...current, [key]: savedStatus }));
      if (targetType === "social_link") {
        onSocialReviewed(dancerId, targetId, savedStatus, notes);
      }
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "success", message: confirmation + (data.review.notificationNeedsReview ? " Notification could not be confirmed." : "") },
      }));
      onActionConfirmed(confirmation);
      onKeepOpen();
      onContentReviewed?.(dancerId, targetType, targetId, savedStatus, notes, data.review.reviewVersion);
    } catch (error) {
      if (!isCurrentAction(action)) return;
      setFeedbackByKey((current) => ({
        ...current,
        [key]: {
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to save this review. Check your connection and try again.",
        },
      }));
    } finally {
      if (activeActionRef.current === action) activeActionRef.current = null;
      if (isCurrentAction(action)) {
        onKeepOpen();
        setWorkingByKey((current) => ({ ...current, [key]: false }));
      }
      finishAction(action);
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

      <section className="submission-section" hidden={Boolean(reviewTarget && !["photo", "application"].includes(reviewTarget.kind))}>
        <h3>Photos submitted</h3>
        {photos.length ? (
          <div className="submission-media-grid">
            {photos.filter(photo => !reviewTarget || reviewTarget.kind === "application" || asText(photo.id) === reviewTarget.id).map((photo, index) => {
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
                    disabled={actionBusy}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <small>Type the reason, then press Save disapproval.</small>
                  <div className="content-review-actions">
                    <button type="button" onClick={(event) => reviewContent(event, "photo", targetId, "approved", label)} disabled={!targetId || actionBusy}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve picture"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "photo", targetId, "rejected", label)} disabled={!targetId || actionBusy}>
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
        <p className="submission-empty">Approval is based on the dancer&apos;s club affiliation and profile and media review.</p>
      </section>

      <section className="submission-section" hidden={Boolean(reviewTarget && !["social", "application"].includes(reviewTarget.kind))}>
        <h3>Social links</h3>
        {socials.length ? (
          <div className="submitted-social-review-list">
            {socials.filter(social => !reviewTarget || reviewTarget.kind === "application" || social.id === reviewTarget.id).map((social, index) => {
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
                    disabled={actionBusy}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <div className="content-review-actions">
                    <button type="button" onClick={(event) => reviewContent(event, "social_link", targetId, "approved", social.label)} disabled={!targetId || actionBusy || isApproved}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve social"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "social_link", targetId, "rejected", social.label)} disabled={!targetId || actionBusy}>
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
            <button className="admin-preview-close" type="button" onClick={() => setPreview(null)} data-close-control="" aria-label="Close preview">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
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
      const submittedUrl = asText(social.url || social.href);
      const url = safeSocialProfileUrl(platform, submittedUrl) || "";
      const handle = asText(social.handle || social.username || social.value) || socialHandleFromUrl(submittedUrl);
      return {
        id: asText(social.id),
        platform,
        label: socialPlatformLabel(platform),
        handle,
        url,
        reviewVersion: social.reviewVersion,
        reviewStatus: asText(social.reviewStatus || social.review_status),
        reviewNotes: asText(social.reviewNotes || social.review_notes),
      };
    })
    .filter((social) => social.platform && (social.handle || social.url));
}

async function requestAdminDancerProfile(dancerId: string, signal?: AbortSignal) {
  if (!dancerId) throw new Error("Unable to load dancer profile.");
  const data = await requestAdminJson(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
    signal,
    fallbackMessage: "Unable to load dancer profile.",
  });
  if (!data.profile) throw new Error("Unable to load dancer profile.");
  return data.profile as Record<string, unknown>;
}

async function requestAdminDancerContentDeletion(
  dancerId: string,
  kind: "photo" | "social-link",
  targetId: string,
  signal?: AbortSignal,
) {
  if (!dancerId || !targetId) throw new Error(`Unable to delete dancer ${kind}.`);

  const resource = kind === "photo" ? "photos" : "social-links";
  const data = await requestAdminJson(
    `/api/admin/dancers/${encodeURIComponent(dancerId)}/${resource}/${encodeURIComponent(targetId)}`,
    {
      method: "DELETE",
      signal,
      fallbackMessage: `Unable to delete dancer ${kind}.`,
    },
  );
  if (!data.profile) throw new Error(`Unable to delete dancer ${kind}.`);
  return data as { profile: Record<string, unknown>; deleted: Record<string, unknown> };
}

function DancerDirectory({
  onDeleted,
  onProfileUpdated,
  onActionConfirmed,
  requestedDancerId = "",
  requestedClubId = "", onClubChange,
}: {
  onDeleted: (dancerId: string) => void;
  onProfileUpdated: (profile: Record<string, unknown>) => void;
  onActionConfirmed: (message: string) => void;
  requestedDancerId?: string;
  requestedClubId?: string; onClubChange?: (id: string) => void;
}) {
  const [roster, setRoster] = useState<AdminDancerRosterResult | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [moderationFilter, setModerationFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState(requestedClubId);
  useEffect(() => { setVenueFilter(requestedClubId); }, [requestedClubId]);
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isLoadingRoster, setIsLoadingRoster] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [detailTab, setDetailTab] = useState("overview");
  const [actionBusyKey, setActionBusyKey] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const controlsBusy = Boolean(actionBusyKey) || reviewBusy;
  const isDeleting = actionBusyKey.startsWith("delete-profile:");
  const deletingContentKey = actionBusyKey.startsWith("photo:") || actionBusyKey.startsWith("social-link:") ? actionBusyKey : "";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  function beginDirectoryAction(key: string): ApprovalActionRequest | null {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setActionBusyKey(key);
    return { controller, requestId };
  }

  function isCurrentDirectoryAction(action: ApprovalActionRequest) {
    return mountedRef.current && !action.controller.signal.aborted && action.requestId === actionSequenceRef.current;
  }

  function finishDirectoryAction(action: ApprovalActionRequest) {
    if (actionAbortRef.current === action.controller) actionAbortRef.current = null;
    if (action.requestId === actionSequenceRef.current) actionInFlightRef.current = false;
    if (mountedRef.current && action.requestId === actionSequenceRef.current) setActionBusyKey("");
  }

  useEffect(() => {
    if (requestedDancerId) void openProfile({ id: requestedDancerId });
    // The destination is consumed once per requested dancer; edits keep their current tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDancerId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, statusFilter, scheduleFilter, moderationFilter, sourceFilter, cityFilter, venueFilter, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: debouncedQuery,
      status: statusFilter,
      schedule: scheduleFilter,
      moderation: moderationFilter,
      source: sourceFilter,
      city: cityFilter,
      venueId: venueFilter,
      sort,
      page: String(page),
      pageSize: "20",
    });
    setIsLoadingRoster(true);
    setStatus("");
    requestAdminJson(`/api/admin/dancers?${params.toString()}`, {
      signal: controller.signal,
      fallbackMessage: "Unable to load dancer roster.",
    })
      .then((data) => {
        if (!data.roster) throw new Error("Unable to load dancer roster.");
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
  }, [debouncedQuery, statusFilter, scheduleFilter, moderationFilter, sourceFilter, cityFilter, venueFilter, sort, page, refreshVersion]);

  async function openProfile(item: Record<string, unknown>) {
    const dancerId = asText(item.id);
    if (!dancerId) return;
    const action = beginDirectoryAction(`profile:${dancerId}`);
    if (!action) return;

    setSelectedId(dancerId);
    setProfile(null);
    setDetailTab("overview");
    setLifecycleReason("");
    setStatus("Loading full profile...");
    try {
      const detail = await requestAdminDancerProfile(dancerId, action.controller.signal);
      if (!isCurrentDirectoryAction(action)) return;
      setProfile(detail);
      setStatus("");
    } catch (error) {
      if (!isCurrentDirectoryAction(action)) return;
      setStatus(error instanceof Error ? error.message : "Unable to load dancer profile.");
    } finally {
      finishDirectoryAction(action);
    }
  }

  async function updateLifecycle(action: "disable" | "reactivate") {
    if (!profile) return;
    const dancerId = asText(profile.id);
    if (!dancerId) return;
    if (lifecycleReason.trim().length < 4) {
      setStatus("Add a short reason before changing profile access.");
      return;
    }
    const request = beginDirectoryAction(`lifecycle:${dancerId}`);
    if (!request) return;
    setStatus(action === "disable" ? "Disabling profile..." : "Reactivating profile...");
    try {
      const data = await requestAdminJson(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
        method: "PATCH",
        signal: request.controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: lifecycleReason.trim() }),
        fallbackMessage: "Unable to update dancer lifecycle.",
      });
      if (!data.profile) throw new Error("Unable to update dancer lifecycle.");
      if (!isCurrentDirectoryAction(request)) return;
      setProfile(data.profile);
      onProfileUpdated(data.profile);
      setLifecycleReason("");
      setRefreshVersion((value) => value + 1);
      setStatus("");
      onActionConfirmed(action === "disable" ? "Dancer profile disabled and hidden." : "Dancer profile reactivated using its saved approval state.");
    } catch (error) {
      if (!isCurrentDirectoryAction(request)) return;
      setStatus(error instanceof Error ? error.message : "Unable to update dancer lifecycle.");
    } finally {
      finishDirectoryAction(request);
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
    const action = beginDirectoryAction(key);
    if (!action) return;
    setStatus(`Deleting ${kind === "photo" ? "picture" : "social link"}...`);
    try {
      const updated = await requestAdminDancerContentDeletion(dancerId, kind, targetId, action.controller.signal);
      if (!isCurrentDirectoryAction(action)) return;
      setProfile(updated.profile);
      onProfileUpdated(updated.profile);
      setRefreshVersion((value) => value + 1);
      setStatus("");
      onActionConfirmed(`${label} deleted from ${stageName}'s profile.`);
    } catch (error) {
      if (!isCurrentDirectoryAction(action)) return;
      setStatus(error instanceof Error ? error.message : `Unable to delete ${label}.`);
    } finally {
      finishDirectoryAction(action);
    }
  }

  function closeProfile() {
    if (controlsBusy) return;
    setSelectedId("");
    setProfile(null);
    setStatus("");
  }

  async function deleteProfile(item: Record<string, unknown>) {
    const dancerId = asText(item.id);
    const stageName = asText(item.stageName || item.stage_name) || "this dancer";
    if (!dancerId) return;

    const confirmed = window.confirm(
      `Permanently delete ${stageName}'s dancer profile, profile photos, any legacy identity files, schedules, and profile activity? Their login account will remain. This cannot be undone.`,
    );
    if (!confirmed) return;
    const typedName = window.prompt(`Type ${stageName} to permanently delete this profile.`);
    if (typedName !== stageName) {
      setStatus("Permanent deletion canceled because the stage name did not match.");
      return;
    }

    const action = beginDirectoryAction(`delete-profile:${dancerId}`);
    if (!action) return;
    setStatus("Deleting profile and stored content...");
    try {
      const data = await requestAdminJson(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
        method: "DELETE",
        signal: action.controller.signal,
        fallbackMessage: "Unable to delete dancer profile.",
      });
      if (!isCurrentDirectoryAction(action)) return;

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
      if (!isCurrentDirectoryAction(action)) return;
      setStatus(error instanceof Error ? error.message : "Unable to delete dancer profile.");
    } finally {
      finishDirectoryAction(action);
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
        <RosterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={[["all", "Demo and standard"], ["demo", "Demo assignments"], ["standard", "Standard profiles"]]} />
        <RosterSelect label="City" value={cityFilter} onChange={setCityFilter} options={[["", "All cities"], ...(roster?.filters.cities || []).map((city) => [city, city] as [string, string])]} />
        <RosterSelect label="Club" value={venueFilter} onChange={value => { setVenueFilter(value); onClubChange?.(value); }} options={[["", "All clubs"], ...(roster?.filters.venues || []).map((venue) => [venue.id, `${venue.name} · ${venue.city}`] as [string, string])]} />
        <RosterSelect label="Sort" value={sort} onChange={setSort} options={[["updated", "Recently active"], ["created", "Newest profiles"], ["name", "Stage name"], ["status", "Profile state"]]} />
        <button className="secondary-action dancer-roster-clear" type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setScheduleFilter("all"); setModerationFilter("all"); setSourceFilter("all"); setCityFilter(""); setVenueFilter(""); setSort("updated"); }}>Clear filters</button>
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
            <button className="dancer-directory-profile-link" type="button" disabled={controlsBusy} onClick={() => openProfile(item as unknown as Record<string, unknown>)}>
              <span className="dancer-roster-avatar">{item.avatarUrl ? <img src={item.avatarUrl} srcSet={item.avatarSrcSet || undefined} alt="" /> : <span>{stageName.slice(0, 1).toUpperCase()}</span>}</span>
              <span className="dancer-roster-identity"><strong>{stageName}</strong><small>{item.email || "No account email"}</small><small>{item.city}{item.venue ? ` · ${item.venue.name}` : " · No active club"}</small></span>
              <span className="dancer-roster-badges"><RosterBadge value={item.status} /><RosterBadge value={item.schedule.state} />{item.isDemo ? <RosterBadge value="demo" /> : null}{item.openReports ? <RosterBadge value={`${item.openReports} open report${item.openReports === 1 ? "" : "s"}`} tone="danger" /> : null}</span>
            </button>
            <div className="dancer-roster-data">
              <span><small>Media</small><strong>{item.media.approved} approved · {item.media.pending} pending</strong></span>
              <span><small>Affiliations</small><strong>{item.affiliationCount}</strong></span>
              <span><small>Last activity</small><strong>{formatDate(item.lastActivityAt)}</strong></span>
            </div>
            <div className="dancer-directory-actions">
              <button className="secondary-action" type="button" disabled={controlsBusy} onClick={() => openProfile(item as unknown as Record<string, unknown>)}>
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
              data-close-control="" aria-label="Close full profile"
              disabled={controlsBusy}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
            <h3>{profile ? `${asText(profile.stageName || profile.stage_name) || "Dancer"} — full profile` : "Full dancer profile"}</h3>
            {status ? <p role={status.startsWith("Unable") ? "alert" : "status"}>{status}</p> : null}
            {profile ? (
              <>
              <nav className="admin-dancer-tabs" aria-label="Dancer management sections">
                {[["overview", "Overview"], ["review", "Review submission"], ["media", "Profile & media"], ["affiliations", "Clubs & shifts"], ["analytics", "Analytics & reports"], ["history", "History"]].map(([id, label]) => <button type="button" key={id} className={detailTab === id ? "active" : ""} disabled={controlsBusy} onClick={() => setDetailTab(id)}>{label}</button>)}
              </nav>
              {detailTab === "review" ? <ApprovalQueue items={[profile]} openById={{ [selectedId]: true }} onToggleOpen={() => {}} onKeepOpen={() => {}}
                onBusyChange={setReviewBusy} onManageDancer={() => setDetailTab("overview")}
                onSocialReviewed={(id, targetId, status, notes) => setProfile(current => current ? withReviewedSocial(current, targetId, status, notes) : current)}
                onContentReviewed={(id, kind, targetId, status, notes, version) => {
                  if (asText(profile.id) !== id) return;
                  const field = kind === "photo" ? "photos" : "socialLinks";
                  const updated = { ...profile, [field]: asRecordArray(profile[field]).map(row => row.id === targetId ? { ...row, reviewStatus: status, reviewNotes: notes, reviewVersion: version } : row) };
                  setProfile(updated); onProfileUpdated(updated); setRefreshVersion(value => value + 1);
                }}
                onProfileUpdated={updated => { setProfile(updated); onProfileUpdated(updated); }}
                onReviewed={() => { void openProfile({ id: selectedId }); setRefreshVersion(value => value + 1); }} onActionConfirmed={onActionConfirmed} /> : null}
              {detailTab !== "review" ?
              <AdminDancerFullProfile
                profile={profile}
                activeTab={detailTab}
                actionBusy={controlsBusy}
                deletingContentKey={deletingContentKey}
                onDeletePhoto={(targetId, label) => deleteProfileContent("photo", targetId, label)}
                onDeleteSocial={(targetId, label) => deleteProfileContent("social-link", targetId, label)}
              /> : null}
              </>
            ) : null}
            {profile ? (
              <div className="admin-profile-delete-zone">
                <strong>Profile access and retention</strong>
                <p>Disable a profile for a reversible hold. Permanent deletion is reserved for verified deletion requests or required data removal.</p>
                <label><span>Required action reason</span><textarea value={lifecycleReason} disabled={controlsBusy} onChange={(event) => setLifecycleReason(event.target.value)} maxLength={500} placeholder="Why this profile is being disabled or reactivated" /></label>
                <div className="admin-profile-lifecycle-actions">
                  {asText(profile.status) === "disabled" ? <button className="secondary-action" type="button" onClick={() => updateLifecycle("reactivate")} disabled={controlsBusy}>Reactivate profile</button> : <button className="danger-action" type="button" onClick={() => updateLifecycle("disable")} disabled={controlsBusy}>Disable profile</button>}
                  <details><summary>Permanent deletion</summary><p>This removes profile data and stored media. The login account remains.</p><button className="danger-action" type="button" onClick={() => deleteProfile(profile)} disabled={controlsBusy}>{isDeleting ? "Deleting profile..." : "Permanently delete profile"}</button></details>
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
  actionBusy,
  deletingContentKey,
  onDeletePhoto,
  onDeleteSocial,
}: {
  profile: Record<string, unknown>;
  activeTab: string;
  actionBusy: boolean;
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
  const reports = asRecordArray(operations.reports);
  const accountHistory = asRecordArray(operations.accountHistory || operations.account_history);
  const analytics = asRecordObject(operations.analytics);

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
        <p className="submission-empty">The approved main photo also supplies the avatar on public listings and club rosters.</p>
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
                    disabled={!photoId || actionBusy}
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
              const socialUrl = safeSocialProfileUrl(asText(social.platform), asText(social.url));
              return (
                <div className="submission-link admin-managed-content" key={socialId || index}>
                  <a className="admin-managed-content-link" href={socialUrl || undefined} target="_blank" rel="noopener noreferrer">
                    <strong>{label}</strong>
                    <small>{asText(social.handle) || asText(social.url)}</small>
                    <small>{asText(social.reviewStatus || social.review_status) || "pending"}</small>
                  </a>
                  <button
                    className="danger-action"
                    type="button"
                    onClick={() => onDeleteSocial(socialId, `${label} social link`)}
                    disabled={!socialId || actionBusy}
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


      {activeTab === "all" || activeTab === "analytics" ? <>
        <section className="submission-section"><h3>Customer activity</h3><div className="submission-grid"><SubmissionValue label="Followers" value={analytics.followers} /><SubmissionValue label="Profile views" value={analytics.profileViews || analytics.profile_views} /><SubmissionValue label="Direction requests" value={analytics.directionRequests || analytics.direction_requests} /><SubmissionValue label="Active shifts" value={analytics.activeShifts || analytics.active_shifts} /></div></section>
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
  id,
  title,
  badge,
  collapsible = true,
  children,
}: {
  id?: string;
  title: string;
  badge?: string;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const [hasOpened, setHasOpened] = useState(false);
  const heading = <>
    <span className="admin-panel-title"><span className="admin-panel-icon"><AdminDashboardIcon section="panel" /></span><h2>{title}</h2></span>
    <span className="admin-panel-summary-side">
      {badge ? <span className="admin-panel-badge">{badge}</span> : null}
      {collapsible ? <span className="admin-panel-chevron" aria-hidden="true"><AdminDashboardIcon section="chevron" /></span> : null}
    </span>
  </>;
  if (!collapsible) return (
    <section id={id} tabIndex={-1} className={title === "Support Inbox" ? "admin-panel support-admin-panel" : "admin-panel"}>
      <header className="admin-panel-head">{heading}</header>
      <div className="admin-panel-body">{children}</div>
    </section>
  );
  return (
    <details id={id} className={title === "Support Inbox" ? "admin-panel support-admin-panel" : "admin-panel"}
      onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open) setHasOpened(true); }}>
      <summary className="admin-panel-head">{heading}</summary>
      <div className="admin-panel-body">{hasOpened ? children : null}</div>
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
  const venueName = venue ? String(venue.name || "Club") : "Club";
  const dancerName = dancer ? ` / ${String(dancer.stage_name || "Dancer")}` : "";
  return `${dealTitle} at ${venueName}${dancerName}`;
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
  return payoutCopy(phoneTapCopy(value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())))
    .replace(/\bVenues\b/g, "Clubs").replace(/\bvenues\b/g, "clubs")
    .replace(/\bVenue\b/g, "Club").replace(/\bvenue\b/g, "club");
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
      body { margin: 0; background: #050507; color: var(--dancr-color-text-primary); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; min-width: 0; }
      .admin-shell { min-height: 100vh; padding: 22px clamp(12px, 4vw, 56px) 56px; background: var(--dancr-color-background); overflow-x: hidden; }
      .top-nav, .admin-head, .admin-grid, .admin-warning, .sign-in { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: var(--dancr-color-text-muted); }
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
      p { margin: 0; color: var(--dancr-color-text-muted); font-size: clamp(14px, 3.8vw, 18px); line-height: 1.45; max-width: 58ch; overflow-wrap: anywhere; }
      .admin-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .admin-panel { border: 1px solid var(--dancr-color-border); background: rgba(12,12,18,.86); border-radius: 8px; padding: clamp(12px, 2.8vw, 16px); overflow: hidden; }
      .admin-panel-head { cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; list-style: none; }
      header.admin-panel-head { cursor: default; }
      .admin-panel-head::-webkit-details-marker { display: none; }
      .admin-panel-head:focus-visible { border-radius: 8px; outline: 2px solid #94e5ff; outline-offset: 4px; }
      .admin-panel-summary-side { display: flex; align-items: center; gap: 9px; }
      .admin-panel-chevron { color: var(--dancr-color-text-muted); font-size: 22px; line-height: 1; transition: transform .18s ease; }
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
      .sign-in { max-width: 430px; display: grid; gap: 14px; padding: 18px; box-shadow: 0 28px 80px rgba(0,0,0,.38); }
      .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
      .segmented button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: transparent; font-weight: 900; cursor: pointer; }
      .segmented button.active { background: linear-gradient(var(--dancr-color-brand-primary), var(--dancr-color-brand-primary)); }
      .sign-in label { display: grid; gap: 7px; color: var(--dancr-color-text-primary); font-size: 13px; font-weight: 850; }
      input, select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      .password-control { position: relative; display: flex; align-items: center; }
      .password-control input { width: 100%; padding-right: 58px; }
      .password-control button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: var(--dancr-color-text-primary); background: rgba(255,255,255,.055); cursor: pointer; z-index: 2; }
      .password-control button[aria-pressed="true"], .password-control button:hover { color: #fff; background: rgba(109, 40, 255, 0.18); box-shadow: none; }
      .password-control svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; white-space: normal; line-height: 1.15; }
      .password-control button { width: 30px; min-width: 30px; max-width: 30px; height: 30px; min-height: 30px; padding: 0; }
      button:disabled { opacity: .62; cursor: wait; }
      .forgot-password { width: 100%; min-height: 44px; justify-self: stretch; padding: 0 12px; border: 1px solid rgba(248,250,252,.12); border-radius: 12px; background: rgba(24,24,29,.94); color: rgba(255,255,255,.88); font-size: 13px; font-weight: 900; line-height: 1.15; text-align: center; cursor: pointer; }
      .forgot-password:hover, .forgot-password:focus-visible { border-color: var(--dancr-color-brand-primary); color: #fff; outline: 2px solid var(--dancr-color-brand-primary); outline-offset: 2px; }
      .metric { min-height: 54px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span, .empty { color: var(--dancr-color-text-muted); font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: clamp(17px, 4.4vw, 20px); overflow-wrap: anywhere; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      li { color: var(--dancr-color-text-primary); overflow-wrap: anywhere; }
      .approval-list { display: grid; gap: 12px; }
      .approval-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .approval-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .approval-summary span { display: grid; gap: 2px; min-width: 0; }
      .admin-profile-name-link, .dancer-directory-profile-link { appearance: none; width: fit-content; max-width: 100%; padding: 0; border: 0; color: #fff; background: transparent; font: inherit; text-align: left; text-decoration: underline; text-decoration-color: rgba(53,216,255,.46); text-underline-offset: 4px; cursor: pointer; }
      .admin-profile-name-link { font-weight: 950; }
      .admin-profile-name-link:hover, .admin-profile-name-link:focus-visible, .dancer-directory-profile-link:hover strong, .dancer-directory-profile-link:focus-visible strong { color: #8ceaff; text-decoration-color: #35d8ff; }
      .approval-summary small { color: var(--dancr-color-text-muted); font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .approval-row span { color: var(--dancr-color-text-muted); }
      .approval-row textarea { min-height: 72px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .approval-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .approval-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .approval-row .secondary-action { color: var(--dancr-color-text-primary); background: rgba(48, 48, 56, 0.16); border: 1px solid var(--dancr-color-border); }
      .approval-row p { color: #94e5ff; font-size: 14px; }
      .approval-blocked { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,214,102,.22); background: rgba(255,214,102,.08); color: #ffd666 !important; font-size: 13px !important; }
      .admin-panel:has(.dancer-management) { grid-column: 1 / -1; }
      .dancer-management { display: grid; gap: 14px; }
      .dancer-roster-summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
      .dancer-roster-summary > span { display: grid; gap: 2px; padding: 11px; border: 1px solid rgba(148,229,255,.14); border-radius: 9px; background: rgba(148,229,255,.035); }
      .dancer-roster-summary strong { color: #fff; font-size: 21px; }
      .dancer-roster-summary small { color: var(--dancr-color-text-muted); font-size: 11px; font-weight: 850; }
      .dancer-roster-filters { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 9px; padding: 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.025); }
      .dancer-roster-filters label, .admin-profile-delete-zone label { display: grid; gap: 5px; color: var(--dancr-color-text-muted); font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
      .dancer-roster-filters input, .dancer-roster-filters select { width: 100%; background: #15151c; }
      .dancer-roster-filters option { color: #fff; background: #15151c; }
      .dancer-roster-search { grid-column: span 2; }
      .dancer-roster-clear { align-self: end; min-height: 42px; }
      .dancer-roster-status { max-width: none; padding: 10px 12px; border: 1px solid rgba(148,229,255,.2); border-radius: 8px; color: #d5f8ff; background: rgba(148,229,255,.05); font-size: 13px; }
      .dancer-directory-list { display: grid; gap: 10px; }
      .dancer-directory-row { display: grid; grid-template-columns: minmax(280px,1.2fr) minmax(340px,1fr) auto; align-items: center; gap: 12px; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .dancer-directory-row:hover { border-color: rgba(148,229,255,.25); background: rgba(148,229,255,.045); }
      .dancer-directory-profile-link { display: grid; grid-template-columns: 52px minmax(0,1fr); align-items: center; gap: 10px; width: 100%; text-decoration: none; }
      .dancer-roster-avatar { grid-row: span 2; display: grid; place-items: center; width: 52px; height: 52px; overflow: hidden; border: 1px solid rgba(148,229,255,.26); border-radius: 999px; color: #fff; background: rgba(20, 20, 27, 0.16); font-size: 20px; font-weight: 950; }
      .dancer-roster-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .dancer-roster-identity { display: grid; gap: 2px; }
      .dancer-roster-badges { grid-column: 2; display: flex; flex-wrap: wrap; gap: 5px; }
      .dancer-roster-badge { padding: 4px 7px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: var(--dancr-color-text-muted); background: rgba(255,255,255,.045); font-size: 9px; font-style: normal; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; }
      .dancer-roster-badge.is-approved, .dancer-roster-badge.is-working-now { color: #8dffc4; border-color: rgba(50,255,164,.28); background: rgba(50,255,164,.07); }
      .dancer-roster-badge.is-pending-review, .dancer-roster-badge.is-upcoming { color: #94e5ff; border-color: rgba(148,229,255,.25); background: rgba(148,229,255,.06); }
      .dancer-roster-badge.is-disabled, .dancer-roster-badge.danger { color: #ffb3bf; border-color: rgba(255,104,124,.3); background: rgba(255,104,124,.07); }
      .dancer-roster-badge.is-demo { color: var(--dancr-color-text-muted); border-color: var(--dancr-color-border); background: rgba(20, 20, 27, 0.1); }
      .dancer-roster-data { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }
      .dancer-roster-data > span { display: grid; gap: 2px; }
      .dancer-roster-data small { color: var(--dancr-color-text-muted); font-size: 9px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
      .dancer-roster-data strong { color: var(--dancr-color-text-primary); font-size: 11px; }
      .dancer-directory-row strong { color: #fff; overflow-wrap: anywhere; }
      .dancer-directory-row small { color: var(--dancr-color-text-muted); font-size: 12px; overflow-wrap: anywhere; }
      .dancer-directory-actions { display: grid; gap: 8px; }
      .dancer-directory-actions button { min-height: 40px; padding: 8px 10px; }
      .dancer-roster-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; }
      .dancer-roster-pagination span { color: var(--dancr-color-text-muted); font-size: 12px; font-weight: 900; }
      .dancer-roster-pagination button { padding: 0 14px; }
      .secondary-action { color: var(--dancr-color-text-primary); background: rgba(48, 48, 56, 0.16); border: 1px solid var(--dancr-color-border); }
      .danger-action { color: #fff; background: rgba(202,36,63,.88); border: 1px solid rgba(255,122,142,.56); padding: 9px 12px; }
      .danger-action:hover { background: rgba(225,45,73,.96); }
      .submission-detail { display: grid; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid var(--dancr-color-border); background: rgba(5,5,8,.72); }
      .submission-section { display: grid; gap: 8px; }
      .submission-section h3 { margin: 0; color: #fff; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; }
      .submission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .submission-value { display: grid; gap: 3px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); }
      .submission-value.wide { grid-column: 1 / -1; }
      .submission-value span { color: var(--dancr-color-text-muted); font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .submission-value strong { color: var(--dancr-color-text-primary); font-size: 13px; overflow-wrap: anywhere; white-space: pre-wrap; }
      .submission-media-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .submission-thumb, .submission-link { color: var(--dancr-color-text-primary); text-decoration: none; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.045); overflow: hidden; }
      .submission-thumb { display: grid; gap: 6px; padding: 6px; }
      .submission-thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: #050507; }
      .submission-thumb small, .submission-link small { color: var(--dancr-color-text-muted); font-size: 12px; overflow-wrap: anywhere; }
      .admin-managed-content { display: grid; gap: 8px; }
      .admin-managed-content-link { display: grid; gap: 6px; min-width: 0; color: inherit; text-decoration: none; }
      .admin-managed-content > .danger-action { width: 100%; min-height: 38px; }
      .submission-files { display: grid; gap: 8px; }
      .submission-link { display: grid; gap: 3px; padding: 10px; }
      .submission-link strong { overflow-wrap: anywhere; }
      .submission-review-card { display: grid; gap: 8px; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submission-review-card.is-approved { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.075); }
      .submission-review-card.is-rejected { border-color: rgba(255,104,124,.38); background: rgba(255,104,124,.075); }
      .submission-review-card > small { color: var(--dancr-color-text-muted); font-size: 12px; overflow-wrap: anywhere; }
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
      .submitted-social-review small { color: var(--dancr-color-text-muted); font-size: 12px; overflow-wrap: anywhere; }
      .submitted-social-review-status.is-approved { color: #8dffc4 !important; font-weight: 900; }
      .submitted-social-review-status.is-rejected { color: #ffb3bf !important; font-weight: 900; }
      .submitted-social-review textarea { width: 100%; min-height: 58px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .submitted-social-icon { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; padding: 0; line-height: 1; border-radius: 999px; color: var(--dancr-color-text-primary); border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); text-decoration: none; }
      .submitted-social-icon:hover { color: #fff; border-color: rgba(34,199,255,.48); background: rgba(34,199,255,.12); }
      .submitted-social-icon svg { display: block; width: 22px; height: 22px; margin: 0; flex: 0 0 22px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .submitted-social-icon.social-instagram svg, .submitted-social-icon.social-x svg { fill: none; }
      .submitted-social-icon .logo-cutout { fill: #050507; stroke: none; }
      .admin-preview-overlay { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.74); backdrop-filter: blur(10px); }
      .admin-preview-modal { position: relative; width: min(760px, 100%); max-height: min(86vh, 760px); overflow: auto; display: grid; gap: 12px; padding: 16px; border-radius: 8px; border: 1px solid var(--dancr-color-border); background: #08080c; box-shadow: 0 24px 80px rgba(0,0,0,.62); }
      .admin-preview-modal h3 { margin: 0; padding-right: 48px; color: #fff; font-size: 17px; overflow-wrap: anywhere; }
      .admin-preview-close { position: absolute; top: 10px; right: 10px; width: 38px; min-height: 38px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); color: var(--dancr-color-text-primary); background: rgba(255,255,255,.06); font-size: 24px; line-height: 1; }
      .admin-preview-modal img { width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px; background: #050507; }
      .admin-preview-modal iframe { width: 100%; height: min(70vh, 620px); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #050507; }
      .admin-preview-link { display: grid; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.045); color: var(--dancr-color-text-primary); overflow-wrap: anywhere; }
      .admin-preview-link p { margin: 0; color: var(--dancr-color-text-muted); }
      .admin-preview-link a { justify-self: start; color: #090911; background: #f7f2ff; border-radius: 999px; padding: 10px 14px; text-decoration: none; font-weight: 900; }
      .admin-profile-modal { width: min(920px, 100%); max-height: 92vh; }
      .admin-dancer-tabs { position: sticky; top: -16px; z-index: 4; display: flex; gap: 6px; overflow-x: auto; padding: 10px 0; background: #08080c; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.35) transparent; }
      .admin-dancer-tabs button { flex: 0 0 auto; min-height: 36px; padding: 0 10px; color: var(--dancr-color-text-muted); border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); font-size: 11px; }
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
      .submission-empty { color: var(--dancr-color-text-muted); font-size: 13px; }
      .submission-json { border-radius: 8px; border: 1px solid rgba(255,255,255,.08); padding: 10px; background: rgba(255,255,255,.035); }
      .submission-json summary { cursor: pointer; color: #94e5ff; font-weight: 900; }
      .submission-json pre { max-height: 260px; overflow: auto; color: var(--dancr-color-text-primary); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .venue-request-queue { display: grid; gap: 12px; padding: 14px; border: 1px solid rgba(148,229,255,.18); border-radius: 11px; background: var(--dancr-color-surface-card); }
      .venue-request-queue-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .venue-request-queue-head > span { display: grid; gap: 3px; }
      .venue-request-queue-head strong { color: #fff; font-size: 16px; }
      .venue-request-queue-head small { color: var(--dancr-color-text-muted); }
      .venue-request-queue-head em { flex: 0 0 auto; padding: 6px 9px; border: 1px solid rgba(148,229,255,.24); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.07); font-size: 11px; font-style: normal; font-weight: 950; }
      .venue-request-list { display: grid; gap: 8px; }
      .venue-request-row { border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: #09090e; overflow: hidden; }
      .venue-request-row > summary { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 12px; cursor: pointer; list-style: none; }
      .venue-request-row > summary::-webkit-details-marker { display: none; }
      .venue-request-row > summary > span:first-child { display: grid; gap: 3px; }
      .venue-request-row > summary strong { color: #fff; overflow-wrap: anywhere; }
      .venue-request-row > summary small { color: var(--dancr-color-text-muted); overflow-wrap: anywhere; }
      .venue-request-row[open] > summary .venue-disclosure { transform: rotate(180deg); }
      .venue-request-details { display: grid; gap: 12px; padding: 0 12px 12px; border-top: 1px solid rgba(255,255,255,.07); }
      .venue-request-details dl { display: grid; gap: 8px; margin: 12px 0 0; }
      .venue-request-details dl > div { display: grid; grid-template-columns: 118px minmax(0,1fr); gap: 10px; }
      .venue-request-details dt { color: var(--dancr-color-text-muted); font-size: 11px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
      .venue-request-details dd { margin: 0; color: var(--dancr-color-text-primary); font-size: 13px; overflow-wrap: anywhere; }
      .venue-request-details a { color: #94e5ff; }
      .venue-request-details label { display: grid; gap: 7px; color: var(--dancr-color-text-primary); font-size: 12px; font-weight: 850; }
      .venue-request-details label small { color: var(--dancr-color-text-muted); font-weight: 700; line-height: 1.4; }
      .venue-request-details select, .venue-request-details textarea { width: 100%; min-height: 42px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #15151c; font: inherit; }
      .venue-request-details textarea { min-height: 76px; resize: vertical; }
      .venue-request-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
      .venue-request-actions button, .venue-request-issued button { min-height: 42px; padding: 0 12px; color: #090911; background: #f7f2ff; }
      .venue-request-actions button.secondary, .venue-request-issued button.secondary { color: var(--dancr-color-text-primary); border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
      .venue-request-actions button:disabled { cursor: wait; opacity: .62; }
      .venue-request-details > p { color: #94e5ff; font-size: 13px; }
      .venue-request-issued { display: grid; gap: 9px; padding: 13px; border: 1px solid rgba(50,255,164,.35); border-radius: 10px; background: rgba(50,255,164,.07); }
      .venue-request-issued strong { color: #fff; }
      .venue-request-issued p { color: #c4ead6; font-size: 13px; line-height: 1.45; }
      .venue-request-issued code { user-select: all; color: #fff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: clamp(18px,5vw,24px); font-weight: 900; letter-spacing: .08em; overflow-wrap: anywhere; }
      .venue-manager { display: grid; gap: 14px; }
      .admin-info-note { margin: 0; padding: 12px 14px; border: 1px solid rgba(148,229,255,.22); border-radius: 10px; color: #d5f8ff !important; background: rgba(148,229,255,.055); line-height: 1.5; }
      .venue-manager form { display: grid; gap: 10px; padding-top: 12px; }
      .venue-manager label { display: grid; gap: 7px; color: var(--dancr-color-text-primary); font-size: 13px; font-weight: 850; }
      .venue-manager input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .venue-manager input[readonly] { color: #94a3b8; background: #111118; }
      .venue-manager input:focus { border-color: rgba(148,229,255,.7); outline: 2px solid rgba(148,229,255,.16); outline-offset: 1px; }
      .venue-manager button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .venue-manager button.secondary { color: var(--dancr-color-text-primary); border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
      .venue-manager button:disabled { cursor: wait; opacity: .62; }
      .venue-manager p { color: #94e5ff; font-size: 14px; }
      .venue-create-panel { padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: rgba(255,255,255,.025); }
      .venue-create-panel > summary { cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; list-style: none; }
      .venue-create-panel > summary::-webkit-details-marker, .venue-admin-row > summary::-webkit-details-marker { display: none; }
      .venue-create-panel > summary > span:first-child { display: grid; gap: 3px; }
      .venue-create-panel > summary strong { color: #fff; }
      .venue-create-panel > summary small { color: var(--dancr-color-text-muted); }
      .venue-disclosure { color: var(--dancr-color-text-muted); font-size: 21px; line-height: 1; transition: transform .18s ease; }
      .venue-create-panel[open] > summary .venue-disclosure, .venue-admin-row[open] > summary .venue-disclosure { transform: rotate(180deg); }
      .venue-search input::-webkit-search-cancel-button { filter: invert(1); opacity: .72; }
      .venue-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #fff; }
      .venue-list-heading small { color: var(--dancr-color-text-muted); }
      .venue-list { display: grid; gap: 8px; }
      .venue-admin-row { padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.09); background: linear-gradient(145deg, rgba(255,255,255,.045), rgba(255,255,255,.018)); overflow: hidden; }
      .venue-admin-row > summary { cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; color: #fff; list-style: none; }
      .venue-admin-row > summary:focus-visible, .venue-create-panel > summary:focus-visible { border-radius: 8px; outline: 2px solid #94e5ff; outline-offset: 4px; }
      .venue-admin-row summary strong, .venue-admin-row summary small { display: block; min-width: 0; overflow-wrap: anywhere; }
      .venue-admin-row small { color: var(--dancr-color-text-muted); }
      .venue-admin-identity { display: grid; gap: 3px; min-width: 0; }
      .venue-admin-summary-state { display: flex; align-items: center; gap: 8px; }
      .venue-admin-row em { padding: 5px 8px; border: 1px solid rgba(148,229,255,.22); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.06); font-size: 11px; font-style: normal; font-weight: 900; }
      .venue-admin-row em.connected { color: #8dffc4; border-color: rgba(50,255,164,.24); background: rgba(50,255,164,.07); }
      .venue-admin-row em.inactive { color: var(--dancr-color-text-muted); border-color: var(--dancr-color-border); background: rgba(20, 20, 27, 0.05); }
      .venue-admin-actions { display: grid; gap: 8px; padding-top: 12px; }
      .venue-admin-actions button { justify-self: start; }
      .venue-access-panel { display: grid; gap: 11px; margin-top: 12px; padding: 13px; border: 1px solid rgba(148,229,255,.16); border-radius: 10px; background: #08090d; }
      .venue-access-state { display: grid; gap: 5px; }
      .venue-access-state strong { color: #fff; }
      .venue-access-state p { color: var(--dancr-color-text-muted); font-size: 13px; }
      .venue-access-state.connected strong { color: #8dffc4; }
      .venue-access-state.inactive strong { color: var(--dancr-color-text-muted); }
      .venue-access-secret { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(148,229,255,.42); border-radius: 9px; background: rgba(148,229,255,.065); }
      .venue-access-secret > span { color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .15em; text-transform: uppercase; }
      .venue-access-secret code { user-select: all; color: #fff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: clamp(18px, 5vw, 24px); font-weight: 900; letter-spacing: .08em; overflow-wrap: anywhere; }
      .venue-access-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .venue-status { margin-top: 10px; color: #94e5ff !important; }
      .venue-page-admin-panel { display: grid; gap: 12px; margin-top: 12px; padding: 13px; border: 1px solid var(--dancr-color-border); border-radius: 10px; background: #08080d; }
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
      .venue-page-workflow-copy { display: grid; gap: 5px; padding: 11px; border: 1px solid var(--dancr-color-border); border-radius: 8px; background: rgba(20, 20, 27, 0.07); }
      .venue-page-workflow-copy small { color: var(--dancr-color-text-muted); font-size: 10px; font-weight: 950; letter-spacing: .13em; text-transform: uppercase; }
      .venue-page-workflow-copy strong { color: #f8fafc; line-height: 1.35; }
      .venue-page-workflow-copy p { margin: 0; color: var(--dancr-color-text-muted); font-size: 12px; line-height: 1.45; }
      .venue-page-workflow-actions button, .venue-page-preview-action { min-height: 44px; }
      .venue-page-preview-action { display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid var(--dancr-color-border); border-radius: 8px; color: #fff; background: linear-gradient(135deg,rgba(48, 48, 56, 0.26),rgba(48, 48, 56, 0.14)); box-shadow: none; font-size: 12px; font-weight: 900; text-align: center; text-decoration: none; }
      .venue-page-preview-action:hover { border-color: var(--dancr-color-border-strong); background: linear-gradient(135deg,rgba(48, 48, 56, 0.38),rgba(48, 48, 56, 0.22)); }
      .venue-page-preview-action:focus-visible { outline: 2px solid var(--dancr-color-brand-primary); outline-offset: 3px; }
      .venue-page-workflow-actions small { color: #94a3b8; line-height: 1.45; }
      .report-list { display: grid; gap: 12px; }
      .report-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .report-row span { color: var(--dancr-color-text-muted); }
      .report-row .report-reason, .report-row p { display: grid; gap: 3px; margin: 0; color: var(--dancr-color-text-primary); font-size: 14px; line-height: 1.45; }
      .report-row :is(.report-reason, p) b { color: #94e5ff; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; }
      .report-row .report-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .report-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .report-row .report-profile-link { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 12px; border: 1px solid rgba(148,229,255,.32); border-radius: 8px; color: var(--dancr-color-text-primary); background: rgba(148,229,255,.08); font-size: 12px; font-weight: 900; text-decoration: none; }
      .reported-profile-modal { display: grid; gap: 14px; }
      .reported-profile-context { display: grid; gap: 5px; padding: 14px; border: 1px solid rgba(255,180,84,.34); border-radius: 10px; background: rgba(255,180,84,.08); }
      .reported-profile-context > small { color: #ffd19a; font-size: 10px; font-weight: 950; letter-spacing: .11em; text-transform: uppercase; }
      .reported-profile-context > strong { color: #fff; font-size: 17px; }
      .reported-profile-context dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 7px 0 0; }
      .reported-profile-context dl > div { display: grid; gap: 3px; min-width: 0; padding: 9px; border-radius: 8px; background: rgba(0,0,0,.18); }
      .reported-profile-context dt { color: var(--dancr-color-text-muted); font-size: 10px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
      .reported-profile-context dd { margin: 0; color: #fff; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
      .dmca-admin, .dmca-case-list, .dmca-case-detail, .dmca-agent-settings form { display: grid; gap: 10px; }
      .dmca-admin-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .dmca-admin-summary a { color: #94e5ff; font-size: 12px; font-weight: 850; }
      .dmca-agent-warning { margin: 0; padding: 10px 12px; border: 1px solid rgba(255,180,84,.34); border-radius: 8px; color: #ffd19a !important; background: rgba(255,180,84,.09); font-size: 12px !important; }
      .dmca-agent-settings, .dmca-case-row { padding: 11px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: rgba(255,255,255,.035); }
      .dmca-agent-settings summary, .dmca-case-row summary { cursor: pointer; color: #fff; font-weight: 900; }
      .dmca-agent-settings form { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 12px; }
      .dmca-agent-settings label, .dmca-case-detail label { display: grid; gap: 6px; color: var(--dancr-color-text-primary); font-size: 12px; font-weight: 850; }
      .dmca-agent-settings input, .dmca-case-detail textarea { width: 100%; min-height: 40px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: rgba(255,255,255,.055); }
      .dmca-agent-settings button { justify-self: start; color: #090911; background: #f7f2ff; }
      .dmca-agent-check { grid-template-columns: 20px minmax(0, 1fr); align-items: center; }
      .dmca-agent-check input { width: 18px; min-height: 18px; }
      .dmca-admin-status { margin: 0; padding: 9px 11px; border: 1px solid rgba(140,234,255,.26); border-radius: 8px; color: #bff7ff !important; background: rgba(53,216,255,.08); font-size: 12px !important; }
      .dmca-case-row summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
      .dmca-case-row summary span { display: grid; gap: 3px; min-width: 0; }
      .dmca-case-row summary small { color: var(--dancr-color-text-muted); overflow-wrap: anywhere; }
      .dmca-case-row summary em { color: #94e5ff; font-size: 11px; font-style: normal; }
      .dmca-case-detail { margin-top: 12px; }
      .dmca-case-detail p { margin: 0; color: var(--dancr-color-text-muted); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
      .dmca-case-detail a { color: #94e5ff; font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .dmca-case-detail > small { color: var(--dancr-color-text-muted); overflow-wrap: anywhere; }
      .dmca-case-detail textarea { min-height: 78px; resize: vertical; }
      .dmca-counter-summary { display: grid; gap: 5px; padding: 10px; border: 1px solid rgba(50,255,164,.28); border-radius: 8px; background: rgba(50,255,164,.07); }
      .dmca-case-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .dmca-case-actions button { min-height: 38px; padding: 8px 10px; }
      .support-admin-panel { grid-column: span 2; }
      .support-inbox-list, .support-inbox-thread, .support-inbox-messages { display: grid; gap: 14px; min-width: 0; }
      .support-inbox-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
      .support-inbox-toolbar > div { min-width: 0; max-width: 100%; margin: 0; }
      .support-inbox-thread { padding: 16px; border-radius: 14px; border: 1px solid var(--dancr-color-border); background: rgba(255,255,255,.02); }
      .support-inbox-thread.is-escalated { border-color: rgba(255,180,84,.52); box-shadow: inset 3px 0 #ffb454; }
      .support-thread-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .support-thread-heading > div { flex: 1; min-width: 0; }
      .support-thread-heading h3 { margin: 0; color: var(--dancr-color-text-primary); font-size: 16px; font-weight: 650; overflow-wrap: anywhere; }
      .support-inbox-thread .support-thread-heading p { margin-top: 4px; color: var(--dancr-color-text-muted); font-size: 12px; }
      .support-thread-status { flex: 0 0 auto; padding: 4px 8px; border-radius: 999px; color: var(--dancr-color-text-muted); background: rgba(255,255,255,.05); font-size: 11px; font-weight: 600; }
      .support-thread-status.needs-reply { color: #fbbf24; background: rgba(251,191,36,.1); }
      .support-escalation { display: grid; gap: 5px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,180,84,.32); background: rgba(255,180,84,.09); }
      .support-escalation strong { color: #ffd19a; font-size: 12px; letter-spacing: .05em; }
      .support-escalation p { margin: 0; color: #ffe1bd; }
      .support-escalation.priority-urgent { border-color: rgba(255,91,116,.55); background: rgba(255,91,116,.12); }
      .support-escalation.priority-urgent strong { color: #ff9cac; }
      .support-inbox-message { display: grid; gap: 7px; justify-self: start; max-width: 92%; min-width: 0; padding: 10px 12px; border-radius: 12px 12px 12px 3px; background: rgba(255,255,255,.055); }
      .support-inbox-message.from-admin { justify-self: end; border-radius: 12px 12px 3px 12px; background: var(--dancr-color-control-secondary); }
      .support-message-meta { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 3px 14px; color: var(--dancr-color-text-muted); font-size: 11px; }
      .support-message-meta strong { font-size: 11px; font-weight: 600; overflow-wrap: anywhere; }
      .support-message-meta span { white-space: nowrap; }
      .support-inbox-thread p { color: var(--dancr-color-text-muted); font-size: 14px; line-height: 1.5; }
      .support-inbox-message p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .support-reply-composer { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.08); }
      .support-reply-label { display: grid; gap: 6px; color: var(--dancr-color-text-primary); font-size: 13px; font-weight: 600; }
      .support-inbox-thread textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 10px; border: 1px solid var(--dancr-color-border); background: rgba(255,255,255,.035); color: #fff; padding: 10px 12px; font: inherit; font-size: 14px; }
      .support-reply-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px; }
      .support-reply-actions p { flex: 1; font-size: 12px; color: var(--dancr-color-text-muted); }
      .support-inbox-thread button { min-height: 44px; padding: 0 14px; }
      .ranking-manager { display: grid; gap: 12px; }
      .ranking-manager form { display: grid; gap: 10px; }
      .ranking-manager label { display: grid; gap: 7px; color: var(--dancr-color-text-primary); font-size: 13px; font-weight: 850; }
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
      .moderation-thumb-empty { display: grid; place-items: center; color: var(--dancr-color-text-muted); font-size: 12px; font-weight: 900; }
      .image-moderation-copy strong { color: #fff; overflow-wrap: anywhere; }
      .image-moderation-copy span, .image-moderation-copy small { color: var(--dancr-color-text-muted); font-size: 12px; overflow-wrap: anywhere; }
      .image-moderation-copy details { border-radius: 8px; border: 1px solid rgba(255,255,255,.08); padding: 8px; background: rgba(5,5,8,.52); }
      .image-moderation-copy summary { cursor: pointer; color: #94e5ff; font-size: 12px; font-weight: 900; }
      .image-moderation-copy pre { max-height: 180px; overflow: auto; color: var(--dancr-color-text-primary); white-space: pre-wrap; font-size: 11px; }
      .image-moderation-copy textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .image-moderation-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .deal-activity-manager, .deal-activity-list { display: grid; gap: 10px; }
      .deal-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: end; }
      .deal-filters label { display: grid; gap: 7px; color: var(--dancr-color-text-primary); font-size: 13px; font-weight: 850; }
      .deal-activity-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .deal-activity-row span { color: var(--dancr-color-text-muted); font-size: 13px; }
      .deal-activity-row em { color: #94e5ff; font-size: 13px; font-style: normal; font-weight: 850; }
      .deal-activity-row button { justify-self: start; min-height: 34px; padding: 0 12px; }
      .deal-settlement-ledger { display: grid; gap: 5px; margin-top: 6px; padding: 10px; border: 1px solid rgba(148,163,184,.18); border-radius: 8px; background: rgba(5,5,7,.54); }
      .deal-settlement-ledger > strong { color: #f8fafc; font-size: 13px; }
      .deal-settlement-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .deal-settlement-action input { min-height: 38px; border: 1px solid rgba(148,229,255,.22); border-radius: 8px; color: #fff; background: rgba(148,229,255,.06); padding: 0 10px; font: inherit; }
      .admin-grid:empty { display: none; }
      .admin-workspace-nav { position: sticky; z-index: 30; top: 8px; max-width: 1120px; margin: 0 auto 18px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; padding: 6px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(8,8,12,.9); backdrop-filter: blur(18px); box-shadow: 0 16px 50px rgba(0,0,0,.38); }
      .admin-workspace-nav button { position: relative; min-height: 46px; padding: 8px 12px; color: var(--dancr-color-text-muted); background: transparent; border: 1px solid transparent; }
      .admin-workspace-nav button.active { color: #fff; border-color: rgba(148,229,255,.28); background: linear-gradient(var(--dancr-color-brand-primary), var(--dancr-color-brand-primary)); box-shadow: none; }
      .admin-workspace-nav button span { position: absolute; top: 3px; right: 5px; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; color: #071016; background: #94e5ff; font-size: 10px; font-weight: 950; }
      .operations-center, .workspace-lead { max-width: 1120px; margin: 0 auto 18px; display: grid; gap: 14px; }
      .admin-workspace-heading { width: 100%; max-width: 1120px; display: grid; gap: 7px; margin: 0 auto 14px; padding: 8px 2px 2px; }
      .admin-workspace-heading h2 { font-size: clamp(28px, 5vw, 40px); }
      .admin-workspace-heading p { color: var(--dancr-color-text-muted); font-size: 15px; }
      .admin-workspace-loading { width: 100%; max-width: 1120px; display: grid; gap: 14px; margin: 0 auto 18px; }
      .admin-workspace-loading header, .admin-workspace-loading > div { display: grid; gap: 10px; padding: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; background: #0b0b10; }
      .admin-workspace-loading > div { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .admin-workspace-loading span:not(.dashboard-sr-only) { display: block; min-height: 62px; border-radius: 10px; background: linear-gradient(100deg, rgba(255,255,255,.045) 20%, rgba(20, 20, 27, 0.12) 45%, rgba(255,255,255,.045) 70%); background-size: 240% 100%; animation: adminDashboardLoadingPulse 1.25s ease-in-out infinite; }
      .admin-workspace-loading header span { min-height: 15px; width: 58%; }
      .admin-workspace-loading header span.wide { min-height: 28px; width: 34%; }
      .admin-club-deal-manager .admin-panel-body > p { color: var(--dancr-color-text-muted); line-height: 1.5; }
      .admin-club-deal-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; padding: 12px; border: 1px solid var(--dancr-color-border); border-radius: 10px; background: rgba(20, 20, 27, 0.045); }
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
      .admin-club-deal-form label { display: grid; gap: 6px; color: var(--dancr-color-text-primary); font-size: 12px; font-weight: 850; }
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
      .admin-club-deal-item { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: #f8fafc; background: #111118; }
      .admin-club-deal-item.selected { border-color: var(--dancr-color-brand-primary); box-shadow: none; }
      .admin-club-deal-edit { display: grid; gap: 7px; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
      .admin-club-deal-edit span { display: flex; justify-content: space-between; gap: 8px; }
      .admin-club-deal-edit small { color: #6ee7b7; }
      .admin-club-deal-edit em { color: #94a3b8; font-size: 11px; font-style: normal; }
      .admin-club-deal-item > .danger-action { min-height: 44px; }
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
      .attention-grid span { color: var(--dancr-color-text-muted); font-size: 11px; font-weight: 850; }
      .attention-grid strong { font-size: 27px; line-height: 1; }
      .attention-grid small { color: var(--dancr-color-text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
      .operations-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .operations-metric-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px !important; }
      .operations-list { display: grid; gap: 7px; }
      .operations-list > div { min-height: 50px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.07); border-radius: 8px; background: rgba(255,255,255,.035); }
      .operations-list span { display: grid; gap: 2px; }
      .operations-list strong { color: #fff; font-size: 13px; overflow-wrap: anywhere; }
      .operations-list small { color: var(--dancr-color-text-muted); font-size: 11px; overflow-wrap: anywhere; }
      .operations-list em { color: #94e5ff; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
      .exception-block { display: grid; gap: 8px; padding: 10px; border: 1px solid rgba(255,180,84,.28); border-radius: 8px; background: rgba(255,180,84,.06); }
      .exception-block > strong { color: #ffd19a; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
      .quick-links { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px !important; }
      .quick-links button, .panel-link-button { min-height: 40px; padding: 8px 11px; color: var(--dancr-color-text-primary); border: 1px solid rgba(148,229,255,.24); background: rgba(148,229,255,.07); }
      .data-freshness { justify-self: end; color: var(--dancr-color-text-muted); font-size: 11px; }
      .health-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; }
      .health-row > div { display: grid; gap: 3px; }
      .health-row strong { color: #fff; }
      .health-row small { color: var(--dancr-color-text-muted); }
      .health-dot { width: 12px; height: 12px; border-radius: 999px; }
      .health-dot.healthy { background: #32ffa4; box-shadow: 0 0 16px rgba(50,255,164,.55); }
      .health-dot.warning { background: #ffb454; box-shadow: 0 0 16px rgba(255,180,84,.5); }
      .health-warning { display: grid; gap: 2px; padding: 9px 10px; border-radius: 8px; border: 1px solid rgba(255,180,84,.25); background: rgba(255,180,84,.06); }
      .health-warning strong { color: #ffd19a; font-size: 12px; }
      .health-warning span { color: #f0d1aa; font-size: 11px; overflow-wrap: anywhere; }
      .activity-timeline { display: grid; gap: 0; padding: 6px 14px 14px; border: 1px solid var(--dancr-color-border); border-radius: 10px; background: rgba(12,12,18,.86); }
      .activity-timeline article { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .activity-timeline article:last-child { border-bottom: 0; }
      .timeline-marker { width: 10px; height: 10px; margin-top: 4px; border-radius: 999px; background: #94e5ff; box-shadow: 0 0 15px rgba(148,229,255,.4); }
      .activity-timeline article > div { display: grid; gap: 3px; }
      .activity-timeline strong { color: #fff; }
      .activity-timeline span, .activity-timeline small { color: var(--dancr-color-text-muted); font-size: 12px; }
      .activity-timeline p { color: var(--dancr-color-text-primary); font-size: 13px; }
      .admin-search { display: grid; gap: 7px; color: var(--dancr-color-text-primary); font-size: 12px; font-weight: 850; }
      .account-table { display: grid; padding: 0 14px; border: 1px solid var(--dancr-color-border); border-radius: 10px; background: rgba(12,12,18,.86); }
      .account-table [role="row"] { min-height: 68px; display: grid; grid-template-columns: 2fr .7fr .7fr 1fr; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .account-table [role="row"]:last-child { border-bottom: 0; }
      .account-table [role="cell"] { color: var(--dancr-color-text-primary); font-size: 12px; overflow-wrap: anywhere; }
      .account-table [role="cell"]:first-child { display: grid; gap: 3px; }
      .account-table strong { color: #fff; }
      .account-table small { color: var(--dancr-color-text-muted); }
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
        .approval-actions, .report-row .report-actions, .content-review-actions, .venue-access-actions, .reported-profile-context dl { display: grid; grid-template-columns: 1fr; }
        .approval-row button, .report-row button, .report-row .report-profile-link, .venue-manager button, .venue-request-actions button, .venue-request-issued button, .deal-activity-row button { width: 100%; }
        .venue-request-details dl > div { grid-template-columns: 1fr; gap: 2px; }
        .venue-request-actions { grid-template-columns: 1fr; }
        .deal-settlement-action { grid-template-columns: 1fr; }
        .admin-club-deal-form, .admin-deal-request-inbox article { grid-template-columns: 1fr; }
        .admin-club-deal-form .wide { grid-column: 1; }
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
        background: var(--dancr-color-background);
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
      }
      .dashboard-head, .admin-grid, .admin-warning, .sign-in, .admin-workspace-nav, .operations-center, .workspace-lead, .admin-workspace-heading { width: 100%; max-width: 1120px; margin-left: auto; margin-right: auto; }
      .dashboard-head { min-height: 0; box-sizing: border-box; display: grid; gap: 18px; margin-bottom: var(--mydancr-dashboard-gap); padding: 24px 26px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 24px; background: #07070a; box-shadow: 0 20px 48px rgba(0,0,0,.34); }
      .dashboard-head-row { display: grid; grid-template-columns: minmax(0, 1fr) 42px; align-items: start; gap: 18px; }
      .dashboard-head-copy { min-width: 0; display: grid; gap: 8px; align-content: center; overflow: visible; }
      .dashboard-head h1 { max-width: 100%; overflow: visible; color: var(--dancr-color-text-primary); font-family: var(--font-display, "Outfit", sans-serif); font-size: clamp(32px, 5vw, 48px); font-weight: 850; line-height: 1; letter-spacing: -.025em; text-overflow: clip; white-space: normal; }
      .dashboard-head p { color: var(--mydancr-dashboard-muted); font-size: clamp(15px, 2.2vw, 17px); line-height: 1.45; }
      .dashboard-head .eyebrow { color: #94e5ff; }
      .dashboard-close { flex: 0 0 42px; width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid var(--dancr-color-border); border-radius: 50%; color: var(--dancr-color-text-primary); background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 10px 24px rgba(0,0,0,.3); text-decoration: none; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
      .dashboard-close svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; }
      .dashboard-close:hover { border-color: rgba(126,234,255,.42); background: rgba(20, 20, 27, 0.92); }
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
      .admin-dashboard-loading-pill, .admin-dashboard-loading-copy span, .admin-dashboard-loading-actions span, .admin-dashboard-loading-metrics span { display: block; background: linear-gradient(100deg, rgba(255,255,255,.055) 20%, rgba(20, 20, 27, 0.13) 45%, rgba(255,255,255,.055) 70%); background-size: 240% 100%; animation: adminDashboardLoadingPulse 1.25s ease-in-out infinite; }
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
      .admin-workspace-nav button { min-width: 0; min-height: 42px; padding: 0 8px; border: 0; border-radius: 11px; color: var(--dancr-color-text-primary); font-size: 13px; text-align: center; }
      .admin-workspace-nav button:hover { color: #fff; background: rgba(126,234,255,.08); }
      .admin-workspace-nav button:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .admin-workspace-nav button.active { color: #fff; border: 0; background: linear-gradient(var(--dancr-color-brand-primary), var(--dancr-color-brand-primary)); box-shadow: none; }
      .admin-workspace-nav button span { top: 2px; right: 3px; }
      .admin-grid { grid-template-columns: 1fr; gap: var(--mydancr-dashboard-gap); }
      .admin-panel { border-color: var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); box-shadow: none; }
      .support-admin-panel { grid-column: auto; }
      .admin-warning { margin-bottom: var(--mydancr-dashboard-gap); border-radius: 14px; }
      .sign-in { max-width: 520px; display: grid; gap: 14px; padding: 18px; border-color: var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); box-shadow: 0 28px 80px rgba(0,0,0,.38); }
      .sign-in .segmented { width: 100%; gap: 6px; padding: 5px; border-radius: 16px; background: rgba(255,255,255,.045); }
      .sign-in .segmented button { min-height: 46px; border-radius: 12px; }
      .sign-in .segmented button.active { background: linear-gradient(var(--dancr-color-brand-primary), var(--dancr-color-brand-primary)); box-shadow: none; }
      .sign-in input { min-height: 48px; border-radius: 12px; background: var(--dancr-color-control-secondary); font-size: 16px; }
      .sign-in .forgot-password { width: 100%; min-height: 44px; justify-self: stretch; border: 1px solid rgba(248,250,252,.12); border-radius: 12px; color: rgba(255,255,255,.88); background: rgba(24,24,29,.94); }
      .sign-in > button[type="submit"] { width: 100%; min-height: 48px; border: 1px solid var(--dancr-color-brand-primary); border-radius: 12px; color: #fff; background: linear-gradient(var(--dancr-color-brand-primary), var(--dancr-color-brand-primary)); box-shadow: none; }
      .sign-in > button[type="submit"]:hover, .sign-in > button[type="submit"]:focus-visible { border-color: var(--dancr-color-brand-primary); outline: 2px solid var(--dancr-color-brand-primary); outline-offset: 2px; }

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
        .sign-in { gap: 13px; padding: 16px; }
      }
    `}</style>
  );
}
