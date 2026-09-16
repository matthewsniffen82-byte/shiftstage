"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { SocialPlatformIcon } from "@/app/dancers/[slug]/SocialLinks";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { DancerDashboardIcon } from "./DancerDashboardIdentity";
import { readSession, requestDancerProfileJson, requestDancerProfileVisibilityJson } from "./dashboard-session";
import type { LoadState, DancerPhotoItem, DancerProfileSocialEditor, DancerProfileEditorSections, DancerIdentityDraft, DancerProfileEditorSaveRequest } from "./dashboard-types";
import { persistedDancerStageName, saveDancerProfileEditor, DashboardSection, Metric, DANCER_PROFILE_EDITOR_SAVE_EVENT, SOCIAL_PLATFORMS } from "./DashboardShared";
import { dancerPhotoItemsFromProfile, DancerPhotoPanel } from "./DancerPhotoPanel";
import { DancerAvatarPanel } from "./DancerAvatarPanel";
import { DancerProfilePreview, DancerOnboardingCommand, DancerOnboardingProfileMediaWorkspace } from "./DancerProfileEditor";
// Keep role-specific tools out of every customer's initial JavaScript. Editors
// load when mounted; the visible role's core tools warm while its data loads.
const DancerNfcPanel = dynamic(() => import("./DancerNfcPanel"));

const DancerTvStudio = dynamic(() => import("./DancerTvStudio"));

const DancerShiftManager = dynamic(() => import("./DancerShiftManager"));


