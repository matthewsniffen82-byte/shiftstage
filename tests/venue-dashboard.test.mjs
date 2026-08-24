import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [accountClient, authRoute, dashboardPage, dashboard, dashboardSession, venueDealRoute, nfcTagRoute, nfcPanel, nfcService, adminNfcRoute, adminNfcPanel, nfcProvisioningMigration, retiredVenueQr, retiredDealQr, venueDashboardRoute, liveApp] = await Promise.all([
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/venue/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dashboard-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminNfcInventoryPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090005_admin_nfc_provisioning.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/qr-code/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/qr/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("venue signup remains code-gated and connects exactly the venue assigned to that code", () => {
  assert.match(accountClient, /isVenueAccessRedirect/);
  assert.match(accountClient, /venueAccess/);
  assert.match(liveApp, /Private venue access code/);
  assert.match(liveApp, /Verify access code/);
  assert.match(authRoute, /resolveVenueSignupCode/);
  assert.match(authRoute, /redeemVenueSignupCode/);
  assert.match(authRoute, /venue_access_invitation: true/);
  assert.match(authRoute, /No venue is connected to this account/);
});

test("venue dashboard session recovery rotates and persists authentication without a forced logout", () => {
  assert.match(dashboardSession, /x-dancr-refresh-token/);
  assert.match(dashboardSession, /persistResponseSession/);
  assert.match(nfcTagRoute, /session: authContext\.session \|\| null/);
  assert.match(dashboardSession, /function requestVenueNfcTagsJson/);
  assert.match(nfcPanel, /requestVenueNfcTagsJson/);
  assert.doesNotMatch(nfcPanel, /persistRefreshedSession|persistRefreshedDashboardSession|dancrAuthSessionV1/);
});

test("the routed venue dashboard is isolated, closable, and restores the original full workspace identity", () => {
  assert.match(dashboardPage, /DashboardClient/);
  assert.match(dashboard, /dashboard-shell/);
  assert.match(dashboard, /<DashboardCloseButton/);
  assert.match(dashboard, /label={`Close \$\{role\} dashboard and return to MyDancr`}/);
  assert.match(dashboard, /Venue dashboard/);
  assert.match(dashboard, /role === "venue" \? "Venue dashboard"/);
  assert.match(dashboard, /Loading \{role\} dashboard/);
  assert.match(dashboard, /\.dashboard-head h1 \{[^}]*?font-size: clamp\(21px, 5vw, 26px\)/);
  assert.doesNotMatch(dashboardPage, /Now[\s\S]*Dancers[\s\S]*Trending/);
});

test("the primary venue dashboard opens the shared routed workspace immediately", () => {
  const openUnifiedDashboard =
    liveApp.match(/function openUnifiedDashboard\([\s\S]*?^    \}/m)?.[0] || "";
  const startVenueSession =
    liveApp.match(/async function startVenueDashboardSession[\s\S]*?^    \}/m)?.[0] || "";

  assert.match(openUnifiedDashboard, /window\.location\.assign\(`\/dashboard\/\$\{dashboardRole\}\$\{sectionHash\}`\)/);
  assert.match(startVenueSession, /const opened = openUnifiedDashboard\("venue"\)/);
  assert.doesNotMatch(startVenueSession, /openVenueDashboard\(\)/);
});

test("venue operations prioritize tonight, Club Deals, NFC stickers, and then reporting", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /Tonight/);
  assert.match(venuePanel, /title="Deals & billing"/);
  assert.match(venuePanel, /VenueNfcTagPanel/);
  assert.match(venuePanel, /Analytics & performance/);
  assert.ok(venuePanel.indexOf("Tonight") < venuePanel.indexOf("Analytics & performance"));
});

