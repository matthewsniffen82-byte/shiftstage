import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, limiter, nfc, favorites, follows, venueFollows, notifications, dealActions] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608300003_atomic_request_rate_limits.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public-request-rate-limit.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/favorites/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/follows/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/venue-follows/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/notifications/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-actions.ts", import.meta.url), "utf8"),
]);

test("request limits are atomically consumed in a private database bucket", () => {
  assert.match(migration, /create table if not exists public\.request_rate_limit_buckets/);
  assert.match(migration, /primary key \(namespace, key_type, key_hash\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.request_rate_limit_buckets from public, anon, authenticated/);
  assert.equal((migration.match(/on conflict \(namespace, key_type, key_hash\) do update/g) || []).length, 2);
  assert.match(migration, /v_allowed := v_ip_count <= p_ip_limit and v_subject_count <= p_subject_limit/);
  assert.match(migration, /revoke all on function public\.consume_request_rate_limit\([\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.consume_request_rate_limit\([\s\S]*?to service_role/);
});

test("the server hashes identities before the atomic limiter and fails closed on real errors", () => {
  const rpcPosition = limiter.indexOf('.rpc("consume_request_rate_limit"');
  assert.ok(limiter.indexOf("requestIpHash = securityHash") < rpcPosition);
  assert.ok(limiter.indexOf("subjectHash = securityHash") < rpcPosition);
  assert.match(limiter, /if \(!isMissingAtomicRateLimit\(error\)\) throw error/);
  assert.match(limiter, /code[\s\S]*?=== "PGRST202"/);
  assert.doesNotMatch(migration, /ip_address|user_agent|email|token/);
});

test("NFC opens, NFC actions, and financial redemptions have layered limits", () => {
  assert.match(nfc, /namespace: "nfc_open"/);
  assert.match(nfc, /namespace: "nfc_action"/);
  assert.match(nfc, /subject: `\$\{token\}:\$\{sessionId\}`/);
  assert.match(nfc, /error instanceof PublicRequestRateLimitError/);
  assert.match(nfc, /status: 429/);
  assert.match(nfc, /"retry-after"/);
  assert.match(dealActions, /namespace: "deal_redemption"/);
  assert.match(dealActions, /subject: `\$\{clubDealId\}:\$\{sessionId\}`/);
});

test("customer preference and notification mutations return explicit 429 responses", () => {
  for (const [source, namespace] of [
    [favorites, "customer_favorite"],
    [follows, "customer_follow"],
    [venueFollows, "customer_venue_follow"],
    [notifications, "notification_mutation"],
  ]) {
    assert.match(source, new RegExp(`namespace: "${namespace}"`));
    assert.match(source, /PublicRequestRateLimitError/);
    assert.match(source, /status: 429/);
    assert.match(source, /"retry-after"/);
  }
});
