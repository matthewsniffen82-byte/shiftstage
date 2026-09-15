import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "C:/Users/aix23/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = resolve(import.meta.dirname, ".."), artifacts = resolve(root, ".next-push-invitations");
mkdirSync(artifacts, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/mydancr-push-invitations.css"><body style="background:#09080d;color:white;font-family:Arial"><h1>Pickup conversation</h1><p>Your pickup request was sent.</p><script defer src="/mydancr-push-invitations.js" data-device-module="/mydancr-push-device.js"></script></body>');
  }
  const file = new URL(req.url, "http://localhost").pathname;
  if (!["/mydancr-push-invitations.css", "/mydancr-push-invitations.js", "/mydancr-push-device.js"].includes(file)) { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", file.endsWith("css") ? "text/css" : "text/javascript");
  res.end(readFileSync(resolve(root, "public" + file)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
try {
  for (const [role, moment, width] of [["customer", "customer-pickup", 375], ["venue", "venue-chat", 1280]]) {
    const context = await browser.newContext({ viewport: { width, height: 812 } });
    const page = await context.newPage(), errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ role }) => {
      localStorage.setItem("dancrAuthSessionV1", JSON.stringify({ accessToken: "synthetic", account: { id: "test-account", role } }));
      window.__permissionRequests = 0;
      Object.defineProperty(window, "Notification", { value: { permission: "default", requestPermission: async () => { window.__permissionRequests++; Notification.permission = "granted"; return "granted"; } } });
      Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: async () => undefined } });
      window.PushManager ||= function() {};
    }, { role });
    await page.route("**/api/notifications", route => route.fulfill({ json: { ok: true, pushUserId: "test-account", notificationDelivery: { pushAvailable: true, pushAppId: "test-app", pushExternalId: "opaque-test-alias" } } }));
    await page.route("**/api/customer/profile", route => { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, profile: { userId: "test-account", notificationSettings: { pushEnabled: true } } } }); });
    await page.route("https://cdn.onesignal.com/**", route => route.fulfill({ contentType: "text/javascript", body: `
      const subscription={optedIn:false,id:'',optIn:async()=>{subscription.optedIn=true;subscription.id='synthetic-id'},optOut:async()=>{},addEventListener(){},removeEventListener(){}};
      const sdk={init:async()=>{},login:async()=>{},logout:async()=>{},Notifications:{isPushSupported:()=>true},User:{PushSubscription:subscription}};
      window.OneSignalDeferred.forEach(callback=>callback(sdk));` }));
    await page.goto(base);
    await page.waitForFunction(() => window.mydancrPushInvitationsInstalled);
    assert.equal(await page.locator(".mydancr-push-invitation").count(), 0);
    await page.evaluate(moment => window.dispatchEvent(new CustomEvent("mydancr:push-invitation", { detail: { moment } })), moment);
    const card = page.locator(".mydancr-push-invitation"); await card.waitFor();
    assert.equal(await page.evaluate(() => window.__permissionRequests), 0);
    const box = await card.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width);
    assert.ok(box.y >= 0 && box.y + box.height <= 812);
    await page.screenshot({ path: resolve(artifacts, `${role}-${width}.png`) });
    await page.getByRole("button", { name: "Enable notifications", exact: true }).click();
    await page.getByText("Notifications are enabled on this device.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__permissionRequests), 1);
    assert.equal(writes.length, role === "customer" ? 1 : 0);
    assert.deepEqual(errors, []);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await card.count(), 0);
    await context.close();
    process.stdout.write(`${role} ${width}px: layout, explicit consent, shared SDK and saved subscription passed.\n`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
