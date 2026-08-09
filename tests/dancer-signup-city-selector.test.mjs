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

test("available dancer signup cities come from active production venues", () => {
  assert.match(cityLibrary, /\.from\("venues"\)[\s\S]*?\.select\("city, state"\)[\s\S]*?\.eq\("is_active", true\)/);
  assert.match(cityLibrary, /new Map<string, DancerSignupCity>/);
  assert.match(cityLibrary, /cities\.values\(\)/);
  assert.match(cityRoute, /getDancerSignupCities\(createAdminSupabaseClient\(\)\)/);
  assert.match(cityRoute, /cache-control/);
});

test("dancer account creation and profile saves reject cities outside the live list", () => {
  assert.match(authRoute, /role === "dancer"[\s\S]*?requireDancerSignupCity\(createAdminSupabaseClient\(\), body\.city\)/);
  assert.match(profileRoute, /update\.city = await requireDancerSignupCity\(createAdminSupabaseClient\(\), body\.city\)/);
  assert.match(profileRoute, /error instanceof DancerSignupCityInputError\) throw new ProfileInputError\(error\.message\)/);
});

test("the live dancer signup and setup flows use the database city dropdown", () => {
  assert.match(liveShell, /<select id="dancerCity" required disabled>/);
  assert.doesNotMatch(liveShell, /<input id="dancerCity" type="hidden"/);
  assert.match(liveShell, /fetchJson\("\/api\/public\/cities"\)/);
  assert.match(liveShell, /function dancerSignupCityOptionsMarkup/);
  assert.match(liveShell, /<select id="setupCity" data-setup-profile-field="city" required/);
  assert.match(liveShell, /const confirmedCity = state\.dancerCity \|\| state\.city \|\| ""/);
  assert.match(liveShell, /Select an available city before creating your dancer account/);
});

test("the Next account and dashboard surfaces use the same production city source", () => {
  assert.match(accountClient, /fetch\("\/api\/public\/cities"/);
  assert.match(accountClient, /isDancerSignup \? \([\s\S]*?<select[\s\S]*?dancerSignupCities\.map/);
  assert.match(accountClient, /Cities are loaded from active MyDancr venue markets/);
  assert.match(dashboardClient, /fetch\("\/api\/public\/cities"/);
  assert.match(dashboardClient, /<select value=\{city\}[\s\S]*?cityOptions\.map/);
});
