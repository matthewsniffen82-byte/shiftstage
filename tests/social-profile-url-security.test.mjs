import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  safeHttpUrl,
  safeSocialProfileUrl,
  socialProfileHandle,
} from "../src/lib/dancr/social-profile-url.ts";

test("general external URL validation rejects executable schemes and embedded credentials", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("vbscript:msgbox(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safeHttpUrl("https://user:secret@example.com/path"), null);
  assert.equal(safeHttpUrl("https://example.com/path"), "https://example.com/path");
});

test("social usernames and matching platform URLs normalize to canonical HTTPS profiles", () => {
  assert.equal(safeSocialProfileUrl("instagram", "@dancr.demo"), "https://instagram.com/dancr.demo");
  assert.equal(safeSocialProfileUrl("tiktok", "https://www.tiktok.com/@dancr_demo/video/123"), "https://tiktok.com/@dancr_demo");
  assert.equal(safeSocialProfileUrl("snapchat", "http://snapchat.com/add/dancr-demo?share_id=1"), "https://snapchat.com/add/dancr-demo");
  assert.equal(safeSocialProfileUrl("x", "https://mobile.twitter.com/dancr_demo/status/123"), "https://x.com/dancr_demo");
  assert.equal(safeSocialProfileUrl("onlyfans", "dancr_demo"), "https://onlyfans.com/dancr_demo");
  assert.equal(socialProfileHandle("tiktok", "https://tiktok.com/@dancr_demo"), "dancr_demo");
});

test("social URL validation rejects dangerous, unrelated, and lookalike destinations", () => {
  for (const value of [
    "javascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,hello",
    "https://example.com/dancr",
    "https://instagram.com.evil.example/dancr",
    "https://attacker@instagram.com/dancr",
    "https://instagram.com:8443/dancr",
    "https://instagram.com/",
    "https://instagram.com/%2F%2Fevil.example",
  ]) {
    assert.equal(safeSocialProfileUrl("instagram", value), null, value);
  }
  assert.equal(safeSocialProfileUrl("instagram", "https://tiktok.com/@dancr"), null);
  assert.equal(safeSocialProfileUrl("unknown", "https://instagram.com/dancr"), null);
});

test("profile writes validate social destinations server-side and API/public responses revalidate legacy rows", async () => {
  const [route, publicData] = await Promise.all([
    readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /normalizeSubmittedSocial\(profile\.id, social\)/);
  assert.match(route, /safeSocialProfileUrl\(platform, submittedValue\)/);
  assert.match(route, /throw new ProfileInputError\(`\$\{socialPlatformLabel\(platform\)\} must be a valid profile link or username\.`\)/);
  assert.match(route, /profileWithoutBio\.social_links = profileWithoutBio\.social_links\.map/);
  assert.match(route, /: \{ \.\.\.link, handle: "", url: "", is_active: false \}/);
  assert.match(publicData, /flatMap\(safePublicSocialLink\)/);
});
