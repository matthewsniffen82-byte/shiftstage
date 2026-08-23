import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");

test("performance and rewards starts with four decision-ready metrics", () => {
  for (const label of ["Current rank", "30-day views", "Successful Club Deals", "Available rewards"]) {
    assert.match(dashboard, new RegExp(`label="${label}"`));
  }
  assert.match(dashboard, /className="dancer-performance-summary"/);
});

test("reward areas are collapsed and grouped under clear summaries", () => {
  for (const title of ["Club Deal rewards", "Earnings & payouts", "Weekly results"]) {
    assert.match(dashboard, new RegExp(`title="${title}"`));
  }
  assert.match(dashboard, /<details className="dancer-performance-detail">/);
  assert.doesNotMatch(dashboard, /<details className="dancer-performance-detail" open/);
});

test("secondary commission and payout explanations stay available on demand", () => {
  for (const disclosure of ["More Club Deal activity", "View commission tiers", "How Club Deal rewards work", "How payouts work"]) {
    assert.match(dashboard, new RegExp(`<summary>${disclosure}</summary>`));
  }
  assert.match(dashboard, /role="tablist" aria-label="Rewards history views"/);
  assert.match(dashboard, /setHistoryView\("earnings"\)/);
  assert.match(dashboard, /setHistoryView\("payouts"\)/);
});

test("weekly results use one compact summary and mobile metrics use a two-column grid", () => {
  assert.match(dashboard, /className="weekly-result-summary"/);
  assert.match(dashboard, /\.dancer-performance-summary \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});
