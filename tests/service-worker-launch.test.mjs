import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
function worker(storageFails = false) {
  const handlers = {}, deleted = [], requests = [];
  let claimed = 0;
  vm.runInNewContext(source, {
    URL,
    caches: {
      keys: async () => { if (storageFails) throw new Error("Storage blocked"); return ["old-offline-pages"]; },
      delete: async name => { deleted.push(name); return true; },
    },
    self: {
      location: { origin: "https://www.mydancr.com" },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting() {},
      clients: {
        claim: async () => { claimed++; },
        matchAll: () => assert.fail("Activation must not navigate an open window"),
      },
    },
    fetch: async (request, options) => { requests.push({ request, options }); return new Response("private"); },
  });
  return { handlers, deleted, requests, claimed: () => claimed };
}

for (const storageFails of [false, true]) {
  test(`activation takes over without restarting loading pages (storage blocked: ${storageFails})`, async () => {
    const f = worker(storageFails);
    let pending;
    f.handlers.activate({ waitUntil: value => { pending = value; } });
    await pending;
    assert.equal(f.claimed(), 1);
    assert.deepEqual(f.deleted, storageFails ? [] : ["old-offline-pages"]);
  });
}

test("public launches, assets, media and requests use native loading and document CSP", () => {
  const f = worker();
  for (const [url, mode, method = "GET"] of [
    ["https://www.mydancr.com/", "navigate"],
    ["https://www.mydancr.com/?view=tv", "navigate"],
    ["https://www.mydancr.com/dancers/example", "navigate"],
    ["https://www.mydancr.com/venues/example", "navigate"],
    ["https://www.mydancr.com/tv", "navigate"],
    ["https://www.mydancr.com/live-shell.js?v=current", "no-cors"],
    ["https://www.mydancr.com/api/public/discovery", "cors"],
    ["https://www.mydancr.com/api/account", "cors", "POST"],
    ["https://fonts.googleapis.com/css2", "no-cors"],
    ["https://fonts.gstatic.com/font.woff2", "cors"],
    ["https://media.example.com/poster.webp", "no-cors"],
    ["https://other.example.com/", "navigate"],
  ]) {
    f.handlers.fetch({ request: { url, mode, method }, respondWith: () => assert.fail(url) });
  }
  assert.deepEqual(f.requests, []);
});

test("private navigation retains its no-store protection", async () => {
  const f = worker();
  for (const path of ["/account", "/dashboard/dancer", "/admin", "/pickups"]) {
    let pending;
    const request = { url: `https://www.mydancr.com${path}`, mode: "navigate", method: "GET", cache: "default" };
    f.handlers.fetch({ request, respondWith: value => { pending = value; } });
    assert.equal(await (await pending).text(), "private");
    assert.equal(f.requests.at(-1).request, request);
    assert.equal(f.requests.at(-1).options.cache, "no-store");
  }
});
