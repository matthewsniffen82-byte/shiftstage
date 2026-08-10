import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [accountClient, authRoute, dashboardPage, dashboard, venueDealRoute, nfcTagRoute, nfcPanel, nfcService, retiredVenueQr, retiredDealQr, venueDashboardRoute, liveApp] = await Promise.all([
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/venue/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
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
  assert.match(dashboard, /x-dancr-refresh-token/);
  assert.match(dashboard, /persistResponseSession/);
  assert.match(nfcTagRoute, /session: authContext\.session \|\| null/);
  assert.match(nfcPanel, /persistRefreshedSession\(data\.session\)/);
  assert.match(nfcPanel, /dancrAuthSessionV1/);
});

test("the routed venue dashboard is isolated, closable, and uses the compact MyDancr identity", () => {
  assert.match(dashboardPage, /DashboardClient/);
  assert.match(dashboard, /dashboard-shell/);
  assert.match(dashboard, /dashboard-close/);
  assert.match(dashboard, /aria-label={`Close \$\{role\} dashboard and return to MyDancr`}/);
  assert.match(dashboard, /Venue dashboard/);
  assert.doesNotMatch(dashboardPage, /Now[\s\S]*Dancers[\s\S]*Trending/);
});

test("venue operations prioritize tonight, Club Deals, NFC stickers, and then reporting", () => {
  const venuePanel = dashboard.match(/function VenuePanel\([\s\S]*?(?=\nfunction VenueClubDealPanel)/)?.[0] || "";
  assert.match(venuePanel, /Tonight/);
  assert.match(venuePanel, /Club Deals & cashier NFC/);
  assert.match(venuePanel, /VenueNfcTagPanel/);
  assert.match(venuePanel, /Analytics & performance/);
  assert.ok(venuePanel.indexOf("Tonight") < venuePanel.indexOf("Analytics & performance"));
});

test("venue deal saves use the real API and immediately replace cards and counts from the response", () => {
  assert.match(dashboard, /fetch\("\/api\/venue\/deal"/);
  assert.match(dashboard, /setDeals\(nextDeals\)/);
  assert.match(dashboard, /onDealsChange\(nextDeals\)/);
  assert.match(dashboard, /setEditingId/);
  assert.match(dashboard, /Changes saved\. The live deal is ready on venue, dancer, and cashier NFC surfaces/);
  assert.match(venueDealRoute, /updateVenueDealForAccount/);
  assert.match(venueDealRoute, /ok: true,[\s\S]*deal,[\s\S]*deals/);
});

test("venue managers can publish typed offers and bottle service with production validation", () => {
  assert.match(dashboard, /Admission/);
  assert.match(dashboard, /Bottle service/);
  assert.match(dashboard, /Live venue booking URL/);
  assert.match(dashboard, /Display order/);
  assert.match(dashboard, /MyDancr referral fee per redemption/);
  assert.match(dashboard, /Publish Deal/);
});

test("venue owners create, disable, and rotate one-time NFC programming URLs", () => {
  assert.match(nfcTagRoute, /requireActiveVenue/);
  assert.match(nfcTagRoute, /createVenueNfcTag/);
  assert.match(nfcTagRoute, /rotateVenueNfcTag/);
  assert.match(nfcTagRoute, /setVenueNfcTagStatus/);
  assert.match(nfcService, /requireOwnedVenue/);
  assert.match(nfcPanel, /Dressing room — dancer verification/);
  assert.match(nfcPanel, /Cashier — Club Deal redemption/);
  assert.match(nfcPanel, /Shown once — program this sticker now/);
  assert.match(nfcPanel, /lock the physical sticker/);
});

test("legacy venue and deal QR write APIs return an explicit permanent replacement", () => {
  assert.match(retiredVenueQr, /status: 410/);
  assert.match(retiredVenueQr, /\/api\/venue\/nfc-tags/);
  assert.match(retiredDealQr, /status: 410/);
  assert.match(retiredDealQr, /cashier NFC stickers/);
});

test("venue dashboard data remains authenticated, owner-scoped, and backed by real analytics", () => {
  assert.match(venueDashboardRoute, /createRequestSupabaseContext/);
  assert.match(venueDashboardRoute, /account\.role !== "venue"/);
  assert.match(venueDashboardRoute, /getVenueDashboard/);
  assert.match(dashboard, /analytics/);
  assert.match(dashboard, /Working now/);
});

test("the compatibility live shell directs managers to NFC management instead of QR upload or dancer scans", () => {
  assert.match(liveApp, /Dressing-room NFC roster/);
  assert.match(liveApp, /Managers do not scan or approve dancer profiles/);
  assert.match(liveApp, /Manage NFC stickers/);
  assert.match(liveApp, /id="venueQrForm" hidden/);
});
