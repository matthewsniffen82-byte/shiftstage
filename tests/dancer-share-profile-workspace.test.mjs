import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");

test("the final dancer workspace focuses on sharing instead of redundant billing cards", () => {
  assert.match(dashboard, /title="Share profile"/);
  assert.match(dashboard, /Copy your public link or open your live profile\./);
  assert.doesNotMatch(dashboard, /function DancerBillingPanel/);
  assert.doesNotMatch(dashboard, /<Metric label="Subscription" value="FREE"/);
  assert.doesNotMatch(dashboard, /<Metric label="Monthly cost" value="\$0"/);
});

test("sharing uses one compact link row with equal copy and open actions", () => {
  assert.match(dashboard, /className="share-link-row"/);
  assert.match(dashboard, /Profile link copied\./);
  assert.match(dashboard, /role="status" aria-live="polite"/);
  assert.match(dashboard, /\.share-actions \{ display: grid !important; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(dashboard, /Free · \$0\/month/);
});
