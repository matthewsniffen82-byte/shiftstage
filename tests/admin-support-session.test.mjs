import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, supportRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/support/route.ts", import.meta.url), "utf8"),
]);

const supportInbox = adminDashboard.match(/function AdminSupportInbox\([\s\S]*?function ReportManager/)?.[0] || "";

test("admin support uses the refresh-aware role-isolated admin boundary", () => {
  assert.equal((supportRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 2);
  assert.equal((supportRoute.match(/session: session \|\| null/g) || []).length, 2);
  assert.equal((supportInbox.match(/requestAdminJson\("\/api\/admin\/support"/g) || []).length, 1);
  assert.doesNotMatch(supportInbox, /readToken\(\)|fetch\([\s\S]*?\/api\/admin\/support/);
});

test("admin support replies recover from failures and prevent duplicate submission", () => {
  assert.match(supportInbox, /function beginSupportAction\(\)/);
  assert.match(supportInbox, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(supportInbox, /signal: request\.controller\.signal/);
  assert.match(supportInbox, /function isCurrentSupportAction/);
  assert.match(supportInbox, /function finishSupportAction/);
  assert.match(supportInbox, /fallbackMessage: "Unable to send reply\."/);
  assert.match(supportInbox, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(supportInbox, /finally \{[\s\S]*?finishSupportAction\(request\)/);
  assert.match(supportInbox, /disabled=\{Boolean\(busyThreadId\)\}/);
  assert.match(supportInbox, /busyThreadId === threadId \? "Sending reply\.\.\." : "Reply to account"/);
});
