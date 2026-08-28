import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  photoRouteSource,
  socialRouteSource,
  adminLibrarySource,
  adminDashboardSource,
  liveAppSource,
] = await Promise.all([
  readFile(new URL("../app/api/admin/dancers/[id]/photos/[photoId]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/dancers/[id]/social-links/[socialId]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Expected ${start} before ${end}`);
  return source.slice(startIndex, endIndex);
}

test("admin photo and social deletion routes require an active admin and exact UUIDs", () => {
  for (const source of [photoRouteSource, socialRouteSource]) {
    assert.match(source, /const UUID_PATTERN/);
    assert.match(source, /const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/);
    assert.match(source, /await requireAdmin\(client, user\.id\)/);
    assert.match(source, /createAdminSupabaseClient\(\)/);
    assert.match(source, /export async function DELETE/);
    assert.match(source, /getAdminDancerDetail\(admin, id\)/);
    assert.match(source, /NextResponse\.json\(\{ ok: true, deleted, profile, session: session \|\| null \}\)/);
  }
});

test("photo deletion is dancer-scoped, removes stored content, promotes a replacement, and is audited", () => {
  const deletion =
    adminLibrarySource.match(/export async function deleteAdminDancerPhoto[\s\S]*?export async function deleteAdminDancerSocialLink/)?.[0] || "";

  assert.match(deletion, /\.from\("dancer_photos"\)[\s\S]*?\.eq\("id", input\.targetId\)[\s\S]*?\.eq\("dancer_id", input\.dancerId\)/);
  assert.match(deletion, /\.from\("dancer_photos"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id", photo\.id\)[\s\S]*?\.eq\("dancer_id", input\.dancerId\)/);
  assert.match(deletion, /contentReviewType\("photo", photo\.id\)/);
  assert.match(deletion, /\.from\("image_moderation_records"\)/);
  assert.match(deletion, /\.update\(\{ is_primary: true \}\)/);
  assert.match(
    deletion,
    /removeBucketPaths\([\s\S]*?responsiveImageStoragePaths\(photo\.storage_path\)[\s\S]*?warnings/,
  );
  assert.match(deletion, /action: "delete_dancer_photo"/);
});

test("social-link deletion is dancer-scoped, cleans its review state, and is audited", () => {
  const deletion =
    adminLibrarySource.match(/export async function deleteAdminDancerSocialLink[\s\S]*?async function selectApprovalRows/)?.[0] || "";

  assert.match(deletion, /\.from\("social_links"\)[\s\S]*?\.eq\("id", input\.targetId\)[\s\S]*?\.eq\("dancer_id", input\.dancerId\)/);
  assert.match(deletion, /\.from\("social_links"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id", social\.id\)[\s\S]*?\.eq\("dancer_id", input\.dancerId\)/);
  assert.match(deletion, /contentReviewType\("social_link", social\.id\)/);
  assert.match(deletion, /action: "delete_dancer_social_link"/);
});

test("every React admin dancer list exposes a full-profile link and content management", () => {
  const approvalQueue = sourceBetween(adminDashboardSource, "function ApprovalQueue", "type AdminPreview");
  const directory = sourceBetween(adminDashboardSource, "function DancerDirectory", "function AdminDancerFullProfile");
  const fullProfile = sourceBetween(adminDashboardSource, "function AdminDancerFullProfile", "function withReviewedSocial");

  assert.match(approvalQueue, /admin-profile-name-link/);
  assert.match(approvalQueue, /View full profile/);
  assert.match(approvalQueue, /requestAdminDancerProfile/);
  assert.match(approvalQueue, /\{items\.map\(\(item\) =>/);
  assert.doesNotMatch(approvalQueue, /items\.slice\(/);
  assert.match(directory, /dancer-directory-profile-link/);
  assert.match(directory, /View full profile/);
  assert.match(fullProfile, /Delete picture/);
  assert.match(fullProfile, /Delete social link/);
  assert.match(adminDashboardSource, /requestAdminDancerContentDeletion/);
  assert.match(adminDashboardSource, /requestAdminDancerProfile\(dancerId: string, signal\?: AbortSignal\)/);
  assert.match(adminDashboardSource, /targetId: string,[\s\S]*?signal\?: AbortSignal/);
  assert.match(adminDashboardSource, /requestAdminJson\([\s\S]*?method: "DELETE"/);
  assert.match(adminDashboardSource, /method: "DELETE"/);
});

test("the live Admin dashboard links every approval directory and manages content in the full profile", () => {
  assert.match(liveAppSource, /function adminProfileRow[\s\S]*?data-admin-action="view-dancer-profile"/);
  assert.match(liveAppSource, /function adminDirectoryDancerRow[\s\S]*?data-admin-action="view-dancer-profile"/);
  assert.match(liveAppSource, /function adminDancerApprovalCard[\s\S]*?Open \$\{displayText\(profile\.name/);
  assert.match(liveAppSource, /data-admin-delete-photo=/);
  assert.match(liveAppSource, /data-admin-delete-social=/);
  assert.match(liveAppSource, /function deleteLiveAdminDancerContent/);
  assert.match(liveAppSource, /\/photos\/\$\{encodeURIComponent\(targetId\)\}|resource = contentType === "photo" \? "photos" : "social-links"/);
  assert.match(liveAppSource, /adminPreviewBody\.innerHTML = adminFullProfileMarkup\(data\.profile\)/);
  assert.match(liveAppSource, /await loadLiveAdminApprovals\(\)/);
});

test("the updated live Admin shell remains valid JavaScript", () => {
  const scripts = [...liveAppSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  assert.ok(scripts.length > 0, "Expected executable scripts in the live shell");
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});
