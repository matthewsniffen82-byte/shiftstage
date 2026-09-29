import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../src/lib/dancr/customer-push.ts", import.meta.url), "utf8");
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 5)]).toString("base64url");
function fixture({ permission = "granted", userAgent = "Edge", standalone = false, safariStandalone = false, platform = "", maxTouchPoints = 0, saveFails = false, accountChanges = false, existing = false } = {}) {
 const events=[],stored=new Map(),listeners=new Set();
 stored.set('dancrAuthSessionV1',JSON.stringify({account:{id:'customer'},accessToken:'own-session'}));
 const localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
 let enrolled=false,exists=existing;
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-device',options:{applicationServerKey:Buffer.from(publicKey,'base64url')},toJSON(){return {endpoint:this.endpoint,keys:{p256dh:publicKey,auth:'synthetic'}}},async unsubscribe(){events.push('unsubscribe');exists=false;return true}};
 const registration={scope:'https://mydancr.com/push/web/',active:{postMessage(data,ports){events.push({account:data.accountId});ports?.[0].postMessage({ok:true})}},pushManager:{async getSubscription(){return exists?subscription:null},async subscribe(options){events.push({subscribe:options});exists=true;return subscription}}};
 const navigator={userAgent,platform,maxTouchPoints,standalone:safariStandalone,serviceWorker:{async getRegistration(scope){return scope==='/push/web/'?registration:null},async register(path,options){events.push({register:path,...options});return registration}}};
 const Notification={permission:'default',async requestPermission(){events.push('permission');this.permission=permission;return permission}};
 const window={Notification,PushManager:{},navigator,localStorage,isSecureContext:true,matchMedia:()=>({matches:standalone}),setTimeout,clearTimeout};
 const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,window,navigator,Notification,localStorage,MessageChannel,AbortSignal,TextEncoder,Uint8Array,atob,crypto:webcrypto,
  fetch:async(url,init)=>{events.push({method:init.method,body:init.body&&JSON.parse(init.body)});assert.equal(url,'/api/push/subscriptions');assert.equal(init.headers.authorization,'Bearer own-session');if(init.method==='POST'){if(saveFails)return Response.json({error:'Could not save device'},{status:503});enrolled=true;if(accountChanges)stored.set('dancrAuthSessionV1',JSON.stringify({account:{id:'other'},accessToken:'other-session'}))}if(init.method==='DELETE')enrolled=false;return Response.json({ok:true,userId:'customer',subscriptionId:createHash('sha256').update(subscription.endpoint).digest('hex'),subscriptionIds:enrolled?[createHash('sha256').update(subscription.endpoint).digest('hex')]:[]})}
 });
 return {...exports,events,stored,subscription,listeners,Notification};
}
const delivery = { pushAvailable: true, pushPublicKey: publicKey };

test("Working Now confirmation requires saved alert preferences and a usable delivery channel", async () => {
  const f = fixture();
  const profile = { userId: "customer", notificationSettings: { pushEnabled: true }, notificationDelivery: delivery };
  assert.equal(await f.customerWorkingNowAlertsEnabled(profile, "customer"), false);
  await f.enableCustomerPush(delivery, "customer", () => {});
  assert.equal(await f.customerWorkingNowAlertsEnabled(profile, "customer"), true);
  assert.equal(await f.customerWorkingNowAlertsEnabled(profile, "someone-else"), false);
  for (const patch of [{ followAlertsEnabled: false }, { workingNow: false }, { pushEnabled: false }]) {
    assert.equal(await f.customerWorkingNowAlertsEnabled({ ...profile, notificationSettings: { ...profile.notificationSettings, ...patch } }, "customer"), false);
  }
  assert.equal(await f.customerWorkingNowAlertsEnabled({ ...profile, notificationDelivery: {} }, "customer"), false);
  f.Notification.permission = "denied";
  assert.equal(await f.customerWorkingNowAlertsEnabled(profile, "customer"), false);
  assert.equal(await f.customerWorkingNowAlertsEnabled({ ...profile, notificationSettings: { emailEnabled: true }, notificationDelivery: { emailAvailable: true } }, "customer"), true);
  assert.equal(await f.customerWorkingNowAlertsEnabled(null, "customer"), false);
});

