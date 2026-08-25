import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, rankingsRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/rankings/recalculate/route.ts", import.meta.url), "utf8"),
]);

const rankingManager = adminDashboard.match(/function RankingManager\(\)[\s\S]*?function ImageModerationQueue/)?.[0] || "";

test("ranking recalculation uses the refresh-aware role-isolated admin boundary", () => {
  assert.match(rankingsRoute, /const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/);
  assert.match(rankingsRoute, /session: session \|\| null/);
  assert.match(rankingManager, /requestAdminJson\("\/api\/admin\/rankings\/recalculate"/);
  assert.doesNotMatch(rankingManager, /readToken\(\)|fetch\("\/api\/admin\/rankings\/recalculate"/);
});

test("ranking recalculation always leaves its working state and preserves server errors", () => {
  assert.match(rankingManager, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(rankingManager, /finally \{[\s\S]*?setIsWorking\(false\)/);
  assert.match(rankingManager, /Array\.isArray\(data\.rankings\) \? data\.rankings : \[\]/);
});
