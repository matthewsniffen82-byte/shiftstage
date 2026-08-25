import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, moderationRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/image-moderation/route.ts", import.meta.url), "utf8"),
]);

const moderationQueue = adminDashboard.match(/function ImageModerationQueue\([\s\S]*?function AdminSupportInbox/)?.[0] || "";

test("image moderation uses the refresh-aware role-isolated admin boundary", () => {
  assert.equal((moderationRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 2);
  assert.equal((moderationRoute.match(/session: session \|\| null/g) || []).length, 3);
  assert.equal((moderationQueue.match(/requestAdminJson\(/g) || []).length, 2);
  assert.doesNotMatch(moderationQueue, /readToken\(\)|fetch\([^\n]*\/api\/admin\/image-moderation/);
});

test("image moderation refreshes recover from failures and preserve server messages", () => {
  assert.match(moderationQueue, /Array\.isArray\(data\.records\) \? data\.records : \[\]/);
  assert.match(moderationQueue, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(moderationQueue, /finally \{[\s\S]*?setIsLoading\(false\)/);
  assert.match(moderationQueue, /fallbackMessage: "Unable to update moderation record\."/);
});
