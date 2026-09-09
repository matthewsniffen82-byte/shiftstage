// Rendering/chunk-loading regression check with synthetic private responses.
// No credentials or production account writes are used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/dashboard-smoke";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const role of ["customer", "dancer", "venue"]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const account = { id: `performance-lab-${role}`, role, displayName: "Performance lab", email: "performance@example.invalid", accountState: "active" };
    const profile = { id: `lab-${role}`, slug: "performance-lab", stage_name: "Performance lab", name: "Performance lab", city: "Las Vegas", status: "approved", verification_status: "approved", is_public: true, dancer_photos: [], social_links: [] };
    const access = { role: "owner", permissions: ["view_team", "manage_team", "manage_roster", "request_support"] };
    const reads = [], chunks = [], errors = [], failures = [];
    await context.route("**/api/**", route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.fulfill({ json: { ok: true } });
      reads.push(path);
      return route.fulfill({ json: {
        ok: true, account, profile, access, venueAccess: access, request: null,
        saved: { follows: [], venueFollows: [], dealSaves: [], goingSignals: [], favorites: [], dealRedemptions: [] },
        notifications: [], threads: [], affiliations: [], members: [], activity: [], invitations: [],
        videos: [], photos: [], shifts: [], venues: [], cities: [], reviews: [], events: [],
        profileEligible: true, profileVisible: true, maxVideos: 6, remainingVideoSlots: 6,
      } });
    });
    await context.addInitScript(account => {
      localStorage.setItem("dancrAgeVerified", "true");
      localStorage.setItem("dancrAuthSessionV1", JSON.stringify({ account, accessToken: "performance-lab-access", refreshToken: "performance-lab-refresh", expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
    }, account);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      const path = new URL(response.url()).pathname;
      if (path.endsWith(".js")) { chunks.push(path); if (!response.ok()) failures.push({ path, status: response.status() }); }
    });
    await page.goto(`${base}/dashboard/${role}`, { waitUntil: "load" });
    await page.locator(`.${role}-dashboard-grid`).waitFor({ state: "visible" });
    const open = async id => {
      const section = page.locator(`#${id}`);
      if (!(await section.getAttribute("open")) && !(await section.evaluate(el => el.open))) await section.locator(":scope > summary").click();
    };
    if (role === "customer") {
      await open("customer-account");
      await page.getByRole("button", { name: "Change email", exact: true }).waitFor({ state: "visible" });
      assert.ok(!reads.some(path => /\/api\/(dancer|venue)\//.test(path)), "customer must not initialize other roles' tools");
    } else if (role === "dancer") {
      await open("dancer-schedule");
      await page.locator("#dancer-schedule form").first().waitFor({ state: "visible" });
      await open("dancer-profile-media");
      await page.getByRole("button", { name: "Edit profile", exact: true }).click();
      await page.getByRole("dialog").first().waitFor({ state: "visible" });
      await page.locator('[data-profile-editor-trigger="videos"]').first().click();
      await page.locator('input[type="file"][accept*="video"]').first().waitFor({ state: "attached" });
    } else {
      await page.locator("#venue-workspace-venue-tab").click();
      await page.locator("#venue-tv-heading").waitFor({ state: "visible" });
      await page.locator("#venue-workspace-business-tab").click();
      await open("venue-team");
      await page.locator("#venue-team form").first().waitFor({ state: "visible" });
    }
    await page.screenshot({ path: `${output}/${role}.png`, fullPage: true });
    assert.deepEqual(errors, [], `${role} JavaScript errors`);
    assert.deepEqual(failures, [], `${role} failed chunks`);
    results.push({ role, syntheticPrivateData: true, reads: [...new Set(reads)], chunks: [...new Set(chunks)], errors, failures });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ base, results }, null, 2));
}
console.log(JSON.stringify(results.map(({ role, chunks }) => ({ role, chunks: chunks.length, passed: true }))));
