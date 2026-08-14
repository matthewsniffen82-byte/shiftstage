import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminClient, venueRoute, accessCodeRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claim-codes/route.ts", import.meta.url), "utf8"),
]);

test("the routed admin dashboard loads and retains production venue access-code state", () => {
  assert.match(adminClient, /venueClaimCodes\?: Array<Record<string, unknown>>/);
  assert.match(adminClient, /venueClaimCodes: data\.claimCodes \|\| \[\]/);
  assert.match(adminClient, /claimCodes=\{state\.venueClaimCodes \|\| \[\]\}/);
  assert.match(venueRoute, /getAdminVenueClaimCodes\(admin\)/);
  assert.match(venueRoute, /return NextResponse\.json\(\{ ok: true, venues, claims, claimCodes \}\)/);
});

test("administrators can create, reveal once, copy, replace, and revoke a venue access code", () => {
  assert.match(adminClient, /fetch\("\/api\/admin\/venue-claim-codes"/);
  assert.match(adminClient, /JSON\.stringify\(\{ action: "issue", venueId, expiresInDays: 7 \}\)/);
  assert.match(adminClient, /JSON\.stringify\(\{ action: "revoke", codeId: asText\(claimCode\.id\) \}\)/);
  assert.match(adminClient, /Copy it now; for security it cannot be retrieved later/);
  assert.match(adminClient, /copyAdminText\(revealedCodes\[venueId\] \|\| ""\)/);
  assert.match(adminClient, /Replace access code/);
  assert.match(adminClient, /Revoke access code/);
  assert.match(accessCodeRoute, /requireAdmin\(client, user\.id\)/);
  assert.match(accessCodeRoute, /action === "issue" \|\| body\?\.action === "revoke"/);
});

test("venue access controls communicate connected, inactive, and expiring states", () => {
  assert.match(adminClient, /venue\.owner_user_id \|\| venue\.ownerUserId/);
  assert.match(adminClient, /Venue account connected/);
  assert.match(adminClient, /Activate this venue before creating a manager access code/);
  assert.match(adminClient, /Expires \$\{formatDate\(activeCode\.expiresAt\)\}/);
  assert.doesNotMatch(adminClient, /venues\.slice\(0, 6\)/);
  assert.match(adminClient, /type="search"/);
  assert.match(adminClient, /No venues match this search/);
});

test("admin panels, venue creation, and individual venue controls are collapsible", () => {
  assert.match(adminClient, /<details className=\{title === "Support Inbox"/);
  assert.match(adminClient, /<summary className="admin-panel-head">/);
  assert.match(adminClient, /className="admin-panel-body"/);
  assert.match(adminClient, /<details className="venue-create-panel">/);
  assert.match(adminClient, /<details className="venue-admin-row" key=\{venueId\}>/);
  assert.match(adminClient, /\.admin-panel\[open\] \.admin-panel-chevron/);
});
