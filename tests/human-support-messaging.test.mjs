import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [supportSource, routeSource, adminSource, liveAppSource, serviceWorkerSource, liveRouteSource] = await Promise.all([
  readFile(new URL("../src/lib/dancr/support.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/support/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
]);

test("support API is limited to authenticated customer and dancer accounts", () => {
  assert.match(routeSource, /createRequestSupabaseContext\(request\)/);
  assert.match(routeSource, /account\.role !== "customer" && account\.role !== "dancer"/);
  assert.doesNotMatch(routeSource, /processAutomatedSupportMessage|OpenAI|ai-support/);
  assert.match(routeSource, /createOwnSupportMessage/);
  assert.match(routeSource, /createAdminSupabaseClient\(\)/);
});

test("customer and dancer messages persist and alert active admins", () => {
  assert.match(supportSource, /\.from\("support_threads"\)/);
  assert.match(supportSource, /\.from\("support_messages"\)/);
  assert.match(supportSource, /sender_kind: "human"/);
  assert.match(supportSource, /\.in\("user_role", \["customer", "dancer"\]\)/);
  assert.match(supportSource, /notifyActiveAdmins/);
  assert.match(supportSource, /\.eq\("role", "admin"\)/);
  assert.match(supportSource, /\.eq\("account_state", "active"\)/);
  assert.match(supportSource, /notification_type: "support_message"/);
  assert.doesNotMatch(supportSource, /support_ai_runs|addAutomatedSupportReply|recordSupportAiRun/);
});

test("admins can reply and customers or dancers receive notifications", () => {
  assert.match(supportSource, /replyToSupportThread/);
  assert.match(supportSource, /sender_role: "admin"/);
  assert.match(supportSource, /title: "Admin replied"/);
  assert.match(adminSource, /Reply to customer or dancer/);
  assert.doesNotMatch(adminSource, /Dancr Support AI|Awaiting human review|escalationReason/);
});

test("live support interfaces use the production API without AI or venue support", () => {
  assert.match(liveAppSource, /Message admin/);
  assert.match(liveAppSource, /Admin Support/);
  assert.match(liveAppSource, /getAuthenticatedJson\("\/api\/support"\)/);
  assert.match(liveAppSource, /postAuthenticatedJson\("\/api\/support"/);
  assert.doesNotMatch(liveAppSource, /Dancr Support AI|AI answers|AI replied|data-support-panel="venue"/);
  assert.doesNotMatch(liveAppSource, /supportStorageKey|readStoredSupportThreads|writeStoredSupportThreads|localSupportThread/);
});

test("existing installed sessions refresh onto the current production shell", () => {
  assert.match(liveAppSource, /register\("\/sw\.js\?v=android-avatar-foreground-ring-v3", \{ updateViaCache: "none" \}\)/);
  assert.match(liveAppSource, /registration\.update\(\)/);
  assert.match(serviceWorkerSource, /dancr-sw-release: android-avatar-foreground-ring-v3/);
  assert.match(serviceWorkerSource, /self\.skipWaiting\(\)/);
  assert.match(serviceWorkerSource, /self\.clients\.claim\(\)/);
  assert.match(serviceWorkerSource, /client\.navigate\(client\.url\)/);
  assert.match(serviceWorkerSource, /caches\.delete\(cacheName\)/);
  assert.match(serviceWorkerSource, /event\.request\.mode === "navigate" \? "no-store"/);
  assert.match(liveRouteSource, /export const dynamic = "force-static"/);
  assert.match(liveRouteSource, /public, max-age=0, s-maxage=60, stale-while-revalidate=60/);
});