export function DancerPanel({
  accountState,
  affiliations,
  analytics,
  deals,
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
  const isVenueApproved = Boolean(profile?.venue_approved_at || profile?.venueApprovedAt)
    || affiliations.some((item) => item.status === "active");
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [deletedPhotoStoragePaths, setDeletedPhotoStoragePaths] = useState<string[]>([]);
  const [draftIdentity, setDraftIdentity] = useState(() => ({
    stageName: persistedDancerStageName(profile),
    city: String(profile?.city || ""),
  }));
  const hasPendingAvatar = Boolean(profile?.pending_avatar_review);
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
      uploadOnly
      deletedPhotoIds={deletedPhotoIds}
      deletedPhotoStoragePaths={deletedPhotoStoragePaths}
      onDeletedPhotoIdsChange={setDeletedPhotoIds}
      onDeletedPhotoStoragePathsChange={setDeletedPhotoStoragePaths}
      profile={profile}
      onProfileChange={onProfileChange}
    />
  );
  const videoContent = <DancerTvStudio embedded uploadOnly />;
  const profileEditorSections: DancerProfileEditorSections = {
    identity: identityContent,
    avatar: avatarContent,
    photos: photoContent,
    videos: videoContent,
    socials: socialContent,
  };
  const profileMediaWorkspace = (
    <div className="venue-dashboard-inner-grid dancer-onboarding-profile-workspace">
      <article className="dancer-profile-editor-launch-card" aria-labelledby="dancer-profile-media-preview-heading">
        <span>
          <strong id="dancer-profile-media-preview-heading">Profile details</strong>
          <small>Avatar, stage name, city, photos, videos and socials.</small>
        </span>
        <DancerProfilePreview
          buttonClassName="dancer-profile-editor-launch-button"
          buttonLabel="Edit profile"
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
          onProfileChange={onProfileChange}
          profile={profile}
          saveLabel="Save & return to dashboard"
        />
      </article>
      <details className="dancer-profile-share-tools">
        <summary><span className="dancer-share-button-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg>Share profile</span></summary>
        <DancerSharePanel profile={profile} />
      </details>
    </div>
  );
  const profileMediaSection = (
    <DashboardSection
      description="Edit your profile or share it."
      emphasis="primary"
      id="dancer-profile-media"
      icon={<DancerDashboardIcon section="profile" />}
      toggleAffordance="chevron"
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
              onProfileChange={onProfileChange}
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
          description="Visibility and connected clubs."
          emphasis="summary"
          id="dancer-overview"
          icon={<DancerDashboardIcon section="status" />}
          toggleAffordance="chevron"
          title="Profile status"
        >
          <div className="venue-dashboard-inner-grid dancer-overview-grid">
            <DancerVisibilityPanel profile={profile} onProfileChange={onProfileChange} />
            <DancerNfcPanel
              compactAuthorized
              initialAffiliations={affiliations}
              initialNfcState={nfc || null}
              onAuthorizationChange={refreshDancerProfile}
            />
          </div>
        </DashboardSection>
      ) : null}
      {isApproved ? profileMediaSection : null}
      {isApproved ? (
        <DashboardSection
          description="Working Now and upcoming dates."
          emphasis="primary"
          id="dancer-schedule"
          icon={<DancerDashboardIcon section="schedule" />}
          toggleAffordance="chevron"
          title="Schedule"
        >
          <DancerShiftManager />
        </DashboardSection>
      ) : null}
      {isApproved ? (
        <DashboardSection
          description="Views, Club Deals, and guest activity."
          emphasis="secondary"
          id="dancer-performance"
          icon={<DancerDashboardIcon section="performance" />}
          toggleAffordance="chevron"
          title="Performance"
        >
          <div className="dancer-performance-workspace">
            <DancerPerformanceSummary analytics={analytics} deals={deals} />
            <div className="dancer-performance-details">
              <DancerPerformanceDetail
                badge={`${String(deals?.successfulRedemptionsThisMonth || 0)} this month`}
                description="Deal saves, shares, and verified redemptions."
                title="Club Deal activity"
              >
                <DancerDealPanel deals={deals} />
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
    setStatus(nextPublic ? "Reactivating your public profile..." : "Hiding your profile from the site...");
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
      if (data.profile) onProfileChange?.({ ...(profile || {}), ...data.profile });
      setIsPublic(savedPublic);
      setStatus(
        savedPublic
          ? "Your profile is back on and visible to guests."
          : "Incognito is on. Your profile and schedule will disappear as pages refresh. Previously loaded content and shared media may remain visible.",
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
    <article className={`info-panel visibility-panel ${isPublic ? "" : "is-incognito"}`}>
      <h2>Profile visibility</h2>
      <div className="visibility-copy">
        <div className="visibility-state" aria-label={`Profile visibility: ${isPublic ? "Public, visible" : "Incognito, hidden"}`}>
          <strong>{isPublic ? "Public" : "Incognito"}</strong>
          <span aria-hidden="true">·</span>
          <b>{isPublic ? "Visible" : "Hidden"}</b>
        </div>
        <p>{isPublic ? "Guests can find your approved profile across MyDancr." : "Your profile is hidden from guests; your dashboard and tools stay available."}</p>
        <p>Incognito hides your profile and schedule as pages refresh. Previously loaded content and shared media may remain visible.</p>
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
}: {
  analytics?: LoadState["analytics"];
  deals?: LoadState["deals"];
}) {

  return (
    <section className="dancer-performance-summary" aria-label="Performance summary">
      <Metric label="Current rank" value={String(analytics?.currentRank || "Unranked")} />
      <Metric label="30-day views" value={String(analytics?.profileViews30Days || 0)} />
      <Metric label="Club Deals this month" value={String(deals?.successfulRedemptionsThisMonth || 0)} />
      <Metric label="Deal saves" value={String(deals?.qrSaves || 0)} />
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
  return (
    <article className="info-panel deal-panel" aria-label="Club Deal activity details">
      <div className="deal-metrics">
        <Metric label="Successful this month" value={String(deals?.successfulRedemptionsThisMonth || 0)} />
        <Metric label="Cashier opens" value={String(deals?.qrOpens || 0)} />
        <Metric label="Saved / shared intent" value={String(deals?.qrSaves || 0) + " / " + String(deals?.qrShares || 0)} />
        <Metric label="Redeemed deals" value={String(deals?.redeemed || 0)} />
      </div>
      <p>Club Deals stay visible on your profile. Guest activity and verified admissions appear here.</p>
    </article>
  );
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
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const draftKey = `mydancr:dancer-profile-draft:${String(profile?.id || "profile")}`;
  const editorSaveRef = useRef<() => Promise<boolean>>(async () => true);
  editorSaveRef.current = () => saveProfile();

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
        stageName,
        city,
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
      </div>
      {slug ? (
        <div className="share-grid">
          <div className="share-link-row">
            <span>
              <small>Your MyDancr link</small>
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
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const draftKey = `mydancr:dancer-social-draft:${String(profile?.id || "profile")}`;
  const editorSaveRef = useRef<() => Promise<boolean>>(async () => true);
  const persistedSocials = useMemo(() => socialValuesFromProfile(profile), [profile]);
  const selectedPlatform = SOCIAL_PLATFORMS.find((item) => item.key === platform) || SOCIAL_PLATFORMS[0];
  const persistedValue = persistedSocials[selectedPlatform.key] || "";
  const hasExistingLink = Boolean(persistedValue.trim());
  editorSaveRef.current = () => saveSocials();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      savePendingRef.current = false;
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

  function beginSocialAction() {
    if (!mountedRef.current || savePendingRef.current) return null;
    savePendingRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentSocialAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishSocialAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return false;
    actionAbortRef.current = null;
    savePendingRef.current = false;
    return mountedRef.current;
  }

  async function saveSocials(event?: React.FormEvent<HTMLFormElement>, values = socials) {
    event?.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return false;
    }

    const action = beginSocialAction();
    if (!action) return false;
    const { requestId, controller } = action;
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
        signal: controller.signal,
      });
      if (!isCurrentSocialAction(requestId, controller)) return false;
      if (data.profile) onProfileChange?.(data.profile);
      draftDirtyRef.current = false;
      window.localStorage.removeItem(draftKey);
      setStatus("Social links saved.");
      return true;
    } catch (error) {
      if (isCurrentSocialAction(requestId, controller)) {
        setStatus(error instanceof Error ? error.message : "Unable to save socials.");
      }
      return false;
    } finally {
      if (finishSocialAction(requestId)) setIsSaving(false);
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