test("push enrollment requests consent before registration and confirms server enrollment before success", async () => {
  const f = fixture({ delayedId: true });
  await f.enableCustomerPush(delivery, "customer", () => {});
  assert.equal(f.events[0], "permission");
  assert.ok(f.events.find(event => event.register === "/push/web/worker.js"));
  assert.equal(f.events.find(event => event.subscribe).subscribe.userVisibleOnly, true);
  assert.ok(f.events.find(event => event.method === "POST"));
  assert.equal(f.stored.get("mydancr:push-account"), "customer");
  assert.equal(f.listeners.size, 0);
  assert.equal(await f.customerPushDeviceEnabled("customer"), true);
  assert.equal(await f.customerPushDeviceEnabled("someone-else"), false);
  await f.disableCustomerPush();
  assert.ok(f.events.includes("unsubscribe"));
  assert.ok(f.events.some(event => event.method === "DELETE"));
  assert.equal(f.stored.has("mydancr:push-account"), false);
});

for (const permission of ["denied", "default"]) test("push stays off when permission is " + permission, async () => {
  const f = fixture({ permission });
  await assert.rejects(f.enableCustomerPush(delivery, "customer", () => {}), /stays off/);
  assert.deepEqual(f.events, ["permission"]);
  assert.equal(f.stored.has("mydancr:push-account"), false);
});

test("missing configuration and unsupported iPhone browser never request permission or enroll", async () => {
  const missing = fixture();
  await assert.rejects(missing.enableCustomerPush({}, "customer", () => {}), /not available/);
  assert.deepEqual(missing.events, []);
  const iphone = fixture({ userAgent: "iPhone" });
  await assert.rejects(iphone.enableCustomerPush(delivery, "customer", () => {}), /Home Screen/);
  assert.deepEqual(iphone.events, []);
});

test("a changed session cannot enroll after the permission prompt completes", async () => {
  const f = fixture();
  let checked=0;
  await assert.rejects(f.enableCustomerPush(delivery, "customer", () => { if (++checked > 1) throw new Error("Session changed"); }), /Session changed/);
  assert.deepEqual(f.events, ["permission"]);
  assert.equal(f.stored.has("mydancr:push-account"), false);
});

for (const device of [
  { userAgent: "Android Chrome" },
  { userAgent: "iPhone", standalone: true },
  { userAgent: "iPhone", safariStandalone: true },
  { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5, standalone: true },
]) test(`supported mobile device enrolls only after explicit permission: ${JSON.stringify(device)}`, async () => {
  const f = fixture(device);
  assert.equal(f.customerPushSupportMessage(), "");
  await f.enableCustomerPush(delivery, "customer", () => {});
  assert.equal(f.events[0], "permission");
  assert.equal(await f.customerPushDeviceEnabled("customer"), true);
});

test("iPad desktop browsing gets Home Screen installation steps before requesting permission", async () => {
  const f = fixture({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 });
  assert.match(f.customerPushSupportMessage(), /Safari.*Share.*Add to Home Screen.*16\.4/);
  await assert.rejects(f.enableCustomerPush(delivery, "customer", () => {}), /Home Screen/);
  assert.deepEqual(f.events, []);
});

test("native sign-out cleanup works after a refresh without loading a third-party SDK", async () => {
  const f = fixture({ existing: true });
  f.stored.set("mydancr:push-account", "customer");
  await f.disableCustomerPush();
  assert.ok(f.events.includes("unsubscribe"));
  assert.equal(f.stored.has("mydancr:push-account"), false);
});

test('a failed server save never marks the browser enabled',async()=>{const f=fixture({saveFails:true});await assert.rejects(f.enableCustomerPush(delivery,'customer',()=>{}),/Could not save/);assert.equal(f.stored.has('mydancr:push-account'),false);assert.ok(f.events.includes('unsubscribe'));});
test('an account change during enrollment removes the captured subscription',async()=>{const f=fixture({accountChanges:true});await assert.rejects(f.enableCustomerPush(delivery,'customer',()=>{}),/account changed/);assert.equal(f.stored.has('mydancr:push-account'),false);assert.ok(f.events.includes('unsubscribe'));});
