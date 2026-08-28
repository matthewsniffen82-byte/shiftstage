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

test("ranking recalculation rejects duplicate and stale work while preserving server errors", () => {
  assert.match(rankingManager, /function beginRankingAction\(\)/);
  assert.match(rankingManager, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(rankingManager, /signal: request\.controller\.signal/);
  assert.match(rankingManager, /function isCurrentRankingAction/);
  assert.match(rankingManager, /function finishRankingAction/);
  assert.match(rankingManager, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(rankingManager, /finally \{[\s\S]*?finishRankingAction\(request\)/);
  assert.match(rankingManager, /setIsWorking\(false\)/);
  assert.match(rankingManager, /Array\.isArray\(data\.rankings\) \? data\.rankings : \[\]/);
});