test("venue owners navigate one simplified state-aware workspace without losing any controls", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /role="tablist"[\s\S]*?\["tonight", "Tonight"[\s\S]*?\["venue", "Venue page"[\s\S]*?\["business", "Business"/);
  assert.match(venuePanel, /function moveVenueWorkspaceFocus[\s\S]*?"ArrowLeft"[\s\S]*?"ArrowRight"[\s\S]*?"Home"[\s\S]*?"End"/);
  assert.match(dashboard, /function initialVenueWorkspace[\s\S]*?return isPublished \? "tonight" : "venue";/);
  assert.match(dashboard, /function venueWorkspaceForSection[\s\S]*?"venue-working-now"[\s\S]*?"venue-public-profile"[\s\S]*?"venue-overview"/);
  assert.match(venuePanel, /hidden=\{activeWorkspace !== "tonight"\}[\s\S]*?title="Working now"/);
  assert.match(venuePanel, /hidden=\{activeWorkspace !== "venue"\}[\s\S]*?title="Public venue profile"/);
  assert.match(venuePanel, /hidden=\{activeWorkspace !== "business"\}[\s\S]*?title="Analytics & performance"/);
  assert.match(venuePanel, /title="Account & support"/);
  assert.doesNotMatch(venuePanel, /venue-dashboard-shortcuts/);
});

test("working-now actions are neutral when empty and emerald only for a live roster", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /venue-working-now-link\$\{workingNow\.length \? " is-live" : ""\}/);
  assert.match(venuePanel, /Open working-now roster/);
  assert.match(venuePanel, /View \$\{workingNow\.length\} working now/);
  assert.match(dashboard, /\.venue-command-primary \.venue-working-now-link\.is-live \{[^}]*rgba\(16,185,129/);
  assert.doesNotMatch(dashboard, /venue-dashboard-shortcuts/);
  assert.doesNotMatch(venuePanel, /className="is-primary"/);
});

test("venue Club Deals are read-only and venue write routes enforce the contract boundary", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /<VenueDealReadOnlyPanel/);
  assert.doesNotMatch(venuePanel, /<VenueClubDealPanel/);
  assert.match(venueDealRoute, /MYDANCR_MANAGED_DEAL_MESSAGE/);
  assert.equal((venueDealRoute.match(/status: 403/g) || []).length, 2);
  assert.doesNotMatch(venueDealRoute, /updateVenueDealForAccount|deleteVenueDealForAccount/);
});

test("venue dashboards expose the complete MyDancr-managed contract ledger", () => {
  const venueDealPanel = dashboard.match(/function VenueDealReadOnlyPanel\([\s\S]*?(?=\nfunction readOptionalNumber)/)?.[0] || "";
  assert.match(venueDealPanel, /MyDancr managed/);
  assert.match(venueDealPanel, /Your Club Deals/);
  assert.match(venueDealPanel, /MyDancr publishes deals based on your venue agreement/);
  assert.match(venueDealPanel, /Fee per confirmed guest/);
  assert.match(venueDealPanel, /Agreement ID/);
  assert.match(venueDealPanel, /Redemption status/);
  assert.match(venueDealPanel, /deals\.map/);
  assert.match(venueDealPanel, /Guest terms/);
  assert.match(venueDealPanel, /Fee per guest/);
  assert.doesNotMatch(venueDealPanel, /Display order/);
  assert.match(venueDealPanel, /Agreement history/);
  assert.match(venueDealPanel, /Monthly activity & billing/);
  assert.match(venueDealPanel, /Confirmed redemptions/);
  assert.match(venueDealPanel, /Amount due/);
  assert.doesNotMatch(venueDealPanel, /Redemption intents|Saved \/ opened/);
  assert.match(venueDealPanel, /VenueFinanceSummary/);
  assert.doesNotMatch(venueDealPanel, /Publish Club Deal|Pause Deal|Request fee change|Edit live deal/);
});

test("venue publication requirements point to the read-only MyDancr deal record", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /label: "MyDancr Club Deal"/);
  assert.match(venuePanel, /targetId: "venue-deal-contract-ledger"/);
  assert.match(venuePanel, /View your MyDancr-managed deals, agreed fees, and monthly activity/);
});

