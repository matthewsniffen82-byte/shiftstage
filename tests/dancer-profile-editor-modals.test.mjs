import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";

const [dashboard, dancerStudio, mediaSync] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dancer-profile-media-sync.ts", import.meta.url), "utf8"),
]);

const identityEditor = dashboard.match(/function DancerSetupPanel\([\s\S]*?(?=\nfunction DancerAvatarPanel)/)?.[0] || "";
const avatarEditor = dashboard.match(/function DancerAvatarPanel\([\s\S]*?(?=\nfunction DancerShiftPanel)/)?.[0] || "";
const photoEditor = dashboard.match(/function DancerPhotoPanel\([\s\S]*?(?=\nfunction normalizePhotoStatus)/)?.[0] || "";
const videoUpload = dancerStudio.match(/async function uploadVideoBatch\([\s\S]*?(?=\n  async function removeVideo)/)?.[0] || "";

test("stage name and city use the compact editor without changing persistence or market data", () => {
  assert.match(dashboard, /identity: "Stage name & city"/);
  assert.match(identityEditor, /placeholder="Enter stage name"/);
  assert.match(identityEditor, /<label>\s*Stage name[\s\S]*?<label>\s*City/);
  assert.match(identityEditor, /Choose from active MyDancr venue markets\./);
  assert.match(identityEditor, /\{unifiedSave \? null : <h2>Setup<\/h2>\}/);
  assert.doesNotMatch(identityEditor, /Add and save your stage name and city/);
  assert.match(identityEditor, /fetch\("\/api\/public\/cities"/);
  assert.match(identityEditor, /fetch\("\/api\/public\/cities", \{[\s\S]*?signal: controller\.signal/);
  assert.equal((identityEditor.match(/if \(controller\.signal\.aborted\) return;/g) || []).length, 2);
  assert.match(identityEditor, /return \(\) => controller\.abort\(\);/);
  assert.match(identityEditor, /requestDancerProfileJson\([\s\S]*?method: "PATCH"/);
});

test("avatar editor derives its preview from the main photo and offers crop adjustment", () => {
  assert.match(avatarEditor, /photos\.find\(photo => photo\.status === "approved" && photo\.isPrimary\)/);
  assert.match(avatarEditor, /dancerAvatarPreview\(profile, pendingMain\?\.id\)/);
  assert.match(avatarEditor, /canAdjustCrop = Boolean\(main && !pendingAvatarUrl\)/);
  assert.match(avatarEditor, /alt="Avatar from your main photo"/);
  assert.match(avatarEditor, /Add your main photo first\./);
  assert.match(avatarEditor, /void adjustCrop\(\)/);
  assert.doesNotMatch(avatarEditor, /uploadAvatar|removeAvatar|type="file"/);
});

test("avatar crop adjustment rejects duplicate, canceled, and stale-owner work", () => {
  assert.match(avatarEditor, /if \(!main \|\| !canAdjustCrop \|\| action\.current\) return;/);
  assert.match(avatarEditor, /controller\.signal\.aborted \|\| session\?\.account\?\.id !== owner \|\| session\.account\.role !== "dancer"/);
  assert.match(avatarEditor, /return \(\) => \{ action\.current\?\.abort\(\); action\.current = null; \}/);
  assert.match(avatarEditor, /window\.addEventListener\("storage", accountChanged\)/);
  assert.match(avatarEditor, /window\.removeEventListener\("storage", accountChanged\)/);
  assert.match(avatarEditor, /sourcePath: main\.storagePath, expectedAvatarUpdatedAt: profile\?\.avatar_updated_at \?\? null/);
  assert.equal((avatarEditor.match(/signal: controller\.signal/g) || []).length, 3);
  assert.match(avatarEditor, /if \(action\.current === controller\) \{ action\.current = null; setBusy\(false\); \}/);
  assert.match(avatarEditor, /Avatar crop saved\. Reload to see the latest photo\./);
});

test("photo editor shows actual media only and does not advertise capacity", () => {
  assert.match(photoEditor, /Add at least 1 solo photo of yourself\. You can add more later\./);
  assert.match(photoEditor, /Your photos/);
  assert.match(photoEditor, /approvedPhotos\.map\(\(photo\)/);
  assert.doesNotMatch(photoEditor, /<h2>Photos<\/h2>|No profile photos uploaded yet|0\/50|\/\{MAX_DANCER_PROFILE_PHOTOS\}|up to 50|maximum 50/i);
  assert.match(photoEditor, /MAX_DANCER_PROFILE_PHOTOS - photos\.length/);
  assert.match(photoEditor, /photos\.length \+ batch\.filter\(item => !item\.replaces\)\.length > MAX_DANCER_PROFILE_PHOTOS/);
  assert.match(photoEditor, /requestDancerPhotosJson/);
});

test("photo uploads, arrangement, and deletion reject duplicate and stale work", () => {
  assert.match(photoEditor, /const mountedRef = useRef\(false\);/);
  assert.match(photoEditor, /const actionSequenceRef = useRef\(0\);/);
  assert.match(photoEditor, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(photoEditor, /const actionInFlightRef = useRef\(false\);/);
  assert.match(photoEditor, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(photoEditor, /function queuePhotos[\s\S]*?if \(actionInFlightRef\.current\) return;/);
  assert.match(photoEditor, /async function deletePhoto\(photo: DancerPhotoItem\) \{\s*if \(actionInFlightRef\.current\) return;/);
  assert.match(photoEditor, /const uploadKey = `\$\{item\.id\}:gallery`/);
  assert.match(photoEditor, /let nextSortOrder = Math\.max\(nextGalleryPhotoSortOrder\(workingPhotos\),/);
  assert.match(photoEditor, /const uploadSortOrder = item\.uploadSortOrder \?\? \(item\.id === mainCandidate\?\.id \? 0 : nextSortOrder\+\+\)/);
  assert.doesNotMatch(photoEditor, /Date\.now\(\)/);
  assert.match(photoEditor, /persistQueuedPhotoDeletions\(controller\.signal\)/);
  assert.match(photoEditor, /if \(signal\.aborted \|\| !mountedRef\.current\) return;/);
  assert.equal((photoEditor.match(/signal: controller\.signal/g) || []).length, 5);
  assert.equal((photoEditor.match(/signal: transfer\.signal/g) || []).length, 2);
  assert.equal((photoEditor.match(/finishPhotoAction\(requestId\)/g) || []).length, 4);
  assert.match(photoEditor, /mountedRef\.current = false;[\s\S]*?actionSequenceRef\.current \+= 1;[\s\S]*?actionAbortRef\.current\?\.abort\(\);[\s\S]*?actionInFlightRef\.current = false;/);
});

test("video editor keeps both permission gates and hides the technical library capacity", () => {
  assert.doesNotMatch(dancerStudio, /Add videos now or later\./);
  assert.match(dancerStudio, /Confirm permissions/);
  assert.match(dancerStudio, /I am the only person shown, and this video is of me\./);
  assert.match(dancerStudio, /I own this video or have permission to publish every visual, recording, song, beat, and other audio it contains\./);
  assert.match(dancerStudio, /checked=\{consentConfirmed\}/);
  assert.match(dancerStudio, /checked=\{rightsConfirmed\}/);
  assert.match(dancerStudio, /Vertical or square · MP4, WebM, MOV/);
  assert.match(dancerStudio, /VIDEO_UPLOAD_MAX_SECONDS/);
  assert.match(dancerStudio, /VIDEO_UPLOAD_MAX_BYTES \/ \(1024 \* 1024\)/);
  assert.doesNotMatch(dancerStudio, /0\/50|\{currentVideoCount\}\/\{maxVideos\}|up to 50|maximum 50/i);
  assert.match(dancerStudio, /currentVideoCount >= maxVideos/);
  assert.match(dancerStudio, /const selectedFiles = files\.slice\(0, availableSlots\)/);
});

test("video uploads, retries, and removal reject duplicate and stale work", () => {
  assert.match(dancerStudio, /const actionSequenceRef = useRef\(0\);/);
  assert.match(dancerStudio, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(dancerStudio, /const actionInFlightRef = useRef\(false\);/);
  assert.match(dancerStudio, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(dancerStudio, /function queueVideoFiles[\s\S]*?if \(actionInFlightRef\.current\) return;/);
  assert.match(dancerStudio, /async function removeVideo\(videoId: string\) \{\s*if \(actionInFlightRef\.current\) return;/);
  assert.match(dancerStudio, /const uploadId = crypto\.randomUUID\(\);[\s\S]*?uploadId,/);
  assert.match(videoUpload, /uploadId: item\.uploadId/);
  assert.match(videoUpload, /!data\.upload\.alreadySubmitted && !data\.upload\.uploadComplete/);
  assert.match(videoUpload, /if \(!data\.upload\.alreadySubmitted\)/);
  assert.match(videoUpload, /if \(item\.replaces\) \{[\s\S]*?if \(videoId\) \{[\s\S]*?method: "DELETE", signal: transfer\.signal/);
  assert.equal((videoUpload.match(/method: "DELETE"/g) || []).length, 1);
  assert.equal((videoUpload.match(/signal: controller\.signal/g) || []).length, 1);
  assert.equal((videoUpload.match(/signal: transfer\.signal/g) || []).length, 3);
  assert.match(dancerStudio, /mountedRef\.current = false;[\s\S]*?actionSequenceRef\.current \+= 1;[\s\S]*?actionAbortRef\.current\?\.abort\(\);[\s\S]*?actionInFlightRef\.current = false;/);
});

test("approved videos refresh into the builder and video cards render a visible preview frame", () => {
  assert.match(dancerStudio, /announceDancerProfileVideosChanged\(\)/);
  assert.match(dancerStudio, /hasProcessingVideos[\s\S]*?window\.setInterval/);
  assert.match(dancerStudio, /const workspaceRequestIdRef = useRef\(0\)/);
  assert.match(dancerStudio, /const workspaceAbortRef = useRef<AbortController \| null>\(null\)/);
  assert.match(dancerStudio, /signal: controller\.signal/);
  assert.match(dancerStudio, /if \(!mountedRef\.current \|\| requestId !== workspaceRequestIdRef\.current\) return false/);
  assert.match(dancerStudio, /mountedRef\.current = false;[\s\S]*?workspaceRequestIdRef\.current \+= 1;[\s\S]*?workspaceAbortRef\.current\?\.abort\(\)/);
  assert.match(dancerStudio, /document\.visibilityState !== "visible"/);
  assert.match(dancerStudio, /document\.addEventListener\("visibilitychange", refresh\)/);
  assert.match(dancerStudio, /if \(updated && !cancelled\) announceDancerProfileVideosChanged\(\)/);
  assert.doesNotMatch(dancerStudio, /\.then\(\(\) => announceDancerProfileVideosChanged\(\)\)/);
  assert.match(dancerStudio, /async function removeVideo[\s\S]*?beginVideoAction\(\)[\s\S]*?method: "DELETE"[\s\S]*?isCurrentVideoAction\(requestId, controller\)[\s\S]*?setWorkspace/);
  assert.match(dashboard, /addEventListener\(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange\)/);
  assert.match(dashboard, /status === "uploading" \|\| status === "moderating"/);
  assert.match(dashboard, /window\.setTimeout\(\(\) => void loadVideos\(\), hasProcessingVideo \? 1_800 : 8_000\)/);
  assert.match(dashboard, /let requestController: AbortController \| null = null;[\s\S]*?requestController\?\.abort\(\);[\s\S]*?signal: controller\.signal/);
  assert.match(dashboard, /controller\.signal\.aborted \|\| requestId !== requestSequence/);
  assert.match(dashboard, /requestController\?\.abort\(\);[\s\S]*?requestController = null;[\s\S]*?removeEventListener\(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange\)/);
  assert.match(dashboard, /requestId === requestSequence\) setIsMediaLoading\(false\)/);
  assert.match(dancerStudio, /<DancerVideoPreview[\s\S]*?videoUrl=\{item\?\.previewUrl \|\| video\?\.videoUrl\} posterUrl=\{video\?\.posterUrl\}/);
  assert.match(dashboard, /imageUrl: video\.posterUrl, status: video\.status/);
  assert.doesNotMatch(dashboard, /primeVideoPreviewFrame/);
  assert.match(mediaSync, /video\.currentTime = Math\.min\(0\.15, Math\.max\(0\.05, video\.duration \/ 100\)\)/);
});


test("saving onboarding identity stays separate from the profile completion requirements", () => {
  assert.match(dashboard, /const profileReady = Boolean\(\s*persistedStageName\s*&& persistedCity\s*&& submissionMedia\.hasMain\s*&& galleryReady,\s*\)/);
  const workspace = dashboard.match(/function DancerOnboardingProfileMediaWorkspace[\s\S]*?(?=\nfunction |$)/)?.[0] || "";
  assert.match(workspace, /<DancerIdentityEditor[^>]*>\s*\{identityContent\(\)\}\s*<\/DancerIdentityEditor>/);
  assert.doesNotMatch(workspace, /DancerProfilePreview|builderRequirements|continueAfterSave/);
});

test("completed compact editors do not report a false save failure after they unmount", () => {
  assert.match(dashboard, /if \(!detail\.tasks\.length\) return true;/);
  assert.doesNotMatch(dashboard, /Some changes could not be saved\. Check the highlighted section/);
  assert.match(dashboard, /A profile section could not be saved\. Reopen the section you changed and review its message\./);
});
