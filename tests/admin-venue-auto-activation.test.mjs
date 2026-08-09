import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminService, adminClient, liveApp] = await Promise.all([
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("admin-created venues are active immediately without a verification decision", () => {
  assert.match(
    adminService,
    /if \(creating\) \{[\s\S]*?row\.is_active = true;/,
  );
  assert.doesNotMatch(
    adminService,
    /if \(creating\) \{[\s\S]*?row\.is_active = input\.isActive !== false;/,
  );
  assert.match(adminClient, /setStatus\("Venue created and active\."\)/);
});

test("venue management exposes active and hidden states without a venue verification queue", () => {
  assert.match(liveApp, /Directory status: Active/);
  assert.doesNotMatch(liveApp, /data-admin-action="verify-venue"/);
  assert.doesNotMatch(liveApp, /Venue verified/);
  assert.doesNotMatch(liveApp, /Verification status: \$\{venue\.verified/);
  assert.match(liveApp, /data-admin-action="remove-venue"/);
  assert.match(liveApp, /isActive: false/);
});

test("dancer venue affiliation remains separate from venue legitimacy", () => {
  assert.match(liveApp, /Confirm venue affiliation/);
  assert.match(liveApp, /data-venue-affiliation-remove/);
});
