import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [cityLibrary, cityRoute, authRoute, profileRoute, accountClient, dashboardClient, liveShell] = await Promise.all([
  readFile(new URL("../src/lib/dancr/signup-cities.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/cities/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("available dancer onboarding cities come from active production venues", () => {
  assert.match(cityLibrary, /\.from\("venues"\)[\s\S]*?\.select\("city, state"\)[\s\S]*?\.eq\("is_active", true\)/);
  assert.match(cityLibrary, /new Map<string, DancerSignupCity>/);
  assert.match(cityLibrary, /cities\.values\(\)/);
  assert.match(cityRoute, /getDancerDiscoveryCities\(createAdminSupabaseClient\(\)\)/);
  assert.match(cityRoute, /cache-control/);
});

test("the public city list adds dynamic dancer and active-club counts without changing signup validation", () => {
  assert.match(cityLibrary, /export async function getDancerDiscoveryCities/);
  assert.match(cityLibrary, /\.from\("dancer_profiles"\)[\s\S]*?\.eq\("status", "approved"\)[\s\S]*?\.eq\("verification_status", "approved"\)[\s\S]*?\.eq\("is_public", true\)[\s\S]*?\.is\("disabled_at", null\)/);
  assert.match(cityLibrary, /venueCount: venueRows\.filter/);
  assert.match(cityLibrary, /dancerCount: dancerCounts\.get/);
  assert.match(cityLibrary, /DANCER_DISCOVERY_CITY_STATS_LOAD_FAILED/);
  assert.match(cityLibrary, /export async function getDancerSignupCities[\s\S]*?getActiveVenueCityRows\(client\)/);
});

test("dancer account creation defers city selection while profile saves validate it", () => {
  assert.match(authRoute, /const city = role === "dancer" \? "" : readOptional\(body\.city\) \|\| "Las Vegas"/);
  assert.doesNotMatch(authRoute, /requireDancerSignupCity/);
  assert.match(profileRoute, /update\.city = await requireDancerSignupCity\(createAdminSupabaseClient\(\), body\.city\)/);
  assert.match(profileRoute, /error instanceof DancerSignupCityInputError\) throw new ProfileInputError\(error\.message\)/);
});

test("the live shell keeps city out of signup and presents it during onboarding", () => {
  assert.match(liveShell, /<input id="dancerCity" type="hidden" value="">/);
  assert.doesNotMatch(liveShell, /<select id="dancerCity"/);
  assert.match(liveShell, /fetchJson\("\/api\/public\/cities"\)/);
  assert.match(liveShell, /function dancerSignupCityOptionsMarkup/);
  assert.match(liveShell, /<select id="setupCity" data-setup-profile-field="city" required/);
  assert.match(liveShell, /const confirmedCity = state\.dancerCity \|\| ""/);
  assert.doesNotMatch(liveShell, /Select an available city before creating your dancer account/);
  assert.match(liveShell, /password: document\.getElementById\("dancerPassword"\)\.value,\s*emailRedirectTo: saveAuthResume\("dancer"\)/);
});

test("the Next account defers city to the dashboard onboarding selector", () => {
  assert.doesNotMatch(accountClient, /fetch\("\/api\/public\/cities"|dancerSignupCities|dancer-signup-city-note/);
  assert.match(accountClient, /choose your city during onboarding/);
  assert.match(accountClient, /if \(mode === "signup" && role === "customer"\) payload\.city = city/);
  assert.match(dashboardClient, /fetch\("\/api\/public\/cities"/);
  assert.match(dashboardClient, /<select value=\{city\}[\s\S]*?cityOptions\.map/);
  assert.match(dashboardClient, /Choose from active MyDancr venue markets\./);
});
