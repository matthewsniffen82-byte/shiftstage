import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [supportSource, routeSource, dashboardSource, adminSource, liveAppSource, serviceWorkerSource, liveRouteSource] = await Promise.all([
  readFile(new URL("../src/lib/dancr/support.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/support/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
]);

test("support API accepts authenticated customer, dancer, and venue accounts", () => {
  assert.match(routeSource, /createRequestSupabaseContext\(request\)/);
  assert.match(routeSource, /isSupportUserRole\(account\.role\)/);
  assert.doesNotMatch(routeSource, /processAutomatedSupportMessage|OpenAI|ai-support/);
  assert.match(routeSource, /createOwnSupportMessage/);
  assert.match(routeSource, /createAdminSupabaseClient\(\)/);
});

test("customer, dancer, and venue messages persist and alert active admins", () => {
  assert.match(supportSource, /SUPPORT_USER_ROLES[^\n]*\["customer", "dancer", "venue"\]/);
  assert.match(supportSource, /\.from\("support_threads"\)/);
  assert.match(supportSource, /\.from\("support_messages"\)/);
  assert.match(supportSource, /sender_kind: "human"/);
  assert.match(supportSource, /\.in\("user_role", SUPPORT_USER_ROLES\)/);
  assert.match(supportSource, /notifyActiveAdmins/);
  assert.match(supportSource, /\.eq\("role", "admin"\)/);
  assert.match(supportSource, /\.eq\("account_state", "active"\)/);
  assert.match(supportSource, /notification_type: "support_message"/);
  assert.doesNotMatch(supportSource, /support_ai_runs|addAutomatedSupportReply|recordSupportAiRun/);
});

test("admins can reply and account owners receive notifications", () => {
  assert.match(supportSource, /replyToSupportThread/);
  assert.match(supportSource, /sender_role: "admin"/);
  assert.match(supportSource, /title: "Admin replied"/);
  assert.match(adminSource, /Reply to account/);
  assert.doesNotMatch(adminSource, /Dancr Support AI|Awaiting human review|escalationReason/);
});

test("live support interfaces use the production API and the venue dashboard exposes the inbox", () => {
  assert.match(liveAppSource, /Message admin/);
  assert.match(liveAppSource, /Admin Support/);
  assert.match(liveAppSource, /getAuthenticatedJson\("\/api\/support"\)/);
  assert.match(liveAppSource, /postAuthenticatedJson\("\/api\/support"/);
  assert.match(liveAppSource, /const sent = await sendSupportMessage\(role, subject, message\)/);
  assert.match(liveAppSource, /submitButton\.classList\.toggle\("is-sent", sent\)/);
  assert.match(liveAppSource, /submitButton\.textContent = sent \? "\\u2713 Sent to admin" : defaultSubmitLabel/);
  assert.match(liveAppSource, /if \(status\) status\.textContent = "Message sent to admin\.";[\s\S]*?return true;/);
  assert.match(dashboardSource, /role === "venue"[\s\S]*?<SupportInboxPanel initialThreads=\{state\.supportThreads \|\| \[\]\} \/>/);
  assert.match(dashboardSource, /const \[sendConfirmation, setSendConfirmation\] = useState\(false\)/);
  assert.match(dashboardSource, /setStatus\("Message sent to admin\."\);[\s\S]*?setSendConfirmation\(true\)/);
  assert.match(dashboardSource, /sendConfirmation \? "✓ Sent to admin" : "Send to admin"/);
  assert.doesNotMatch(liveAppSource, /Dancr Support AI|AI answers|AI replied/);
  assert.doesNotMatch(liveAppSource, /supportStorageKey|readStoredSupportThreads|writeStoredSupportThreads|localSupportThread/);
});

test("existing installed sessions refresh onto the current production shell", () => {
  assert.match(liveAppSource, /register\("\/sw\.js\?v=avatar-wrapper-border-v4", \{ updateViaCache: "none" \}\)/);
  assert.match(liveAppSource, /registration\.update\(\)/);
  assert.match(serviceWorkerSource, /dancr-sw-release: avatar-wrapper-border-v4/);
  assert.match(serviceWorkerSource, /self\.skipWaiting\(\)/);
  assert.match(serviceWorkerSource, /self\.clients\.claim\(\)/);
  assert.match(serviceWorkerSource, /client\.navigate\(client\.url\)/);
  assert.match(serviceWorkerSource, /caches\.delete\(cacheName\)/);
  assert.match(serviceWorkerSource, /event\.request\.mode === "navigate" \? "no-store"/);
  assert.match(liveRouteSource, /export const dynamic = "force-dynamic"/);
  assert.match(liveRouteSource, /public, max-age=0, s-maxage=60, stale-while-revalidate=60/);
});
