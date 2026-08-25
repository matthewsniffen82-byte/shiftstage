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
  assert.match(supportInbox, /fallbackMessage: "Unable to send reply\."/);
  assert.match(supportInbox, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(supportInbox, /finally \{[\s\S]*?setBusyThreadId\(""\)/);
  assert.match(supportInbox, /disabled=\{busyThreadId === threadId\}/);
  assert.match(supportInbox, /busyThreadId === threadId \? "Sending reply\.\.\." : "Reply to account"/);
});
