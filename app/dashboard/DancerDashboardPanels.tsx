"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import { publishDancerVisibility } from "@/src/lib/dancr/publish-dancer-visibility";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";
import { DancerDashboardIcon } from "./DancerDashboardIdentity";
import { readSession, requestDancerProfileJson, requestDancerProfileVisibilityJson } from "./dashboard-session";
import type { LoadState, DancerPhotoItem, DancerIdentityDraft, DancerProfileEditorSaveRequest } from "./dashboard-types";
import { persistedDancerStageName, DashboardSection, DANCER_PROFILE_EDITOR_SAVE_EVENT } from "./DashboardShared";
import { dancerPhotoItemsFromProfile, DancerPhotoPanel } from "./DancerPhotoPanel";
import { DancerAvatarPanel } from "./DancerAvatarPanel";
import { DancerMainPhotoPanel } from "./DancerMainPhotoPanel";
import DancerAgeVerificationGate from "./DancerAgeVerificationGate";
import { DancerAnalyticsPanel } from "./DancerAnalyticsPanel";
import { DancerOnboardingCommand } from "./DancerProfileEditor";
import DancerProfileWorkspace from "./DancerProfileWorkspace";
import DancerDashboardWorkspace from "./DancerDashboardWorkspace";
import DashboardPhoneNotifications from "./DashboardPhoneNotifications";
import "./dancer-visibility-sharing.css";
// Keep role-specific tools out of every customer's initial JavaScript. Editors
// load when mounted; the visible role's core tools warm while its data loads.
const DancerNfcPanel = dynamic(() => import("./DancerNfcPanel"));

const DancerTvStudio = dynamic(() => import("./DancerTvStudio"));

const DancerShiftManager = dynamic(() => import("./DancerShiftManager"));


