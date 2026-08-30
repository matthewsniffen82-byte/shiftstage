import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/stripe/webhook/route.ts", import.meta.url),
  "utf8",
);

test("Stripe webhook preserves exact signed bytes behind a one-megabyte request limit", () => {
  assert.match(route, /const MAX_STRIPE_WEBHOOK_BODY_BYTES = 1024 \* 1024/);
  assert.match(route, /readBoundedRequestBytes\([\s\S]*?MAX_STRIPE_WEBHOOK_BODY_BYTES/);
  assert.match(route, /Buffer\.from\(payload\.buffer, payload\.byteOffset, payload\.byteLength\)/);
  assert.doesNotMatch(route, /request\.text\(\)/);
});

test("unsigned Stripe requests fail before body or secret access", () => {
  assert.ok(route.indexOf("if (!signature)") < route.indexOf("readBoundedRequestBytes("));
  assert.ok(route.indexOf("if (!signature)") < route.indexOf('getServerEnv("STRIPE_WEBHOOK_SECRET")'));
});

test("Stripe signature verification does not require billing API credentials", () => {
  assert.match(route, /Stripe\.webhooks\.constructEvent\(/);
  assert.doesNotMatch(route, /getStripe\(\)/);
  assert.doesNotMatch(route, /STRIPE_SECRET_KEY/);
});

test("oversized Stripe requests retain their typed 413 response", () => {
  assert.match(route, /Stripe webhook is too large\./);
  assert.match(route, /catch \(error\) \{\s*return apiError\(error, "Unable to read Stripe webhook\."\);/);
});
