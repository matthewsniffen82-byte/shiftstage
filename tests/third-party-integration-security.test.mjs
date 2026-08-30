import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [stripeWebhook, providerEvents, notificationDelivery, cronAuth] = await Promise.all([
  readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-provider-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/notification-delivery.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/cron-auth.ts", import.meta.url), "utf8"),
]);

test("handled Stripe callbacks enforce timestamp freshness and one idempotent boundary", () => {
  assert.match(stripeWebhook, /STRIPE_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 \* 60/);
  assert.match(
    stripeWebhook,
    /constructEvent\([\s\S]*?getServerEnv\("STRIPE_WEBHOOK_SECRET"\),\s*STRIPE_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS/,
  );
  const claimIndex = stripeWebhook.indexOf("recordPaymentProviderWebhook(");
  assert.ok(claimIndex > 0);
  for (const operation of [
    "syncCheckoutSessionSubscription(",
    "syncStripeSubscription(",
    "markStripeSubscriptionDeleted(",
    "syncStripeInvoice(",
    "completeProviderPayout(",
  ]) {
    assert.ok(claimIndex < stripeWebhook.indexOf(operation), `${operation} must run after the event claim`);
  }
  assert.match(stripeWebhook, /await finishPaymentProviderWebhook\(admin, "stripe", event\.id\);/);
  assert.match(providerEvents, /processing_status = 'failed'|processing_status: failureReason/);
});

test("notification providers have bounded requests and do not expose provider bodies", () => {
  assert.match(notificationDelivery, /DELIVERY_PROVIDER_TIMEOUT_MS = 10_000/);
  assert.match(notificationDelivery, /redirect: "error"/);
  assert.match(notificationDelivery, /AbortSignal\.timeout\(DELIVERY_PROVIDER_TIMEOUT_MS\)/);
  assert.match(notificationDelivery, /cache: "no-store"/);
  assert.doesNotMatch(notificationDelivery, /response\.text\(\)/);
  assert.match(notificationDelivery, /NOTIFICATION_PROVIDER_REJECTED[\s\S]*?provider, status/);
});

test("scheduled callbacks use a constant-time shared bearer-secret boundary", async () => {
  assert.match(cronAuth, /timingSafeEqual\(providedBuffer, expectedBuffer\)/);
  const routes = [
    "video-moderation",
    "shift-checkins",
    "image-moderation",
    "finance",
    "dmca-restoration",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/cron/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /authorizeCronRequest\(request\)/);
    assert.doesNotMatch(source, /process\.env\.CRON_SECRET/);
  }
});
