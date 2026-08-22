import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminClient, venueRoute, accessCodeRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claim-codes/route.ts", import.meta.url), "utf8"),
]);

test("the routed admin dashboard loads request-bound venue access-code state", () => {
  assert.match(adminClient, /venueClaimCodes\?: Array<Record<string, unknown>>/);
  assert.match(adminClient, /venueClaimCodes: data\.claimCodes \|\| \[\]/);
  assert.match(adminClient, /claimCodes=\{state\.venueClaimCodes \|\| \[\]\}/);
  assert.match(venueRoute, /getAdminVenueClaimCodes\(admin\)/);
  assert.match(venueRoute, /return NextResponse\.json\(\{ ok: true, venues, claimCodes \}\)/);
});

test("approval reveals a request-bound code once and administrators can revoke it", () => {
  assert.match(adminClient, /Approval creates a private venue workspace/);
  assert.match(adminClient, /Approve & send access/);
  assert.match(adminClient, /Copy private access code/);
  assert.match(adminClient, /fetch\("\/api\/admin\/venue-claim-codes"/);
  assert.match(adminClient, /JSON\.stringify\(\{ action: "revoke", codeId: asText\(claimCode\.id\) \}\)/);
  assert.match(adminClient, /Revoke access code/);
  assert.match(accessCodeRoute, /requireAdmin\(client, user\.id\)/);
  assert.match(accessCodeRoute, /Venue access codes are created only when an approved venue request/);
  assert.match(accessCodeRoute, /if \(action === "issue"\)/);
  assert.doesNotMatch(adminClient, /Replace access code/);
});

test("venue access controls communicate connected, private, and expiring states", () => {
  assert.match(adminClient, /venue\.owner_user_id \|\| venue\.ownerUserId/);
  assert.match(adminClient, /Venue account connected/);
  assert.match(adminClient, /Private workspace/);
  assert.match(adminClient, /expires \$\{formatDate\(activeCode\.expiresAt\)\}/);
  assert.match(adminClient, /New codes are issued only through the approved request workflow/);
  assert.doesNotMatch(adminClient, /venues\.slice\(0, 6\)/);
  assert.match(adminClient, /type="search"/);
  assert.match(adminClient, /No venues match this search/);
});

test("admin panels and individual venue controls remain collapsible without manual venue creation", () => {
  assert.match(adminClient, /<details className=\{title === "Support Inbox"/);
  assert.match(adminClient, /<summary className="admin-panel-head">/);
  assert.match(adminClient, /className="admin-panel-body"/);
  assert.match(adminClient, /<details className="venue-admin-row" key=\{venueId\}>/);
  assert.match(adminClient, /\.admin-panel\[open\] \.admin-panel-chevron/);
  assert.doesNotMatch(adminClient, /<details className="venue-create-panel">/);
});
