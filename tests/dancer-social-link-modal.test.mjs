import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, dancrTypes] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/types.ts", import.meta.url), "utf8"),
]);

const modal = dashboard.match(/function SocialLinkModal\([\s\S]*?(?=\nconst SOCIAL_PLATFORMS:)/)?.[0] || "";
const platformConfiguration = dashboard.match(/const SOCIAL_PLATFORMS:[\s\S]*?\n\];/)?.[0] || "";

test("all supported dancer socials share one platform-configured modal", () => {
  assert.equal((dashboard.match(/function SocialLinkModal\(/g) || []).length, 1);
  assert.equal((dashboard.match(/<SocialLinkModal/g) || []).length, 1);
  assert.doesNotMatch(dashboard, /function (?:Instagram|TikTok|Snapchat|OnlyFans|X)Social/);
  assert.doesNotMatch(dashboard, /DancerSocialPanel/);

  for (const [key, label] of [
    ["instagram", "Instagram"],
    ["tiktok", "TikTok"],
    ["snapchat", "Snapchat"],
    ["x", "X"],
    ["onlyfans", "OnlyFans"],
  ]) {
    assert.match(platformConfiguration, new RegExp(`key: "${key}", label: "${label}"`));
    assert.match(dancrTypes, new RegExp(`(?:\\||=) "${key}"`));
  }
  assert.match(modal, /<SocialPlatformIcon platform=\{selectedPlatform\.key\} \/>/);
  assert.match(modal, /\{hasExistingLink \? "Edit" : "Add"\} \{selectedPlatform\.label\}/);
});

test("the compact modal exposes explicit add, edit, remove, and dismissal behavior", () => {
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="dancer-social-link-modal-heading"/);
  assert.match(modal, /aria-label=\{`Close \$\{selectedPlatform\.label\} social link editor`\}/);
  assert.match(modal, /Profile link or username/);
  assert.match(modal, /placeholder=\{selectedPlatform\.placeholder\}/);
  assert.match(modal, /hasExistingLink \? "Save changes" : "Save"/);
  assert.match(modal, /\{hasExistingLink \? \([\s\S]*?Remove link[\s\S]*?\) : null\}/);
  assert.doesNotMatch(modal, /Not added|Save Instagram|Save TikTok|Save Snapchat|Save OnlyFans|Save X/);
  assert.match(modal, /discardSelectedDraftAndClose[\s\S]*?\[selectedPlatform\.key\]: persistedValue/);
});

test("the modal preserves the existing persistence and normalization pipeline", () => {
  assert.match(modal, /requestDancerProfileJson\(\{[\s\S]*?method: "PATCH"/);
  assert.match(modal, /handle: toSocialHandle\(value\)/);
  assert.match(modal, /url: toSocialUrl\(platform\.key, value\)/);
  assert.match(modal, /isActive: Boolean\(value\)/);
  assert.match(modal, /if \(savePendingRef\.current\) return false/);
  assert.match(modal, /savePendingRef\.current = true/);
  assert.match(modal, /const saved = await saveSocials\(undefined, nextSocials\)/);
  assert.match(modal, /if \(data\.profile\) onProfileChange\?\.\(data\.profile\)/);
});

test("the social editor is compact, keyboard reachable, and isolated from the background", () => {
  assert.match(dashboard, /\.dancer-social-link-modal-backdrop \{[^}]*position:fixed;[^}]*inset:0;[^}]*background:rgba\(0,0,0,\.66\)/);
  assert.match(dashboard, /\.dancer-profile-builder-panel\.dancer-social-link-modal \{[^}]*max-height:min\(72dvh,440px\)/);
  assert.match(dashboard, /\.dancer-profile-builder-panel\.dancer-social-link-modal \{ inset:auto;[^}]*max-height:min\(58dvh,360px/);
  assert.match(dashboard, /activeEditorSection === "socials" && activeSocialPlatform[\s\S]*?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dashboard, /activeEditorSectionRef\.current === "socials"[\s\S]*?document\.getElementById\("dancer-profile-builder-panel"\)/);
  assert.match(modal, /autoCapitalize="none"/);
  assert.match(modal, /autoComplete="url"/);
  assert.match(modal, /inputMode="url"/);
});

test("the three profile requirements remain unchanged and are labeled clearly", () => {
  assert.match(dashboard, /label: "Stage name & city", section: "identity"/);
  assert.match(dashboard, /label: "Avatar", section: "avatar"/);
  assert.match(dashboard, /label: "Profile photo", section: "photos"/);
  assert.match(dashboard, /Profile essentials: \$\{completedRequirements\}\/\$\{builderRequirements\.length\} complete/);
  assert.match(dashboard, /Optional\. You can add videos now or later\./);
  assert.match(dashboard, /Optional\. Add whichever profiles you want, or skip this for now\./);
});
