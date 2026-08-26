import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, dancerStudio] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
]);

const identityEditor = dashboard.match(/function DancerSetupPanel\([\s\S]*?(?=\nfunction DancerAvatarPanel)/)?.[0] || "";
const avatarEditor = dashboard.match(/function DancerAvatarPanel\([\s\S]*?(?=\nfunction DancerVenueVerificationPanel)/)?.[0] || "";
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
  assert.match(avatarEditor, /Required · Choose a clear face photo\./);
  assert.match(avatarEditor, />Gallery<\/strong>/);
  assert.match(avatarEditor, />Camera<\/strong>/);
  assert.match(avatarEditor, /We&apos;ll center and check it automatically\./);
  assert.doesNotMatch(avatarEditor, /Profile identity|<h2>Avatar<\/h2>/i);
  assert.match(avatarEditor, /void uploadAvatar\(nextFile\)/);
  assert.match(avatarEditor, /requestDancerAvatarJson/);
});

test("photo editor shows actual media only and does not advertise capacity", () => {
  assert.match(photoEditor, /Add at least 1 picture\. You can add more later\./);
  assert.match(photoEditor, /Your photos/);
  assert.match(photoEditor, /photos\.map\(\(photo, photoIndex\)/);
  assert.doesNotMatch(photoEditor, /<h2>Photos<\/h2>|No profile photos uploaded yet|0\/50|\/\{MAX_DANCER_PROFILE_PHOTOS\}|up to 50|maximum 50/i);
  assert.match(photoEditor, /MAX_DANCER_PROFILE_PHOTOS - photos\.length/);
  assert.match(photoEditor, /photos\.length \+ batch\.length > MAX_DANCER_PROFILE_PHOTOS/);
  assert.match(photoEditor, /requestDancerPhotosJson/);
});

test("video editor keeps both permission gates and hides the technical library capacity", () => {
  assert.match(dancerStudio, /Optional · Add videos now or later\./);
  assert.match(dancerStudio, /Confirm permissions/);
  assert.match(dancerStudio, /I have permission from every identifiable person shown\./);
  assert.match(dancerStudio, /I own this video or have permission to publish every visual, recording, song, beat, and other audio it contains\./);
  assert.match(dancerStudio, /checked=\{consentConfirmed\}/);
  assert.match(dancerStudio, /checked=\{rightsConfirmed\}/);
  assert.match(dancerStudio, /Vertical or square · MP4, WebM, or MOV · 1–30 sec · 75 MB max/);
  assert.doesNotMatch(dancerStudio, /0\/50|\{currentVideoCount\}\/\{maxVideos\}|up to 50|maximum 50/i);
  assert.match(dancerStudio, /currentVideoCount >= maxVideos/);
  assert.match(dancerStudio, /const selectedFiles = files\.slice\(0, availableSlots\)/);
});

test("the three-item counter remains the authoritative profile essentials counter", () => {
  assert.match(dashboard, /label: "Stage name & city", section: "identity"/);
  assert.match(dashboard, /label: "Avatar", section: "avatar"/);
  assert.match(dashboard, /label: "Profile photo", section: "photos"/);
  assert.match(dashboard, /`Profile essentials: \$\{completedRequirements\}\/\$\{builderRequirements\.length\} complete`/);
  assert.doesNotMatch(dashboard, /label: "Videos", section: "videos"/);
  assert.doesNotMatch(dashboard, /label: "Socials", section: "socials"/);
});
