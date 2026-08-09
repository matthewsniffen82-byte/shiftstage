import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  authRoute,
  authHelpers,
  venueSource,
  profileRoute,
  dashboardRoute,
  qrRoute,
  publicVenueSource,
  publicVenuePage,
  dancerPage,
  trackingComponent,
  migration,
  liveApp,
  dashboardClient,
  venuePreviewRoute,
  recoveryHelpers,
  accountClient,
  redeemClient,
] = await Promise.all([
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/qr-code/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/VenueQrCode.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607260002_venue_accounts_qr_analytics.sql", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/access-code/preview/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/account-recovery.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/redeem/[token]/RedeemDealClient.tsx", import.meta.url), "utf8"),
]);

test("venue signup redeems a private access code and routes successful authentication to its dashboard", () => {
  assert.match(authRoute, /venueCode: readRequired\(body\.venueCode, "Venue access code is required\."\)/);
  assert.match(authRoute, /if \(password\.length < 8\)/);
  assert.match(authRoute, /await resolveVenueSignupCode\(admin, input\.venueCode\)/);
  assert.match(authRoute, /await redeemVenueSignupCode\(admin, \{/);
  assert.match(authRoute, /email_confirm: true/);
  assert.match(authRoute, /admin\.auth\.admin\.deleteUser\(createdUserId\)/);
  assert.match(authRoute, /expectedRole === "venue" && account\?\.role === "venue"/);
  assert.match(authHelpers, /if \(role === "venue"\) return "\/dashboard\/venue"/);
  assert.match(liveApp, /id="venueLoginModeBtn"[^>]*>Sign in<\/button>/);
  assert.match(liveApp, /id="venueSignupModeBtn"[^>]*>Create account<\/button>/);
  assert.match(liveApp, /document\.getElementById\("venueCodeVerifyBtn"\)\.addEventListener\("click"/);
  assert.match(liveApp, /document\.getElementById\("venueLoginForm"\)\.addEventListener\("submit", async/);
  assert.match(liveApp, /async function submitVenueSignup\(button/);
  assert.match(liveApp, /if \(venueAuthMode === "signup"\) \{\s*await submitVenueSignup/);
  assert.match(liveApp, /id="venueSignupCode"[^>]*autocomplete="one-time-code"/);
  assert.match(liveApp, /venueCode: verifiedVenueSignupCode/);
  assert.doesNotMatch(liveApp, /id="venueLoginName"|id="venueLoginCity"/);
  assert.match(liveApp, /await startVenueDashboardSession\("Venue dashboard opened"\)/);
  assert.match(liveApp, /!result\.session\?\.accessToken \|\| result\.account\?\.role !== "venue"/);
  assert.match(liveApp, /async function openVenueDashboard\(\)[\s\S]*?if \(!isVenueSession\(\)\)[\s\S]*?window\.location\.href = "\/dashboard\/venue"/);
  assert.match(liveApp, /async function startVenueDashboardSession\(message[\s\S]*?const destination = pendingVenueAuthReturnTo \|\| "\/dashboard\/venue"[\s\S]*?window\.location\.href = destination/);
  assert.match(liveApp, /function handleVenueDashboardDeepLink\(\)[\s\S]*?params\.get\("dancr_dashboard"\) !== "venue"[\s\S]*?forceFreshSignIn[\s\S]*?saveAuthSession\(null\)[\s\S]*?openAuthRole\("venue"\)[\s\S]*?void openVenueDashboard\(\)/);
  assert.match(dashboardClient, /<VenueDashboardSignInRecovery onSignedIn=\{retryDashboard\} \/>/);
  assert.doesNotMatch(dashboardClient, /dancr_force_sign_in/);
  assert.doesNotMatch(liveApp, />Manage MyDancr TV</);
  assert.match(liveApp, /const opened = await openVenueDashboard\(\);\s*if \(opened\) \{/);
  assert.doesNotMatch(liveApp, /venue@example\.com|venue123|demo venue/i);
});

test("venue access verifies the assigned venue before account creation and preserves secure return routes", () => {
  assert.match(venuePreviewRoute, /eventType: "venue_access_preview"/);
  assert.match(venuePreviewRoute, /await resolveVenueSignupCode\(admin, code\)/);
  assert.match(venuePreviewRoute, /venue: \{[\s\S]*?id: access\.venue\.id[\s\S]*?name: access\.venue\.name/);
  assert.doesNotMatch(venuePreviewRoute, /code_digest|serviceRoleKey/);
  assert.match(recoveryHelpers, /input\.eventType === "venue_access_preview"[\s\S]*?ipLimit: 20, subjectLimit: 6/);
  assert.match(recoveryHelpers, /if \(input\.eventType === "venue_access_preview"\) \{[\s\S]*?await enforceCompatibilityRateLimit/);
  assert.match(liveApp, /fetch\("\/api\/venue\/access-code\/preview"/);
  assert.match(liveApp, /verifiedVenueSignupCode = code/);
  assert.match(liveApp, /function handleVenueAccessDeepLink\(\)/);
  assert.match(liveApp, /requestedReturnTo\.startsWith\("\/"\) && !requestedReturnTo\.startsWith\("\/\/"\)/);
  assert.match(accountClient, /requestedRole === "venue"/);
  assert.match(accountClient, /destination\.searchParams\.set\("venueAccess", "1"\)/);
  assert.match(redeemClient, /venueAccess=1&venueMode=login&return_to=/);
});

test("venue dashboard refreshes a saved session and recovers sign-in without leaving the page", () => {
  assert.match(dashboardClient, /const initialAuthHeaders = dashboardAuthHeaders\(session\)/);
  assert.match(dashboardClient, /const account = await readJson\("\/api\/account", initialAuthHeaders\)/);
  assert.match(dashboardClient, /const authHeaders = dashboardAuthHeaders\(readSession\(\)\)/);
  assert.match(dashboardClient, /"x-dancr-refresh-token": String\(session\.refreshToken\)/);
  assert.match(dashboardClient, /persistResponseSession\(data\);\s*return data;/);
  assert.match(dashboardClient, /!isLoading && !state\.error/);
  assert.match(dashboardClient, /function VenueDashboardSignInRecovery/);
  assert.match(dashboardClient, /fetch\("\/api\/auth", \{[\s\S]*?mode: "login", role: "venue"/);
  assert.match(dashboardClient, /window\.localStorage\.setItem\([\s\S]*?SESSION_KEY[\s\S]*?data\.session/);
  assert.doesNotMatch(dashboardClient, /href=.*dancr_dashboard=venue/);
});

test("all routed dashboards use one compact profile-style header and close control", () => {
  assert.match(
    dashboardClient,
    /const dashboardCloseHref = homeDiscoveryHref\([\s\S]*?role === "venue" \? "venues" : role === "dancer" \? "dancers" : "tonight"/,
  );
  assert.match(
    dashboardClient,
    /className=\{`dashboard-head dashboard-head-\$\{role\}`\}[\s\S]*?className="dashboard-head-row"[\s\S]*?className="dashboard-close"[\s\S]*?aria-label=\{`Close \$\{role\} dashboard and return to MyDancr`\}[\s\S]*?<svg/,
  );
  assert.doesNotMatch(dashboardClient, /<Link className="brand" href="\/">/);
  assert.doesNotMatch(dashboardClient, /className="nav-links"/);
  assert.match(dashboardClient, /\.dashboard-close \{ flex: 0 0 42px; width: 42px; height: 42px;/);
});

test("customer, dancer, and venue headers share the compact dashboard identity pattern", () => {
  assert.match(
    dashboardClient,
    /role === "customer" \? "Customer dashboard" : role === "venue" \? "Venue dashboard" : "Dancer dashboard"/,
  );
  assert.match(dashboardClient, /const dashboardHeading = isLoading \? title : displayName/);
  assert.match(dashboardClient, /const dashboardDescription = state\.error \|\| ""/);
  assert.doesNotMatch(dashboardClient, /Welcome back, \$\{displayName\}/);
  assert.match(
    dashboardClient,
    /\.dashboard-head \{ min-height: 72px;[\s\S]*?padding: 10px 12px 14px;[\s\S]*?border-radius: var\(--mydancr-dashboard-radius\);/,
  );
  assert.match(
    dashboardClient,
    /\.dashboard-head-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 42px;/,
  );
  assert.match(
    dashboardClient,
    /\.dashboard-head h1 \{[\s\S]*?font-size: clamp\(21px, 5vw, 26px\);[\s\S]*?text-overflow: ellipsis;/,
  );
});

test("venue management is consolidated into one descriptive collapsible workspace", () => {
  assert.match(dashboardClient, /function VenueDashboardSection\(/);
  assert.match(dashboardClient, /<details className="venue-dashboard-section"/);
  assert.match(dashboardClient, /id="venue-account"[\s\S]*?title="Account & support"/);
  assert.match(dashboardClient, /id="venue-overview"[\s\S]*?title="Overview"/);
  assert.match(dashboardClient, /id="venue-club-deals"[\s\S]*?title="Club Deals & tracked QR"/);
  assert.match(dashboardClient, /id="venue-dancer-roster"[\s\S]*?title="Dancer roster"/);
  assert.match(dashboardClient, /id="venue-tv"[\s\S]*?title="MyDancr TV"/);
  assert.match(dashboardClient, /id="venue-public-profile"[\s\S]*?title="Public venue profile"/);
  assert.match(dashboardClient, /id="venue-working-now"[\s\S]*?title="Working now"/);
  assert.doesNotMatch(dashboardClient, /venue-external-qr|External marketing QR|Untracked external QR/);
  assert.match(dashboardClient, /<VenueClubDealPanel[\s\S]*?hasWorkingNowDancers=\{workingNow\.length > 0\}[\s\S]*?initialDeal=\{deal\}[\s\S]*?initialDeals=\{venueDeals\}/);
  assert.match(dashboardClient, /"Share QR"/);
  assert.match(dashboardClient, /<VenueTvPanel \/>/);
});

test("venue offer button confirms only a successful database save", () => {
  const clubDealPanel = dashboardClient.match(
    /function VenueClubDealPanel[\s\S]*?function venueDealForm/,
  )?.[0] || "";

  assert.match(clubDealPanel, /const \[saveConfirmed, setSaveConfirmed\] = useState\(false\)/);
  assert.match(
    clubDealPanel,
    /if \(!response\.ok \|\| !data\.ok\)[\s\S]*?throw new Error[\s\S]*?setSaveConfirmed\(true\)/,
  );
  assert.match(
    clubDealPanel,
    /isSaving \? "Saving\.\.\." : saveConfirmed \? "Saved Changes" : form\.isActive \? "Save Changes" : "Publish Deal"/,
  );
  assert.match(clubDealPanel, /function updateDealForm[\s\S]*?setSaveConfirmed\(false\)/);
  assert.match(clubDealPanel, /aria-live="polite"[\s\S]*?disabled=\{isSaving\}[\s\S]*?name="dealAction"[\s\S]*?type="submit"/);
});

test("saved venue deals immediately synchronize dashboard cards, selection, and counts", () => {
  const clubDealPanel = dashboardClient.match(
    /function VenueClubDealPanel[\s\S]*?function venueDealForm/,
  )?.[0] || "";

  assert.match(
    dashboardClient,
    /function updateVenueDeals\(venueDeals[\s\S]*?primaryDeal[\s\S]*?setState\(\(current\) => \(\{ \.\.\.current, deal: primaryDeal, venueDeals \}\)\)/,
  );
  assert.match(dashboardClient, /<VenuePanel[\s\S]*?onDealsChange=\{updateVenueDeals\}/);
  assert.match(dashboardClient, /<VenueClubDealPanel[\s\S]*?onDealsChange=\{onDealsChange\}/);
  assert.match(
    clubDealPanel,
    /const nextDeals = Array\.isArray\(data\.deals\)[\s\S]*?data\.deals[\s\S]*?upsertVenueDeal\(deals, data\.deal\);[\s\S]*?const savedDeal = nextDeals\.find[\s\S]*?setDeals\(nextDeals\);\s*onDealsChange\(nextDeals\)/,
  );
  const incomingDealsEffect = clubDealPanel.match(
    /useEffect\(\(\) => \{[\s\S]*?const nextDeals = initialDeals\.length[\s\S]*?\}, \[initialDeal, initialDeals\]\);/,
  )?.[0] || "";
  assert.doesNotMatch(incomingDealsEffect, /setSaveConfirmed\(false\)/);
  assert.match(clubDealPanel, /Saved changes\. This deal and its QR are live on your venue page/);
  assert.match(
    clubDealPanel,
    /method: "DELETE"[\s\S]*?setDeals\(nextDeals\);\s*onDealsChange\(nextDeals\)/,
  );
  assert.match(clubDealPanel, /editingIdRef\.current = String\(savedDeal\.id\)/);
  assert.match(clubDealPanel, /setForm\(venueDealForm\(savedDeal\)\)/);
  assert.match(clubDealPanel, /const liveCount = deals\.filter\(\(deal\) => deal\.isActive === true\)\.length/);
  assert.match(clubDealPanel, /aria-pressed=\{String\(deal\.id\) === editingId\}[\s\S]*?className=\{String\(deal\.id\) === editingId \? "selected" : ""\}/);
  assert.match(clubDealPanel, /aria-pressed=\{!editingId\}[\s\S]*?className=\{`add\$\{!editingId \? " selected" : ""\}`\}/);
  assert.match(dashboardClient, /\.venue-deal-list > button\.selected \{[\s\S]*?var\(--dancr-color-beam-violet\)[\s\S]*?var\(--dancr-color-beam-violet-soft\)/);
});

test("venue deal publishing keeps the essential copy visible and collapses operational guidance", () => {
  assert.match(dashboardClient, /<h2>Post a Club Deal<\/h2>/);
  assert.match(dashboardClient, /Appears on your venue page and eligible working dancer profiles\./);
  assert.match(dashboardClient, />\s*Deal title\s*<input/);
  assert.match(dashboardClient, />\s*Offer details\s*<textarea/);
  assert.match(dashboardClient, />\s*Conditions \(optional\)\s*<textarea/);
  assert.match(dashboardClient, /saveConfirmed \? "Saved Changes" : form\.isActive \? "Save Changes" : "Publish Deal"/);
  assert.match(dashboardClient, /<details className="venue-deal-how">[\s\S]*?<summary>How Club Deals work<\/summary>/);
  assert.match(dashboardClient, /<h3 id="venue-deal-qr-heading">Deal QR<\/h3>/);
  assert.doesNotMatch(dashboardClient, /Tracked venue QR generator/);
});

test("venue deal publishing clearly confirms live placement without showing a dancer count", () => {
  const clubDealPanel = dashboardClient.match(
    /function VenueClubDealPanel[\s\S]*?function venueDealForm/,
  )?.[0] || "";

  assert.match(clubDealPanel, /const submitter = \(event\.nativeEvent as SubmitEvent\)\.submitter/);
  assert.match(clubDealPanel, /action === "publish" \? true : action === "draft" \|\| action === "unpublish" \? false : form\.isActive/);
  assert.match(clubDealPanel, /isActive: nextIsActive/);
  assert.match(clubDealPanel, /<strong>\{form\.isActive \? "Live on MyDancr" : "Draft — not live"\}<\/strong>/);
  assert.match(clubDealPanel, />Live on venue page</);
  assert.match(clubDealPanel, /Available on eligible Working Now dancer profiles/);
  assert.match(clubDealPanel, /Will appear automatically when an affiliated dancer is Working Now/);
  assert.match(clubDealPanel, />Venue QR active</);
  assert.doesNotMatch(clubDealPanel, /\{workingNow\.length\}[\s\S]*?dancer profiles/);
});

test("venue QR uses one share action with clear device, image, and link options", () => {
  const clubDealPanel = dashboardClient.match(
    /function VenueClubDealPanel[\s\S]*?function venueDealForm/,
  )?.[0] || "";

  assert.match(clubDealPanel, /onClick=\{openVenueQrShareOptions\}[\s\S]*?>[\s\S]*?"Share QR"/);
  assert.match(clubDealPanel, />Share from device<\/button>/);
  assert.match(clubDealPanel, />Save QR image<\/button>/);
  assert.match(clubDealPanel, />Copy deal link<\/button>/);
  assert.match(clubDealPanel, /if \(navigator\.share\)/);
  assert.doesNotMatch(clubDealPanel, />Generate tracked QR|>Download PNG|>Copy tracked link/);
});

test("venue dashboard APIs require an active venue account and scope writes by owner", () => {
  for (const source of [profileRoute, dashboardRoute, qrRoute]) {
    assert.match(source, /account\.role !== "venue"|account\.role === "venue"|account\.role !== "venue"/);
    assert.match(source, /account\.accountState !== "active"/);
  }
  assert.match(venueSource, /\.eq\("owner_user_id", userId\)/);
  assert.match(venueSource, /\.eq\("id", venue\.id\)\s*\.eq\("owner_user_id", userId\)/);
  assert.match(profileRoute, /updateVenueForAccount\(createAdminSupabaseClient\(\), user\.id/);
  assert.match(dashboardRoute, /getVenueDashboard\(createAdminSupabaseClient\(\), user\.id\)/);
});

test("uploaded venue QR images are isolated as external marketing assets and never used for commission attribution", () => {
  assert.match(venueSource, /validateAndPrepareDancrImage\(file\)/);
  assert.match(venueSource, /image\.width < 180 \|\| image\.height < 180/);
  assert.match(venueSource, /ratio < 0\.8 \|\| ratio > 1\.25/);
  assert.match(venueSource, /const QR_BUCKET = "venue-qr-codes"/);
  assert.match(venueSource, /qr_code_storage_path: storagePath/);
  assert.match(migration, /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
  assert.match(migration, /image\/jpeg.*image\/png.*image\/webp/s);
  assert.match(publicVenueSource, /qr_code_storage_path/);
  assert.match(publicVenuePage, /permanentRedirect/);
  assert.doesNotMatch(publicVenuePage, /<VenueQrCode/);
  assert.doesNotMatch(liveApp, /publishedVenueQrPass/);
  assert.match(liveApp, /function venueOfferMarkup\(venue\)[\s\S]*?venue\?\.activeDeal/);
  assert.match(liveApp, /data-feed-venue-qr/);
  assert.doesNotMatch(dancerPage, /activeShift\.venueQrCodeUrl|<VenueQrCode/);
  assert.match(dancerPage, /Boolean\(shift\.checkedInAt\)/);
  assert.match(dancerPage, /!shift\.checkedOutAt/);
  assert.match(dancerPage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\}/);
  assert.match(trackingComponent, /"Available when dancer is working"/);
  assert.doesNotMatch(trackingComponent, /No tracked Club Deal is active at this venue\.|venue-qr-explanation/);
  assert.match(trackingComponent, /if \(tapToShow && !visible\)/);
  assert.match(trackingComponent, /Show venue QR/);
  assert.match(trackingComponent, /className="venue-qr-dialog"/);
  assert.match(trackingComponent, /eventType: "qr_impression"/);
});

test("checked-in dancer profiles show only a tracked MyDancr Club Deal or an explicit unavailable state", () => {
  assert.match(liveApp, /function dancerClubDealState\(profile\)[\s\S]*?profile\?\.activeDeal\?\.id &&[\s\S]*?profile\?\.dealAttributionToken/);
  assert.match(liveApp, /if \(state\.key === "available"\)/);
  assert.match(liveApp, /label: "No Club Deal available"/);
  assert.match(
    liveApp,
    /profile-qr-unavailable[\s\S]*?profile-deal-main">\$\{escapeHtml\(unavailableLabel\)\}<\/span>[\s\S]*?profile-deal-placeholder/,
  );
  assert.match(liveApp, /Saving or sharing keeps your credit attached until that QR expires/);
  assert.doesNotMatch(liveApp, /profile\.venueQrCodeUrl[\s\S]*?data-deal-pass/);
});

test("venue analytics are real database counts and the dashboard exposes useful operating metrics", () => {
  assert.match(venueSource, /countByVenue\(client, "venue_follows"/);
  assert.match(venueSource, /countByVenueSince\(client, "direction_requests"/);
  assert.match(venueSource, /countVenueEvents\(client, profile\.id, "page_view"/);
  assert.match(venueSource, /countVenueEvents\(client, profile\.id, "qr_impression"/);
  assert.match(venueSource, /countUpcomingShifts\(client, profile\.id/);
  assert.match(venueSource, /countVenueGoingSignals\(client, profile\.id/);
  assert.match(venueSource, /getWorkingDancers\(client, profile\.id/);
  assert.match(venueSource, /\.not\("checked_in_at", "is", null\)/);
  assert.match(venueSource, /\.in\("location_status", \["location_confirmed", "club_confirmed"\]\)/);
  assert.match(liveApp, /id="venuePageViewCount"/);
  assert.match(liveApp, /id="venueQrImpressions"/);
  assert.match(liveApp, /id="venueDirectionCount"/);
  assert.match(liveApp, /id="venueFollowerCount"/);
  assert.match(liveApp, /id="venueWorkingNowList"/);
  assert.match(liveApp, /getAuthenticatedJson\("\/api\/venue\/dashboard"\)/);
  assert.doesNotMatch(liveApp, /\.example\.com|\\(555\\)/);
});