export function DancerPanel({
  agreement,
  accountContent,
  accountState,
  affiliations,
  analytics,
  nfc,
  onProfileChange,
  onWorkingNowChange,
  profile,
}: {
  agreement?: LoadState["agreement"];
  accountContent?: ReactNode;
  accountState?: string;
  affiliations: Array<Record<string, unknown>>;
  analytics?: LoadState["analytics"];
  nfc?: LoadState["nfc"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
  onWorkingNowChange?: (workingNow: boolean) => void;
  profile?: LoadState["profile"];
}) {
  const effectiveStatus = effectiveDancerProfileStatus(profile, accountState);
  const isApproved = effectiveStatus === "approved";
  const agreementReviewRequired = agreement?.required === true && !agreement.accepted;
  useEffect(() => {
    if (!isApproved || agreementReviewRequired) offerPushNotifications("dancer-dashboard");
  }, [isApproved, agreementReviewRequired]);
  const isPublic = isApproved && profile?.is_public !== false && profile?.isPublic !== false;
  const isVenueApproved = Boolean(profile?.venue_approved_at || profile?.venueApprovedAt)
    || affiliations.some((item) => item.status === "active");
  const [editorBusy, setEditorBusy] = useState(false);
  const [mainBusy, setMainBusy] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [editorRequested, setEditorRequested] = useState(0);
  const [presenceKey, setPresenceKey] = useState<string>();
  const handlePresenceChange = useCallback((key: string) => {
    setPresenceKey(key);
    onWorkingNowChange?.(key !== "off");
  }, [onWorkingNowChange]);
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [deletedPhotoStoragePaths, setDeletedPhotoStoragePaths] = useState<string[]>([]);
  const [draftIdentity, setDraftIdentity] = useState(() => ({
    stageName: persistedDancerStageName(profile),
    city: String(profile?.city || ""),
  }));
  const hasRejectedMedia = (!profile?.avatar_source_photo_id && (profile?.avatar_review as Record<string, unknown> | undefined)?.decision === "rejected")
    || dancerPhotoItemsFromProfile(profile).some(photo => photo.status === "rejected");
  const hasPendingAvatar = !profile?.avatar_source_photo_id && Boolean(profile?.pending_avatar_review);
  const hasPendingPhotos = dancerPhotoItemsFromProfile(profile).some((photo) => photo.status === "pending");

  useEffect(() => {
    if (!hasPendingAvatar && !hasPendingPhotos && (isApproved || effectiveStatus !== "pending_review")) return;
    let cancelled = false;
    let refreshInFlight = false;
    const controller = new AbortController();
    const refreshProfile = async () => {
      if (cancelled || controller.signal.aborted || document.visibilityState !== "visible" || refreshInFlight) return;
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
          signal: controller.signal,
        });
        if (!cancelled && !controller.signal.aborted && data.profile) onProfileChange?.(data.profile);
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
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshProfile);
    };
  }, [effectiveStatus, hasPendingAvatar, hasPendingPhotos, isApproved, onProfileChange]);

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

  const identityContent = (field?: keyof DancerIdentityDraft) => (
    <DancerSetupPanel
      field={field}
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
      autosave
    />
  );
  const avatarContent = <DancerAvatarPanel compact profile={profile} onProfileChange={onProfileChange} />;
  const mainPhotoContent = <DancerMainPhotoPanel onBusyChange={setMainBusy} key={String(profile?.id || "new-profile")} profile={profile} onProfileChange={onProfileChange} />;
  const photoContent = (
    <DancerPhotoPanel
      uploadOnly
      onBusyChange={setPhotosBusy}
      deletedPhotoIds={deletedPhotoIds}
      deletedPhotoStoragePaths={deletedPhotoStoragePaths}
      onDeletedPhotoIdsChange={setDeletedPhotoIds}
      onDeletedPhotoStoragePathsChange={setDeletedPhotoStoragePaths}
      profile={profile}
      onProfileChange={onProfileChange}
    />
  );
  const videoContent = <DancerTvStudio embedded uploadOnly onBusyChange={setVideoBusy} />;
  const workspaceProps = { identityContent: identityContent(), avatarContent, mainPhotoContent, photoContent, videoContent,
    draftIdentity, profile, onProfileChange, isPublic, uploadBusy: mainBusy || photosBusy || videoBusy, onBusyChange: setEditorBusy };
  const visibilityAndSharing = <section className="dancer-workspace-card" id="dancer-visibility-sharing" aria-label="Visibility and sharing">
    <h3>Visibility & sharing</h3>
    <DashboardSection id="dancer-visibility" title="Profile visibility" description="Show or hide your public profile." icon={<DancerDashboardIcon section="status" />} toggleAffordance="chevron"><DancerVisibilityPanel profile={profile} onProfileChange={onProfileChange} /></DashboardSection>
    <DashboardSection id="dancer-share" title="Share profile" description="Copy your public profile link." icon={<DancerDashboardIcon section="profile" />} toggleAffordance="chevron"><DancerSharePanel profile={profile} /></DashboardSection>
  </section>;
  const accountTools = <>
    <DashboardSection id="dancer-connected-clubs" title="Connected clubs" description="Your club access and check-in tags." icon={<DancerDashboardIcon section="schedule" />} toggleAffordance="chevron">
      <DancerNfcPanel compactAuthorized initialAffiliations={affiliations} initialNfcState={nfc || null} onAuthorizationChange={refreshDancerProfile} />
    </DashboardSection>
    <DashboardSection id="dancer-verification" title="Verification" description="Your age verification status." icon={<DancerDashboardIcon section="status" />} toggleAffordance="chevron"><DancerAgeVerificationGate><p>Your age verification requirements are complete.</p></DancerAgeVerificationGate></DashboardSection>
    {accountContent}
  </>;
  return <>
    <DancerActivationConfirmation affiliations={affiliations} isLive={isPublic} nfc={nfc} profile={profile} />
    {!isApproved || agreementReviewRequired ? <>
      <DancerOnboardingCommand agreementReviewRequired={agreementReviewRequired} effectiveStatus={effectiveStatus} isVenueApproved={isVenueApproved} onProfileChange={onProfileChange} profile={profile}
        profileMediaContent={({ profileReady, agreementComplete, continueToAgreement, continueLabel }) => <DancerProfileWorkspace key={String(profile?.id || "profile")} {...workspaceProps} onboarding profileReady={profileReady} agreementComplete={agreementComplete} onContinue={continueToAgreement} continueLabel={continueLabel} />}
        venueVerificationContent={<DancerNfcPanel onboarding initialAffiliations={affiliations} initialNfcState={nfc || null} onAuthorizationChange={refreshDancerProfile} />} />
      {accountContent}
    </> : <DancerDashboardWorkspace busy={editorBusy} editorRequested={editorRequested}
      overview={<>
        <DashboardPhoneNotifications />
        <DancerAgeVerificationGate><section className="dancer-daily-card" id="dancer-schedule"><header><h2>Working Now</h2><DancerDashboardIcon section="schedule" /></header><DancerShiftManager onPresenceChange={handlePresenceChange} onVisibilityChange={refreshDancerProfile} /></section></DancerAgeVerificationGate>
        <section className="dancer-daily-card" id="dancer-overview">
          <header><div><h2>Your profile</h2><p>Public visibility is separate from your club check-in.</p></div><span className={`dancer-visibility-badge${isPublic ? " is-public" : ""}`}>{isPublic ? "Public" : "Hidden"}</span></header>
          {hasPendingAvatar || hasPendingPhotos || hasRejectedMedia || !isPublic ? <section className="dancer-attention-note" aria-label="Profile attention">
            <h3>{hasRejectedMedia ? "Needs attention" : hasPendingAvatar || hasPendingPhotos ? "Awaiting review" : "Profile visibility"}</h3>
            {hasRejectedMedia ? <p>A photo needs replacement. <a href="#dancer-profile-media-library">Review photos</a></p> : null}
            {hasPendingAvatar || hasPendingPhotos ? <p>New photos are being checked. Approved photos stay in place. <a href="#dancer-profile-media-library">View review status</a></p> : null}
            {!isPublic ? <p>Your public profile is hidden. <a href="#dancer-visibility">Manage visibility</a></p> : null}
          </section> : null}
          <div className="dancer-overview-actions"><button className="dancer-workspace-save" type="button" onClick={() => setEditorRequested(value => value + 1)}>Edit profile</button><a href="#dancer-share">Share profile</a>{isPublic && profile?.slug ? <Link href={`/dancers/${encodeURIComponent(String(profile.slug))}`} target="_blank" rel="noopener noreferrer" aria-label="View public profile">View profile</Link> : null}</div>
        </section>
        <DancerAgeVerificationGate loadingLabel="Loading results…"><DancerAnalyticsPanel compact initialAnalytics={analytics} presenceKey={presenceKey} /></DancerAgeVerificationGate>
      </>}
      profile={<DancerProfileWorkspace key={String(profile?.id || "profile")} {...workspaceProps} visibilityContent={visibilityAndSharing} />}
      results={<DancerAgeVerificationGate loadingLabel="Loading results…"><section className="dancer-daily-card" id="dancer-performance"><header><div><h2>Results</h2><p>See your requests, returning VIPs and audience growth.</p></div><DancerDashboardIcon section="performance" /></header><DancerAnalyticsPanel initialAnalytics={analytics} presenceKey={presenceKey} /></section></DancerAgeVerificationGate>}
      account={accountTools}
    />}
  </>;

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
    const sectionId = "dancer-profile";
    const url = new URL(window.location.href);
    url.searchParams.delete("nfc");
    url.hash = sectionId;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setCompletionRequested(false);
    window.dispatchEvent(new Event("hashchange"));
    const section = document.getElementById("dancer-destination-profile");
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="dancer-activation-confirmation" role="status" aria-live="polite" aria-labelledby="dancer-activation-title">
      <span className="dancer-activation-check" aria-hidden="true">✓</span>
      <div className="dancer-activation-copy">
        <span className="eyebrow">Dancer activation complete</span>
        <h2 id="dancer-activation-title">You’re ready</h2>
        <p>
          {venueName ? `Approved through ${venueName}. ` : "Your dressing-room tap was approved. "}
          Your MyDancr profile is active.
        </p>
        <div className="dancer-activation-actions">
          {slug ? <Link href={`/dancers/${encodeURIComponent(slug)}`} onClick={acknowledgeCompletion}>View my profile</Link> : null}
          <a href="#dancer-profile-media" onClick={openProfileManager}>Go to dashboard</a>
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
  const [hasSaved, setHasSaved] = useState(false);
  const mountedRef = useRef(false);
  const visibilitySequenceRef = useRef(0);
  const visibilityAbortRef = useRef<AbortController | null>(null);
  const visibilityInFlightRef = useRef(false);

  useEffect(() => {
    setIsPublic(profile?.is_public !== false && profile?.isPublic !== false);
  }, [profile]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      visibilitySequenceRef.current += 1;
      visibilityAbortRef.current?.abort();
      visibilityAbortRef.current = null;
      visibilityInFlightRef.current = false;
    };
  }, []);

  async function toggleVisibility() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!mountedRef.current || visibilityInFlightRef.current) return;
    visibilityInFlightRef.current = true;
    const requestId = ++visibilitySequenceRef.current;
    visibilityAbortRef.current?.abort();
    const controller = new AbortController();
    visibilityAbortRef.current = controller;
    const nextPublic = !isPublic;
    setIsSaving(true);
    setHasSaved(false);
    setStatus("Saving visibility…");
    try {
      const data = await requestDancerProfileVisibilityJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPublic: nextPublic }),
        fallbackMessage: "Unable to update profile visibility.",
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== visibilitySequenceRef.current) return;
      const savedPublic = data.profile?.is_public === true || data.profile?.isPublic === true;
      if (savedPublic !== nextPublic) throw new Error("Profile visibility did not save. Try again.");
      if (data.visibility?.verified !== true || data.visibility?.publicProfileVisible !== nextPublic) {
        throw new Error("Public profile visibility could not be verified. Try again.");
      }
      publishDancerVisibility(String(data.profile.id), savedPublic);
      if (data.profile) onProfileChange?.({ ...(profile || {}), ...data.profile });
      setIsPublic(savedPublic);
      setHasSaved(true);
      setStatus(
        savedPublic
          ? "Saved. Profile is public."
          : "Saved. Profile is hidden.",
      );
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted && requestId === visibilitySequenceRef.current) {
        setStatus(error instanceof Error ? error.message : "Unable to update profile visibility.");
      }
    } finally {
      if (requestId === visibilitySequenceRef.current) {
        visibilityAbortRef.current = null;
        visibilityInFlightRef.current = false;
        if (mountedRef.current) setIsSaving(false);
      }
    }
  }

  return (
    <article className={`info-panel visibility-panel ${isPublic ? "" : "is-incognito"}`} aria-label="Profile visibility controls">
      <div className="visibility-controls">
        <div className="visibility-state" aria-label={`Profile visibility: ${isPublic ? "Public, visible" : "Incognito, hidden"}`}>
          <strong>{isPublic ? "Public" : "Incognito"}</strong>
          <span aria-hidden="true">·</span>
          <b>{isPublic ? "Visible" : "Hidden"}</b>
        </div>
        <button className="visibility-toggle" data-action-state={isSaving ? "saving" : hasSaved ? "success" : "idle"} type="button" onClick={toggleVisibility} disabled={isSaving} aria-busy={isSaving}>
          <span>{isSaving ? "Saving…" : isPublic ? "Go incognito" : "Make profile public"}</span>
        </button>
      </div>
      <p>Incognito hides your profile and content. Everything stays saved.</p>
      <p className="visibility-status" role="status" aria-live="polite">{status}</p>
    </article>
  );
}


