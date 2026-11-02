import { mediaLibraryStatus, type ClubMediaState } from "../../src/lib/dancr/club-media-status.ts";
import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "../../src/lib/dancr/media-limits.ts";
import { dancerMainPhotoSelection } from "./dancer-main-photo-selection.ts";
import type { DancerPhotoItem } from "./dashboard-types";

export type DancerWorkingPresence = { venueId: string; workingUntil: string; mode: unknown } | null;
export type VisibilityReason = { text: string; action: string; href: string; venueId?: string };
export type DancerVisibilityNoticeState = {
  state: "visible" | "blocked" | "off" | "unknown" | "unavailable";
  title: string;
  detail: string;
  reasons: VisibilityReason[];
};
export type DancerVisibilityInput = {
  clubMedia: ClubMediaState;
  photos: DancerPhotoItem[];
  presence?: DancerWorkingPresence;
  presenceError?: boolean;
  isPublic: boolean;
  isIncognito: boolean;
  profileApproved: boolean;
  verificationRequired?: boolean;
};

export function dancerVisibilityNotice(input: DancerVisibilityInput, now = Date.now()): DancerVisibilityNoticeState {
  const { clubMedia, photos, presence, isPublic, isIncognito, profileApproved, verificationRequired } = input;
  const unknown = (detail: string): DancerVisibilityNoticeState => ({ state: "unknown", title: "Checking profile visibility", detail, reasons: [] });
  if (input.presenceError) return {
    state: "unavailable", title: "Profile visibility unavailable",
    detail: "Your check-in could not be loaded, so we can’t confirm your profile’s visibility.",
    reasons: [{ text: "We’ll retry automatically, or you can retry now from Working Now.", action: "View check-in", href: "#dancer-schedule" }],
  };
  if (presence === undefined) return unknown("Checking your current check-in and club approvals.");
  if (presence && !Number.isFinite(Date.parse(presence.workingUntil))) return unknown("Your current check-in could not be confirmed.");
  if (!presence || Date.parse(presence.workingUntil) <= now) return {
    state: "off", title: "Not in Working Now", detail: "You’re not currently checked in. Your profile’s public visibility is separate.",
    reasons: [{ text: "Tap the club’s check-in tag when you arrive to start a new session.", action: "View check-in", href: "#dancer-schedule" }],
  };
  if (clubMedia.error || clubMedia.loading) return {
    ...unknown(clubMedia.error ? "You’re checked in, but club approval status is temporarily unavailable. It will refresh automatically." : "You’re checked in. Checking your club approvals…"),
    title: clubMedia.error ? "Checked in · Visibility unavailable" : "Checked in · Checking visibility",
  };
  const club = clubMedia.activeClub;
  if (!club || club.id !== presence.venueId || !Number.isFinite(Date.parse(club.workingUntil)) || Date.parse(club.workingUntil) <= now) return unknown("Updating your current club’s check-in and approval status.");
  const requirement = clubMedia.requirements?.find(item => item.venueId === club.id);
  if (!requirement) return unknown(`You’re checked in at ${club.name}. Waiting for its media approval status.`);

  const reasons: VisibilityReason[] = [];
  const add = (text: string, action: string, href: string, venueId?: string) => reasons.push({ text, action, href, venueId });
  if (isIncognito) add("Incognito is on. Your profile is hidden from all guests.", "Manage visibility", "#dancer-visibility");
  else if (!isPublic) add("Your public profile is turned off. Review your check-in visibility.", "Review check-in visibility", "#dancer-schedule");
  else if (presence.mode === "internal") add("Your check-in is set to Club only, so you’re hidden from public Working Now.", "Change check-in visibility", "#dancer-schedule");
  if (!profileApproved) add("Your profile approval is not complete.", "Review profile", "#dancer-profile");
  if (verificationRequired) add("Your age verification needs attention.", "Review verification", "#dancer-verification");

  const scope = { ...clubMedia, selectedClub: club, filterToClub: true };
  const rows = clubMedia.statuses.filter(row => row.venueId === club.id && !row.hidden);
  if (!requirement.hasApprovedMain) {
    const { displayed } = dancerMainPhotoSelection(photos, scope);
    const mainRow = rows.find(row => row.kind === "photo" && row.isMain);
    const state = displayed ? mediaLibraryStatus(displayed, scope, "photo") : mainRow?.submissionState;
    if (state === "draft") add(`Your main photo is saved as a draft. Submit it to ${club.name} for approval.`, "Review & submit main photo", "#dancer-profile-media-library", club.id);
    else if (state === "needs_changes" || mainRow?.status === "rejected") add("Your main photo needs changes before it can be approved.", "Review main photo", "#dancer-main-photo", club.id);
    else if (state === "pending" || mainRow?.status === "pending") add("Your main photo is awaiting approval.", "View main photo review", "#dancer-main-photo", club.id);
    else add("This club needs an approved main photo selected for your profile.", "Add or choose main photo", "#dancer-main-photo", club.id);
  }
  for (const kind of ["photo", "video"] as const) {
    const count = kind === "photo" ? requirement.approvedPhotos : requirement.approvedVideos;
    const minimum = kind === "photo" ? MIN_DANCER_ONBOARDING_PHOTOS : MIN_DANCER_ONBOARDING_VIDEOS;
    if (count >= minimum) continue;
    const media = rows.filter(row => row.kind === kind);
    const draft = media.some(row => row.submissionState === "draft");
    const pending = media.some(row => row.submissionState === "pending" || !row.submissionState && row.status === "pending");
    const progress = `${count} of ${minimum} required ${kind}${minimum === 1 ? "" : "s"} approved`;
    add(`${progress}. ${draft ? "Your new uploads still need to be submitted." : pending ? "Your submitted media is awaiting approval." : "Add or replace media to meet this club’s requirements."}`,
      draft ? "Submit for approval" : `Review ${kind}s`, kind === "photo" ? "#dancer-profile-media-library" : "#dancer-profile-video-library", club.id);
  }
  if (!requirement.eligible && !reasons.length) add("Your media is not yet eligible to show at this club.", "Review club media", "#dancer-profile-media-library", club.id);
  if (reasons.length) {
    const publicOnlyRestriction = !isIncognito && profileApproved && !verificationRequired && requirement.eligible
      && requirement.hasApprovedMain && requirement.approvedPhotos >= MIN_DANCER_ONBOARDING_PHOTOS
      && requirement.approvedVideos >= MIN_DANCER_ONBOARDING_VIDEOS;
    return { state: "blocked", title: publicOnlyRestriction ? "Checked in · Profile not visible publicly" : "Checked in · Profile not visible",
      detail: `Your check-in at ${club.name} is active.`, reasons };
  }
  if (!["both", "external"].includes(String(presence.mode))) return unknown(`You’re checked in at ${club.name}, but your check-in visibility mode could not be confirmed.`);
  return { state: "visible", title: "Visible in Working Now", detail: `Your approved profile is visible on the public grid at ${club.name}.`, reasons: [] };
}
