import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, dancerStudio, mediaSync] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dancer-profile-media-sync.ts", import.meta.url), "utf8"),
]);

const identityEditor = dashboard.match(/function DancerSetupPanel\([\s\S]*?(?=\nfunction DancerAvatarPanel)/)?.[0] || "";
const avatarEditor = dashboard.match(/function DancerAvatarPanel\([\s\S]*?(?=\nfunction DancerShiftPanel)/)?.[0] || "";
const photoEditor = dashboard.match(/function DancerPhotoPanel\([\s\S]*?(?=\nfunction normalizePhotoStatus)/)?.[0] || "";

test("stage name and city use the compact editor without changing persistence or market data", () => {
  assert.match(dashboard, /identity: "Stage name & city"/);
  assert.match(identityEditor, /placeholder="Enter stage name"/);
  assert.match(identityEditor, /<label>\s*Stage name[\s\S]*?<label>\s*City/);
  assert.match(identityEditor, /Choose from active MyDancr venue markets\./);
  assert.match(identityEditor, /\{unifiedSave \? null : <h2>Setup<\/h2>\}/);
  assert.doesNotMatch(identityEditor, /Add and save your stage name and city/);
  assert.match(identityEditor, /fetch\("\/api\/public\/cities"/);
  assert.match(identityEditor, /requestDancerProfileJson\([\s\S]*?method: "PATCH"/);
});

test("avatar editor has one compact requirement and keeps the real upload workflow", () => {
  assert.match(dashboard, /avatar: "Add profile photo"/);
  assert.match(avatarEditor, /Required · Use a clear solo face photo of yourself\./);
  assert.match(avatarEditor, />Gallery<\/strong>/);
  assert.match(avatarEditor, />Camera<\/strong>/);
  assert.match(avatarEditor, /AI checks that only you appear, then centers the photo automatically\./);
  assert.doesNotMatch(avatarEditor, /Profile identity|<h2>Avatar<\/h2>/i);
  assert.match(avatarEditor, /void uploadAvatar\(nextFile\)/);
  assert.match(avatarEditor, /requestDancerAvatarJson/);
});

test("avatar upload and removal reject duplicate and stale work", () => {
  assert.match(avatarEditor, /const mountedRef = useRef\(false\);/);
  assert.match(avatarEditor, /const actionSequenceRef = useRef\(0\);/);
  assert.match(avatarEditor, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(avatarEditor, /const actionInFlightRef = useRef\(false\);/);
  assert.match(avatarEditor, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(avatarEditor, /function selectAvatar[\s\S]*?if \(actionInFlightRef\.current\) return;/);
  assert.match(avatarEditor, /async function removeAvatar\(\) \{\s*if \(actionInFlightRef\.current\) return;/);
  assert.match(avatarEditor, /const uploadIdentityRef = useRef<\{ signature: string; key: string \} \| null>\(null\);/);
  assert.match(avatarEditor, /uploadIdentityRef\.current\?\.signature === signature[\s\S]*?uploadIdentityRef\.current[\s\S]*?createAvatarUploadIdentity\(nextFile\)/);
  assert.match(avatarEditor, /key: `\$\{signature\}:avatar:\$\{crypto\.randomUUID\(\)\}`/);
  assert.equal((avatarEditor.match(/signal: controller\.signal/g) || []).length, 2);
  assert.equal((avatarEditor.match(/refreshProfile\(controller\.signal\)/g) || []).length, 2);
  assert.equal((avatarEditor.match(/if \(!isCurrentAvatarAction\(requestId, controller\)\) return;/g) || []).length, 4);
  assert.match(avatarEditor, /mountedRef\.current = false;[\s\S]*?actionSequenceRef\.current \+= 1;[\s\S]*?actionAbortRef\.current\?\.abort\(\);[\s\S]*?actionInFlightRef\.current = false;/);
});

test("photo editor shows actual media only and does not advertise capacity", () => {
  assert.match(photoEditor, /Add at least 1 solo picture of yourself\. You can add more later\./);
  assert.match(photoEditor, /Your photos/);
  assert.match(photoEditor, /photos\.map\(\(photo, photoIndex\)/);
  assert.doesNotMatch(photoEditor, /<h2>Photos<\/h2>|No profile photos uploaded yet|0\/50|\/\{MAX_DANCER_PROFILE_PHOTOS\}|up to 50|maximum 50/i);
  assert.match(photoEditor, /MAX_DANCER_PROFILE_PHOTOS - photos\.length/);
  assert.match(photoEditor, /photos\.length \+ batch\.length > MAX_DANCER_PROFILE_PHOTOS/);
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
  assert.match(photoEditor, /const uploadKey = `\$\{item\.id\}:\$\{makePrimary \? "primary" : "gallery"\}`/);
  assert.match(photoEditor, /uploadSortOrder = uploadSortOrder \?\? \(makePrimary \? 0 : nextGalleryPhotoSortOrder\(workingPhotos\)\)/);
  assert.doesNotMatch(photoEditor, /Date\.now\(\)/);
  assert.match(photoEditor, /persistQueuedPhotoDeletions\(controller\.signal\)/);
  assert.match(photoEditor, /if \(signal\.aborted \|\| !mountedRef\.current\) return;/);
  assert.equal((photoEditor.match(/signal: controller\.signal/g) || []).length, 5);
  assert.equal((photoEditor.match(/finishPhotoAction\(requestId\)/g) || []).length, 3);
  assert.match(photoEditor, /mountedRef\.current = false;[\s\S]*?actionSequenceRef\.current \+= 1;[\s\S]*?actionAbortRef\.current\?\.abort\(\);[\s\S]*?actionInFlightRef\.current = false;/);
});

test("video editor keeps both permission gates and hides the technical library capacity", () => {
  assert.match(dancerStudio, /Optional · Add videos now or later\./);
  assert.match(dancerStudio, /Confirm permissions/);
  assert.match(dancerStudio, /I am the only person shown, and this video is of me\./);
  assert.match(dancerStudio, /I own this video or have permission to publish every visual, recording, song, beat, and other audio it contains\./);
  assert.match(dancerStudio, /checked=\{consentConfirmed\}/);
  assert.match(dancerStudio, /checked=\{rightsConfirmed\}/);
  assert.match(dancerStudio, /Vertical or square · MP4, WebM, or MOV · 1–30 sec · 75 MB max/);
  assert.doesNotMatch(dancerStudio, /0\/50|\{currentVideoCount\}\/\{maxVideos\}|up to 50|maximum 50/i);
  assert.match(dancerStudio, /currentVideoCount >= maxVideos/);
  assert.match(dancerStudio, /const selectedFiles = files\.slice\(0, availableSlots\)/);
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
  assert.match(dancerStudio, /method: "DELETE"[\s\S]*?workspaceRequestIdRef\.current \+= 1;[\s\S]*?setWorkspace/);
  assert.match(dashboard, /addEventListener\(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange\)/);
  assert.match(dashboard, /status === "uploading" \|\| status === "moderating"/);
  assert.match(dashboard, /window\.setTimeout\(\(\) => void loadVideos\(\), 1_800\)/);
  assert.match(dancerStudio, /onLoadedMetadata=\{\(event\) => primeVideoPreviewFrame\(event\.currentTarget\)\}/);
  assert.match(dashboard, /onLoadedMetadata=\{\(event\) => primeVideoPreviewFrame\(event\.currentTarget\)\}/);
  assert.match(mediaSync, /video\.currentTime = Math\.min\(0\.15, Math\.max\(0\.05, video\.duration \/ 100\)\)/);
});

test("saved social platforms use a populated state instead of retaining an add badge", () => {
  assert.match(dashboard, /hasLink \? "Edit" : "Add"/);
  assert.match(dashboard, /\{hasLink \? "✓" : "\+"\}/);
  assert.match(dashboard, /dancer-profile-builder-social-platform\.is-added/);
});

test("the three-item counter remains the authoritative profile essentials counter", () => {
  assert.match(dashboard, /label: "Stage name & city", section: "identity"/);
  assert.match(dashboard, /label: "Avatar", section: "avatar"/);
  assert.match(dashboard, /label: "Profile photo", section: "photos"/);
  assert.match(dashboard, /`Profile essentials: \$\{completedRequirements\}\/\$\{builderRequirements\.length\} complete`/);
  assert.doesNotMatch(dashboard, /label: "Videos", section: "videos"/);
  assert.doesNotMatch(dashboard, /label: "Socials", section: "socials"/);
});

test("completed compact editors do not report a false save failure after they unmount", () => {
  assert.match(dashboard, /if \(!detail\.tasks\.length\) return true;/);
  assert.doesNotMatch(dashboard, /Some changes could not be saved\. Check the highlighted section/);
  assert.match(dashboard, /A profile section could not be saved\. Reopen the section you changed and review its message\./);
});