function DancerSetupPanel({
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  field,
  onDeletedPhotoIdsSaved,
  onDraftChange,
  onProfileChange,
  profile,
  unifiedSave = false,
  autosave = false,
}: {
  deletedPhotoIds?: string[];
  deletedPhotoStoragePaths?: string[];
  field?: keyof DancerIdentityDraft;
  onDeletedPhotoIdsSaved?: () => void;
  onDraftChange?: (draft: DancerIdentityDraft) => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  unifiedSave?: boolean;
  autosave?: boolean;
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
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const draftRevision = useRef(0);
  const latestDraft = useRef({ stageName, city });
  latestDraft.current = { stageName, city };
  const latestProfile = useRef(profile);
  latestProfile.current = profile;
  const savePromise = useRef<Promise<boolean> | null>(null);
  const draftKey = `mydancr:dancer-profile-draft:${String(profile?.id || "profile")}`;
  const editorSaveRef = useRef<() => Promise<boolean>>(async () => true);
  editorSaveRef.current = () => saveProfile();

  useEffect(() => {
    if (!autosave || !draftHydratedRef.current || !draftDirtyRef.current || saveStatus === "saving" || saveStatus === "error") return;
    if (stageName.trim().length < 2 || stageName.trim().length > 40 || cityOptionsStatus !== "ready" || !cityOptions.some(option => option.value === city)) return;
    const timer = window.setTimeout(() => { void editorSaveRef.current(); }, 800);
    return () => window.clearTimeout(timer);
  }, [autosave, stageName, city, cityOptions, cityOptionsStatus, saveStatus]);

  useEffect(() => {
    console.log("ACTIVE_EDIT_PROFILE_VERSION", "canonical-profile-approval-v14");
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
    const controller = new AbortController();

    async function loadCityOptions() {
      try {
        const response = await fetch("/api/public/cities", {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load available cities.");
        const options = Array.isArray(data.cities)
          ? data.cities.filter((option: any) => Boolean(option?.value && option?.label))
          : [];
        if (!options.length) throw new Error("No dancer signup cities are available.");
        setCityOptions(options);
        setCityOptionsStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setCityOptions([]);
        setCityOptionsStatus("error");
      }
    }

    void loadCityOptions();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    if ((deletedPhotoIds.length || deletedPhotoStoragePaths.length) && saveStatus === "saved" && !actionInFlightRef.current) {
      setSaveStatus("idle");
    }
  }, [deletedPhotoIds, deletedPhotoStoragePaths, saveStatus]);

  function beginProfileAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentProfileAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishProfileAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return false;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    return mountedRef.current;
  }

  async function hardResetProfile() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const action = beginProfileAction();
    if (!action) return;
    const { requestId, controller } = action;
    console.log("PROFILE_RELOAD_REQUESTED");
    setIsResetting(true);
    setStatus("Reloading the latest saved profile...");
    try {
      const data = await requestDancerProfileJson({
        method: "GET",
        cache: "no-store",
        fallbackMessage: "Unable to reload the saved profile.",
        signal: controller.signal,
      });
      if (!isCurrentProfileAction(requestId, controller)) return;
      if (!data.profile) throw new Error("Unable to reload the saved profile.");

      deletedPhotoIdsRef.current = [];
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsSaved?.();
      onProfileChange?.(data.profile);
      draftDirtyRef.current = false;
      window.localStorage.removeItem(draftKey);
      setSaveStatus("idle");
      setStatus("Latest saved profile reloaded.");
    } catch (error) {
      if (isCurrentProfileAction(requestId, controller)) {
        console.error("DANCER_PROFILE_HARD_RESET_FAILED", safeErrorMetadata(error));
        setStatus(error instanceof Error ? error.message : "Unable to reload the saved profile.");
      }
    } finally {
      if (finishProfileAction(requestId)) setIsResetting(false);
    }
  }

  async function saveProfile(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (savePromise.current) {
      const saved = await savePromise.current;
      if (!saved || !mountedRef.current) return false;
      return draftDirtyRef.current ? editorSaveRef.current() : true;
    }
    if (autosave && !draftDirtyRef.current && !deletedPhotoIdsRef.current.length && !deletedPhotoStoragePathsRef.current.length) return true;
    const task = persistProfile();
    savePromise.current = task;
    try { return await task; }
    finally { if (savePromise.current === task) savePromise.current = null; }
  }

  async function persistProfile() {
    const revision = draftRevision.current;
    const { stageName, city } = latestDraft.current;

    const session = readSession();
    if (!session?.accessToken) {
      setSaveStatus("error");
      setStatus("Sign in required.");
      return false;
    }

    const action = beginProfileAction();
    if (!action) return false;
    const { requestId, controller } = action;
    setSaveStatus("saving");
    setStatus("Saving...");
    const idsToDelete = [...deletedPhotoIdsRef.current];
    const storagePathsToDelete = [...deletedPhotoStoragePathsRef.current];

    try {
      const payload = {
        ...(field !== "city" ? { stageName } : {}),
        ...(field !== "stageName" ? { city } : {}),
        deletedPhotoIds: idsToDelete,
        deletedPhotoStoragePaths: storagePathsToDelete,
      };
      console.log("EDIT_PROFILE_BEFORE_SAVE", {
        deletedPhotoCount: idsToDelete.length,
        profilePhotoCount: Array.isArray(profile?.dancer_photos) ? profile.dancer_photos.length : 0,
      });
      console.log("EDIT_PROFILE_SAVE_PAYLOAD", {
        hasStageName: Boolean(stageName),
        hasCity: Boolean(city),
        deletedPhotoCount: idsToDelete.length,
        deletedPhotoStoragePathCount: storagePathsToDelete.length,
      });
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        fallbackMessage: "Unable to save profile.",
        signal: controller.signal,
      });
      if (!isCurrentProfileAction(requestId, controller)) return false;

      const refreshedPhotoRows = [
        ...(Array.isArray(data.profile?.dancer_photos) ? data.profile.dancer_photos : []),
        ...(Array.isArray(data.profile?.pending_photo_reviews) ? data.profile.pending_photo_reviews : []),
      ];
      const refreshedPhotoIds = new Set(refreshedPhotoRows.map((photo: any) => String(photo?.id || "")).filter(Boolean));
      const incorrectlyRestoredIds = idsToDelete.filter((id) => refreshedPhotoIds.has(id));
      const confirmedDeletedIds = new Set((Array.isArray(data.deletedPhotoIds) ? data.deletedPhotoIds : []).map((id: unknown) => String(id)));
      const unconfirmedDeletedIds = idsToDelete.filter((id) => !confirmedDeletedIds.has(id));
      console.log("EDIT_PROFILE_REFETCHED_PHOTOS", {
        photoCount: refreshedPhotoIds.size,
        requestedDeletedCount: idsToDelete.length,
        confirmedDeletedCount: confirmedDeletedIds.size,
      });
      if (incorrectlyRestoredIds.length) throw new Error("DELETED_PHOTO_RETURNED_AFTER_SAVE");
      if (unconfirmedDeletedIds.length) throw new Error("PROFILE_PHOTO_DELETE_COUNT_MISMATCH");

      if (!data.profile) throw new Error("Unable to confirm your saved details. Try again.");
      // Background identity saves must not restore a media snapshot from before a newer upload.
      const nextProfile: Record<string, unknown> = autosave && !idsToDelete.length && !storagePathsToDelete.length
        ? { ...latestProfile.current } : data.profile;
      if (nextProfile !== data.profile) {
        for (const key of ["stage_name", "stageName", "city", "identity_saved_at", "identitySavedAt", "slug"]) {
          if (key in data.profile) nextProfile[key] = data.profile[key];
        }
      }
      onProfileChange?.(nextProfile);
      const savedIdentity = {
        stageName: persistedDancerStageName(data.profile),
        city: String(data.profile?.city || "").trim(),
      };
      // Saving one field must not discard an unfinished draft in the other.
      const nextDraft = {
        stageName: draftRevision.current !== revision || field === "city" ? latestDraft.current.stageName : savedIdentity.stageName,
        city: draftRevision.current !== revision || field === "stageName" ? latestDraft.current.city : savedIdentity.city,
      };
      draftDirtyRef.current = nextDraft.stageName !== savedIdentity.stageName || nextDraft.city !== savedIdentity.city;
      if (draftDirtyRef.current) window.localStorage.setItem(draftKey, JSON.stringify(nextDraft));
      else window.localStorage.removeItem(draftKey);
      setStageName(nextDraft.stageName);
      setCity(nextDraft.city);
      onDraftChange?.(nextDraft);
      deletedPhotoIdsRef.current = [];
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsSaved?.();
      setSaveStatus(draftDirtyRef.current ? "idle" : "saved");
      const hasPendingPhotos = Array.isArray(data.profile?.pending_photo_reviews) && data.profile.pending_photo_reviews.length > 0;
      setStatus(hasPendingPhotos
        ? "Saved Profile. Photos awaiting review will appear on your live profile after approval."
        : "Saved Profile");
      return true;
    } catch (error) {
      if (isCurrentProfileAction(requestId, controller)) {
        console.error("EDIT_PROFILE_SAVE_FAILED", safeErrorMetadata(error));
        setSaveStatus("error");
        setStatus(error instanceof Error ? error.message : "Profile could not be saved.");
      }
      return false;
    } finally {
      finishProfileAction(requestId);
    }
  }

  const visibleStatus = autosave ? saveStatus === "error" ? `Not saved. ${status}` : saveStatus === "saving" ? "Saving…" : draftDirtyRef.current ? "Unsaved changes" : persistedDancerStageName(profile) && city ? "Saved" : ""
    : unifiedSave ? saveStatus === "error" ? status : "" : status
    || (saveStatus === "saving" ? "Saving changes..." : draftDirtyRef.current ? "Unsaved changes" : saveStatus === "saved" ? "Saved" : "");

  return (
    <article className="info-panel setup-panel dancer-profile-identity-editor">
      {unifiedSave ? null : <h2>Setup</h2>}
      <form className="dancer-profile-identity-form" onSubmit={saveProfile}>
        {field !== "city" ? <label>
          Stage name
          <input className="dancer-stage-name-input" type="text" value={stageName} minLength={2} maxLength={40} autoComplete="nickname" placeholder="Enter stage name" onChange={(event) => {
            draftDirtyRef.current = true;
            draftRevision.current += 1;
            latestDraft.current = { ...latestDraft.current, stageName: event.target.value };
            setStageName(event.target.value);
            if (!actionInFlightRef.current) setSaveStatus("idle");
            setStatus("");
          }} required />
        </label> : null}
        {field !== "stageName" ? <label>
          City
          <select value={city} disabled={cityOptionsStatus !== "ready"} onChange={(event) => {
            draftDirtyRef.current = true;
            draftRevision.current += 1;
            latestDraft.current = { ...latestDraft.current, city: event.target.value };
            setCity(event.target.value);
            if (!actionInFlightRef.current) setSaveStatus("idle");
            setStatus("");
          }} required>
            <option value="" disabled>
              {cityOptionsStatus === "loading" ? "Loading available cities..." : cityOptionsStatus === "error" ? "Cities temporarily unavailable" : "Select a city"}
            </option>
            {cityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {cityOptionsStatus === "error" ? <small>The live city list could not be loaded. Try again before saving.</small> : !unifiedSave ? <small>Choose from active MyDancr venue markets.</small> : null}
        </label> : null}
        {unifiedSave ? null : (
          <div className="dancer-profile-form-actions">
            <button className="dancer-profile-save-action primary-action" data-action-state={saveStatus === "saved" ? "success" : saveStatus} aria-busy={saveStatus === "saving"} type="submit" disabled={saveStatus === "saving" || (field !== "stageName" && cityOptionsStatus !== "ready")}>
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : "Save profile"}
            </button>
            <button aria-label="Reload saved profile" className="dancer-profile-reload-action" type="button" onClick={hardResetProfile} disabled={isResetting || saveStatus === "saving"}>
              {isResetting ? "Reloading..." : "Reload saved"}
            </button>
          </div>
        )}
        {visibleStatus ? (
          <p className={`dancer-form-save-state ${draftDirtyRef.current ? "is-unsaved" : "is-saved"}`} role="status" aria-live="polite">
            {visibleStatus}
            {autosave && saveStatus === "error" ? <button type="button" onClick={() => void saveProfile()}>Retry save</button> : null}
          </p>
        ) : null}
      </form>
    </article>
  );
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
    <article className="info-panel share-panel" aria-label="Profile sharing">
      {slug ? (
        <div className="share-grid">
          <div className="share-link-row">
            <span>
              <strong>mydancr.com/dancers/{slug}</strong>
            </span>
          </div>
          <div className="share-actions">
            <button type="button" onClick={copyLink}>
              {status === "Profile link copied." ? "Copied" : "Copy link"}
            </button>
            <Link className="share-open-profile-button secondary-action" href={`/dancers/${slug}`}>
              Open profile
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </Link>
          </div>
          {status ? <p className="share-status" role="status" aria-live="polite">{status}</p> : null}
        </div>
      ) : (
        <p>Save your stage name first to create a public profile link.</p>
      )}
    </article>
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