test("MyDancr supplies NFC stickers while venue owners receive read-only inventory", () => {
  assert.match(nfcTagRoute, /requireActiveVenueAccount/);
  assert.match(nfcTagRoute, /MyDancr supplies and programs venue NFC stickers/);
  assert.match(nfcTagRoute, /Only MyDancr can activate, disable, or replace/);
  assert.doesNotMatch(nfcTagRoute, /createVenueNfcTag/);
  assert.doesNotMatch(nfcTagRoute, /rotateVenueNfcTag/);
  assert.match(nfcService, /requireVenueAccess\(client, ownerUserId, "view_nfc"\)/);
  assert.match(nfcService, /recordNfcTagScan/);
  assert.match(nfcPanel, /scanCount > testBaselineRef\.current/);
  assert.match(nfcPanel, /physical[\s\S]*?completed/);
  assert.match(nfcPanel, /MyDancr supplied hardware/);
  assert.match(nfcPanel, /Assigned NFC stickers/);
  assert.match(nfcPanel, /NFC-authorized dancer roster/);
  assert.match(nfcPanel, /no separate manager approval is needed/i);
  assert.doesNotMatch(nfcPanel, /Create programming URL/);
  assert.doesNotMatch(nfcPanel, />Rotate</);
});

test("venue roster rows pair each dancer avatar with compact confirmed access removal", () => {
  assert.match(nfcPanel, /className="venue-nfc-dancer-identity"/);
  assert.match(nfcPanel, /affiliation\.dancer\?\.avatarUrl/);
  assert.match(nfcPanel, /data-dancer-avatar=""[\s\S]*?data-dancer-avatar-border=""/);
  assert.match(nfcPanel, /srcSet=\{affiliation\.dancer\.avatarSrcSet \|\| undefined\}/);
  assert.match(nfcPanel, /className="venue-nfc-remove-access"/);
  assert.match(nfcPanel, /window\.confirm\(`Remove \$\{dancerName\}/);
  assert.match(nfcPanel, /\.venue-nfc-dancer\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.doesNotMatch(nfcPanel, /\.venue-nfc-dancer\{[^}]*flex-direction:column/);
});

test("authenticated MyDancr admins provision, disable, and replace physical NFC inventory", () => {
  assert.match(adminNfcRoute, /requireAdmin/);
  assert.match(adminNfcRoute, /createAdminVenueNfcTag/);
  assert.match(adminNfcRoute, /rotateAdminVenueNfcTag/);
  assert.match(adminNfcRoute, /setAdminVenueNfcTagStatus/);
  assert.match(adminNfcPanel, /Assign sticker/);
  assert.match(adminNfcPanel, /Shown once — program the physical sticker now/);
  assert.match(adminNfcPanel, /Do not send this URL to venue staff/);
  assert.match(nfcProvisioningMigration, /rotate_admin_venue_nfc_tag/);
  assert.match(nfcProvisioningMigration, /account\.role = 'admin'/);
});

test("legacy venue and deal QR write APIs return an explicit permanent replacement", () => {
  assert.match(retiredVenueQr, /status: 410/);
  assert.match(retiredVenueQr, /\/api\/venue\/nfc-tags/);
  assert.match(retiredDealQr, /status: 410/);
  assert.match(retiredDealQr, /cashier NFC stickers/);
});

test("venue dashboard data remains authenticated, owner-scoped, and backed by real analytics", () => {
  assert.match(venueDashboardRoute, /createRequestSupabaseContext/);
  assert.match(venueDashboardRoute, /requireActiveVenueAccount/);
  assert.match(venueDashboardRoute, /getVenueDashboard/);
  assert.match(dashboard, /analytics/);
  assert.match(dashboard, /Working now/);
});

test("the compatibility live shell exposes dressing-room NFC and keeps venue QR uploads retired", () => {
  assert.match(liveApp, /dressing-room sticker authorizes dancer venue access/i);
  assert.match(liveApp, /View assigned NFC stickers/);
  assert.match(liveApp, /id="venueQrForm" hidden/);
});
