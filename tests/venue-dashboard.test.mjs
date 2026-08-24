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
  assert.match(nfcPanel, /persistRefreshedSession\(tagData\.session\)/);
  assert.match(nfcPanel, /persistRefreshedDashboardSession as persistRefreshedSession/);
  assert.doesNotMatch(nfcPanel, /dancrAuthSessionV1/);
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
  assert.match(venuePanel, /title="Club Deals"/);
  assert.match(venuePanel, /VenueNfcTagPanel/);
  assert.match(venuePanel, /Analytics & performance/);
  assert.ok(venuePanel.indexOf("Tonight") < venuePanel.indexOf("Analytics & performance"));
});

test("working-now actions are neutral when empty and emerald only for a live roster", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /venue-working-now-link\$\{workingNow\.length \? " is-live" : ""\}/);
  assert.match(venuePanel, /className=\{workingNow\.length \? "is-live" : undefined\}/);
  assert.match(venuePanel, /Open working-now roster/);
  assert.match(venuePanel, /View \$\{workingNow\.length\} working now/);
  assert.match(dashboard, /\.venue-command-primary \.venue-working-now-link\.is-live \{[^}]*rgba\(16,185,129/);
  assert.match(dashboard, /\.venue-dashboard-shortcuts > a\.is-live \{[^}]*#10b981/);
  assert.doesNotMatch(venuePanel, /className="is-primary"/);
});

test("venue deal saves use the real API and immediately replace cards and counts from the response", () => {
  assert.match(dashboard, /requestDashboardJson\("\/api\/venue\/deal"/);
  assert.match(dashboard, /setDeals\(nextDeals\)/);
  assert.match(dashboard, /onDealsChange\(nextDeals\)/);
  assert.match(dashboard, /setEditingId/);
  assert.match(dashboard, /Changes saved\. This deal is live across MyDancr/);
  assert.match(venueDealRoute, /updateVenueDealForAccount/);
  assert.match(venueDealRoute, /ok: true,[\s\S]*deal,[\s\S]*deals/);
});

test("venue deal and referral-fee writes share the venue role-aware refresh boundary", () => {
  const venueDealActions = dashboard.match(/async function saveDeal[\s\S]*?const liveDeals = deals\.filter/)?.[0] || "";
  assert.match(venueDealActions, /requestDashboardJson\("\/api\/venue\/deal"/);
  assert.match(venueDealActions, /requestDashboardJson\(`\/api\/venue\/deal\?dealId=/);
  assert.match(venueDealActions, /requestDashboardJson\("\/api\/venue\/referral-fee"/);
  assert.equal((venueDealActions.match(/expectedRole: "venue"/g) || []).length, 3);
  assert.doesNotMatch(venueDealActions, /authorization: `Bearer/);
  assert.doesNotMatch(venueDealActions, /fetch\((?:"|`)\/api\/venue\/(?:deal|referral-fee)/);
});

test("venue managers can publish only the two supported admission offers", () => {
  assert.match(dashboard, /Deal offered/);
  assert.match(dashboard, /CLUB_DEAL_OFFER_PRESETS\.map/);
  assert.match(dashboard, /Club Deals are limited to these two clear admission offers/);
  assert.doesNotMatch(dashboard, /<option value="drink">/);
  assert.doesNotMatch(dashboard, /<option value="bottle_service">/);
  assert.doesNotMatch(dashboard, /<option value="other">/);
  assert.doesNotMatch(dashboard, /Live venue booking URL/);
  assert.match(dashboard, /Display order/);
  assert.match(dashboard, /MyDancr referral fee/);
  assert.match(dashboard, /MyDancr-controlled agreement/);
  assert.match(dashboard, /Request fee change/);
  assert.match(dashboard, /Publish Club Deal/);
});

test("venue Club Deal management leads with live state, next action, and compact performance", () => {
  const venueDealPanel = dashboard.match(/function VenueClubDealPanel\([\s\S]*?(?=\nfunction upsertVenueDeal)/)?.[0] || "";
  assert.match(venueDealPanel, /venue-deal-control-card/);
  assert.match(venueDealPanel, /Current Club Deal status/);
  assert.match(venueDealPanel, /Live Club Deal/);
  assert.match(venueDealPanel, /const liveDeals = deals\.filter/);
  assert.match(venueDealPanel, /liveDeals\.map/);
  assert.match(venueDealPanel, /aria-label="Live Club Deals"/);
  assert.match(venueDealPanel, /openSpecificDealEditor\(deal\)/);
  assert.match(venueDealPanel, /\$\{liveCount\} Club Deals are live/);
  assert.match(venueDealPanel, /Manage live deals/);
  assert.match(venueDealPanel, /Preview live \{liveCount === 1 \? "deal" : "deals"\}/);
  assert.match(venueDealPanel, /Confirmed taps/);
  assert.match(venueDealPanel, /Redemption intents/);
  assert.match(venueDealPanel, /Outstanding/);
  assert.match(venueDealPanel, /venue-deal-control-primary/);
  assert.match(venueDealPanel, /Edit live deal/);
  assert.match(venueDealPanel, /Create Club Deal/);
  assert.match(venueDealPanel, /Preview live/);
  assert.match(venueDealPanel, /<details className="venue-deal-editor"/);
  assert.match(venueDealPanel, /Pause Deal/);
  assert.match(venueDealPanel, /<details className="venue-deal-performance">/);
  assert.doesNotMatch(venueDealPanel, /Unpublish This Deal/);
  assert.ok(venueDealPanel.indexOf("venue-deal-control-card") < venueDealPanel.indexOf("venue-deal-editor"));
});

test("venue Club Deal guidance stays concise with details available on demand", () => {
  const venueDealPanel = dashboard.match(/function VenueClubDealPanel\([\s\S]*?(?=\nfunction upsertVenueDeal)/)?.[0] || "";
  assert.match(venueDealPanel, /no reprogramming required/);
  assert.match(venueDealPanel, /<summary>How Club Deals work<\/summary>/);
  assert.match(venueDealPanel, /Guests select a deal and tap your MyDancr cashier sticker/);
  assert.match(venueDealPanel, /Sticker status is managed in Assigned NFC access/);
  assert.doesNotMatch(venueDealPanel, /Venue staff must confirm redemption while signed in/);
  assert.doesNotMatch(venueDealPanel, /Only a server-verified active tag creates/);
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
