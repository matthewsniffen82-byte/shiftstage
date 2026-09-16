import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Read-only smoke checks. Never signs in, enables pickup, or creates a request.
const base = process.env.PICKUP_VERIFY_URL || 'https://www.mydancr.com';
const id = '96000000-0000-4000-8000-000000000020';
const summaries = [];
for (const path of ['/api/pickups', '/api/pickups/settings']) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 401, path);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  summaries.push({ path, status: response.status, private: true });
}
for (const [path,method] of [[`/api/pickups/${id}`,'GET'],[`/api/pickups/${id}`,'POST'],['/api/pickups','POST'],['/api/pickups/guest-unread','POST'],['/api/pickups/settings','POST']]) {
  const response=await fetch(new URL(path,base),{method,signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,410,path);assert.match(response.headers.get('cache-control')||'',/no-store/);
  summaries.push({path,method,status:410});
}
const discoveryResponse = await fetch(new URL('/api/public/discovery?city=Las%20Vegas', base), { signal: AbortSignal.timeout(30000) });
assert.equal(discoveryResponse.status, 200);
const discovery = await discoveryResponse.json();
assert.equal(discovery.ok, true);
assert.ok(discovery.venues.length > 0);
for (const venue of discovery.venues) {
  assert.ok(!('clubPickupEnabled' in venue));
  for (const key of ['pickup_location_text', 'pickup_location_details', 'customer_user_id', 'messages']) assert.ok(!(key in venue));
}
summaries.push({ path: '/api/public/discovery', status: 200, venues: discovery.venues.length, dancers: discovery.dancers.length, chatAvailabilityRemoved: true });
const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/aix23/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browserNames = (process.env.PICKUP_VERIFY_BROWSERS || 'android,iphone').split(',');
assert.ok(browserNames.length && browserNames.every(name => ['android', 'iphone'].includes(name)), 'Choose android and/or iphone');
for (const [name, engine, device] of [['android', chromium, 'Pixel 5'], ['iphone', webkit, 'iPhone 13']]) {
  if (!browserNames.includes(name)) continue;
  const browser = await engine.launch({ headless: true, ...(name === 'android' ? { channel: 'msedge' } : {}) });
  try {
    const context = await browser.newContext({ ...devices[device] });
    const page = await context.newPage(), errors = [], browserNotices = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // WebKit reports this existing homepage-only Chromium viewport hint as an error.
      if (name === 'iphone' && text === 'Viewport argument key "interactive-widget" not recognized and ignored.') browserNotices.push(text);
      else errors.push(text);
    });
    for (const path of ['/pickups', `/pickups/${id}`]) {
      const response = await page.goto(new URL(path, base).href);
      assert.equal(response.status(), 200);
      if(path==='/pickups')await page.getByRole('link', { name: 'Browse clubs', exact: true }).waitFor();
      else await page.getByRole('heading', { name: 'Pickup chat has closed', exact: true }).waitFor();
      assert.equal(await page.locator('.pickup-message').count(), 0);
      assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForLoadState('networkidle');
    }
    await page.goto(new URL('/pickups/new', base).href);
    await page.getByRole('heading', { name: 'Club Pickup unavailable', exact: true }).waitFor();
    // Let ordinary Link prefetches finish before this script replaces the page;
    // otherwise WebKit reports the test-induced cancellation as an RSC failure.
    await page.waitForLoadState('networkidle');
    await page.goto(new URL('/rides/'+discovery.venues[0].id,base).href);
    await page.getByLabel('Phone',{exact:true}).waitFor();
    for(const label of ['Name','Pickup location','Guests','Email'])assert.equal(await page.getByLabel(label,{exact:true}).count(),1);
    assert.doesNotMatch(await page.locator('body').innerText(),/Chat opens|Request by phone instead|Enable pickup notifications/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.waitForLoadState('networkidle');
    await page.goto(new URL('/?view=venues', base).href);
    await page.waitForFunction(() => document.body.innerText.includes('Clubs'));
    assert.equal(await page.locator('#guestPickupNav').count(),0);
    assert.deepEqual(errors, [], `${name} runtime/console errors`);
    summaries.push({ browser: name, contactForm: true, retiredChats: true, unavailableVenue: true, homepage: true, runtimeErrors: errors, browserNotices });
  } finally { await browser.close(); }
}
console.log(JSON.stringify(summaries, null, 2));
