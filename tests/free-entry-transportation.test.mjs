import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as transportation from "../src/lib/dancr/club-deal-transportation.ts";
import { formatPublicVenueAddress } from "../src/lib/dancr/uber.ts";

const venue = { id: "11111111-1111-4111-8111-111111111111", name: "Test Club", slug: "test-club", address: "123 Test Rd, Las Vegas, NV", city: "Las Vegas", state: "NV" };
const deal = { id: "22222222-2222-4222-8222-222222222222", venueId: venue.id, dealTitle: "Free admission", isActive: true };
const key = "mydancrPendingNfcDealV2";

function load(relative, imports, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name === "react/jsx-runtime") return jsx;
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  }, ...globals });
  return exports;
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}

function client(props = {}, options = {}) {
  const slots = []; let cursor = 0, tree, failStorage = false;
  const stored = new Map(); const requests = [], copies = [], invitations = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect() {},
  };
  const { default: Component } = load("../app/deals/transportation/[dealId]/TransportationClient.tsx", {
    react: hooks, "next/link": { default: "a" },
    "@/src/lib/dancr/push-invitation": { offerPushNotifications: moment => invitations.push(moment) },
    "@/src/lib/dancr/club-deal-transportation": transportation,
    "@/app/pickups/PickupRequestForm": { default: "pickup-form" }, "@/app/pickups/pickup.css": {},
    "@/app/pickups/pickup-session": { usePickupAccount: () => options.account || { ready: true, identity: "synthetic-customer", role: "customer" } },
    "@/app/components/NfcIcon": { default: () => null }, "./transportation.css": {},
  }, {
    navigator: { clipboard: options.clipboardUnavailable ? undefined : { writeText: async value => {
      if (options.clipboardDenied) throw new Error("Denied");
      copies.push(value);
    } } },
    localStorage: { getItem: name => stored.get(name) || null, removeItem: name => stored.delete(name), setItem(name, value) { if (failStorage) throw new Error("Blocked"); stored.set(name, value); } },
    crypto: { randomUUID: () => "33333333-3333-4333-8333-333333333333" },
    FormData: class { constructor(fields) { this.fields = fields; } get(name) { return this.fields[name] ?? null; } },
    AbortSignal, URLSearchParams,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: options.accepted !== false, status: options.accepted === false ? 503 : 200,
        json: async () => options.accepted === false ? { error: "Unavailable" } : { ok: true, requestId: "33333333-3333-4333-8333-333333333333", message: "The club will contact you." } };
    },
  });
  const render = () => { cursor = 0; tree = Component({ deal, venue, shuttleAvailable: true, ...props }); return tree; };
  render();
  return {
    stored, requests, copies, invitations, render,
    html: () => renderToStaticMarkup(render()),
    select(value) { nodes(tree).find(node => node.type === "input" && node.props.value === value).props.onChange(); render(); },
    async submit(phone = "7025550123") {
      await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: {
        name: "Test Guest", location: "Test Hotel, north entrance", phone, email: "guest@example.test", partySize: "2", handoffAccepted: "on",
      } }); render();
    },
    click(label) { nodes(tree).find(node => node.type === "button" && node.props.children === label).props.onClick(); render(); },
    async clickAsync(label) { await nodes(tree).find(node => node.type === "button" && node.props.children === label).props.onClick(); render(); },
    blockStorage(value) { failStorage = value; },
  };
}

test("shuttle phone formats typed and pasted numbers without changing the submitted contact", async () => {
  for (const props of [{}, { deal: undefined }]) {
    const f = client({ ...props, initialTransportation: "club_shuttle" });
    const phone = nodes(f.render()).find(node => node.type === "input" && node.props.name === "phone");
    for (const [value, expected] of [
      ["", ""], ["7", "7"], ["702", "702"], ["7025", "(702) 5"], ["702555", "(702) 555"],
      ["7025550", "(702) 555-0"], ["7025550123", "(702) 555-0123"], ["702-555-0123", "(702) 555-0123"],
      ["17025550123", "1 (702) 555-0123"], ["+1 (702) 555-0123", "+1 (702) 555-0123"],
      ["+44 7700 900123", "+44 7700 900123"], ["702555012345", "702555012345"], ["7025550123 ext 42", "7025550123 ext 42"],
    ]) {
      const input = { value, selectionStart: value.length, selectionEnd: value.length, selectionDirection: "none",
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
      phone.props.onChange({ currentTarget: input, nativeEvent: {} });
      assert.equal(input.value, expected); assert.equal(input.selectionStart, expected.length);
    }
    await f.submit("(702) 555-0123");
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.phone, "+17025550123");
  }
});

test("shuttle phone keeps the editing selection and allows deletion through formatting", () => {
  const f = client({ initialTransportation: "club_shuttle" });
  const phone = nodes(f.render()).find(node => node.type === "input" && node.props.name === "phone");
  for (const [value, start, end, expected, expectedStart, expectedEnd] of [
    ["(702) 5550123", 9, 9, "(702) 555-0123", 9, 9],
    ["(702) 550123", 8, 8, "(702) 550-123", 8, 8],
    ["702) 555-0123", 0, 0, "(702) 555-0123", 1, 1],
    ["(02) 555-0123", 1, 1, "(025) 550-123", 1, 1],
    ["7025550123", 3, 6, "(702) 555-0123", 4, 9],
  ]) {
    const input = { value, selectionStart: start, selectionEnd: end, selectionDirection: "backward",
      setSelectionRange(nextStart, nextEnd, direction) { this.selectionStart = nextStart; this.selectionEnd = nextEnd; this.selectionDirection = direction; } };
    phone.props.onChange({ currentTarget: input, nativeEvent: {} });
    assert.equal(input.value, expected); assert.equal(input.selectionStart, expectedStart); assert.equal(input.selectionEnd, expectedEnd); assert.equal(input.selectionDirection, "backward");
  }
  const input = { value: "7025", selectionStart: 4, selectionEnd: 4, setSelectionRange() {} };
  phone.props.onChange({ currentTarget: input, nativeEvent: { isComposing: true } });
  assert.equal(input.value, "7025");
  phone.props.onCompositionEnd({ currentTarget: input, nativeEvent: {} });
  assert.equal(input.value, "(702) 5");
});

test("private-car arrival prepares free entry without sending a ride request", async () => {
  const f = client(); assert.match(f.html(), /Other rideshare or taxi/);
  f.select("self_drive"); await f.submit();
  assert.equal(f.requests.length, 0);
  const selection = JSON.parse(f.stored.get(key));
  assert.equal(selection.dealId, deal.id); assert.equal(selection.transportation, "self_drive");
  assert.equal(selection.expiresAt - selection.savedAt, 12 * 60 * 60 * 1000);
  assert.match(f.html(), /staff verify your arrival method/);
});

test("one combined Waymo, Zoox and Cybercab option prepares admission without booking or notifying a ride", async () => {
  for (const { value } of transportation.AUTONOMOUS_ADMISSION_OPTIONS) {
    const f = client({ sourceType: "dancer_profile", dancerId: "dancer", attributionToken: "signed-token", shuttleAvailable: false });
    assert.match(f.html(), /Waymo \/ Zoox \/ Cybercab/);
    assert.equal(nodes(f.render()).filter(node => node.type === "input" && node.props.name === "transportation").length, 4);
    assert.doesNotMatch(f.html(), /value="(?:waymo|zoox|cybercab)"/);
    f.select(value);
    assert.match(f.html(), /Continue to free entry/);
    await f.submit();
    assert.equal(f.requests.length, 0);
    const selection = JSON.parse(f.stored.get(key));
    assert.equal(selection.transportation, value);
    assert.equal(selection.venueId, venue.id);
    assert.equal(selection.dealId, deal.id);
    assert.equal(selection.sourceType, "dancer_profile");
    assert.equal(selection.dancerId, "dancer");
    assert.equal(selection.attributionToken, "signed-token");
    assert.equal(selection.expiresAt - selection.savedAt, 12 * 60 * 60 * 1000);
    assert.equal(selection.shuttleRequestId, null);
    assert.match(f.html(), /arrive by Waymo, Zoox, or Cybercab/);
    assert.match(f.html(), /Book your ride separately; ride fare isn’t included/);
    assert.match(f.html(), /staff verify your arrival method/);
  }
});

test("provider links appear only after autonomous admission is saved and never book or notify a ride", async () => {
  const f = client();
  assert.doesNotMatch(f.html(), /club-transport-booking-links/);
  f.select("autonomous_cab");
  assert.doesNotMatch(f.html(), /club-transport-booking-links/);
  f.blockStorage(true); await f.submit();
  assert.doesNotMatch(f.html(), /club-transport-booking-links/);
  f.blockStorage(false); await f.submit();
  const links = nodes(f.render()).filter(node => node.type === "a" && node.props.className === "club-transport-provider-button");
  assert.deepEqual(links.map(node => node.props.href), ["https://waymo.com/rides/", "https://zoox.com/how-to-ride", "https://www.tesla.com/support/robotaxi"]);
  for (const link of links) {
    assert.equal(link.props.target, "_blank");
    assert.equal(link.props.rel, "noopener noreferrer");
    assert.equal(new URL(link.props.href).search, "");
  }
  assert.match(f.html(), /Check availability/);
  assert.match(f.html(), /a Cybercab isn’t guaranteed/);
  assert.equal(f.requests.length, 0);
  assert.equal(JSON.parse(f.stored.get(key)).transportation, "autonomous_cab");
  for (const choice of ["self_drive", "club_shuttle"]) {
    const other = client(); other.select(choice); await other.submit();
    assert.doesNotMatch(other.html(), /club-transport-booking-links/);
  }
});

test("copy club address has an accurate clipboard result and a manual fallback", async () => {
  for (const options of [{}, {clipboardDenied:true}, {clipboardUnavailable:true}]) {
    const f = client({}, options); f.select("autonomous_cab"); await f.submit();
    const selection = f.stored.get(key);
    await f.clickAsync("Copy club address");
    const manual = options.clipboardDenied || options.clipboardUnavailable;
    assert.deepEqual(f.copies, manual ? [] : [venue.address]);
    assert.match(f.html(), manual ? /Select and copy the club address above/ : /Club address copied/);
    const input = nodes(f.render()).find(node => node.type === "textarea");
    assert.equal(input.props.value, venue.address);
    assert.equal(input.props.readOnly, true);
    let selected = false;
    input.props.onFocus({currentTarget:{select(){selected=true;}}});
    assert.equal(selected, true);
    assert.equal(f.stored.get(key), selection);
    assert.equal(f.requests.length, 0);
  }
  const missing = client({venue:{...venue,address:null}});
  missing.select("autonomous_cab"); await missing.submit();
  assert.match(missing.html(), /Club address unavailable/);
  assert.doesNotMatch(missing.html(), /Copy club address/);
});

test("autonomous arrival requires successful local storage and can retry without a ride request", async () => {
  const f = client(); f.select("autonomous_cab"); f.blockStorage(true); await f.submit();
  assert.equal(f.stored.has(key), false);
  assert.doesNotMatch(f.html(), /Ready for your cashier tap/);
  assert.match(f.html(), /transportation choice could not be saved/);
  f.blockStorage(false); await f.submit();
  assert.equal(JSON.parse(f.stored.get(key)).transportation, "autonomous_cab");
  assert.equal(f.requests.length, 0);
});

test("changing an autonomous arrival to an ineligible rideshare clears admission", async () => {
  const f = client(); f.select("autonomous_cab"); await f.submit();
  const revisit = client(); revisit.stored.set(key, f.stored.get(key));
  revisit.select("rideshare_taxi"); await revisit.submit();
  assert.equal(revisit.stored.has(key), false);
  assert.equal(revisit.requests.length, 0);
});

test("both entry points use the same pickup handoff and admission selection", async () => {
  for (const initialTransportation of ["", "club_shuttle"]) {
    const f = client({ initialTransportation, sourceType: "dancer_profile", dancerId: "dancer", attributionToken: "signed-token" });
    if (!initialTransportation) f.select("club_shuttle");
    assert.match(f.html(), /name="location"/); assert.match(f.html(), /Lyft/);
    await f.submit();
    assert.equal(f.requests[0].url, `/api/deals/${deal.id}/shuttle`);
    assert.deepEqual(f.invitations, ["customer-pickup-phone"]);
    assert.equal(f.requests[0].body.email, "guest@example.test");
    const selection = JSON.parse(f.stored.get(key));
    assert.equal(selection.dealId, deal.id); assert.equal(selection.transportation, "club_shuttle");
    assert.equal(selection.shuttleRequestId, f.requests[0].body.requestId);
    assert.equal(selection.attributionToken, "signed-token"); assert.equal(selection.dancerId, "dancer");
    assert.equal("email" in selection, false); assert.equal("phone" in selection, false);
    assert.match(f.html(), /Awaiting club confirmation/); assert.match(f.html(), /ride is not booked yet/);
  }
});

test("enabled pickup chat receives the ride context and saves admission only after request creation", () => {
  for (const initialTransportation of ["", "club_shuttle"]) {
    const f = client({ pickupAvailable: true, initialTransportation, sourceType: "dancer_profile", dancerId: "dancer", attributionToken: "signed-token" });
    if (!initialTransportation) f.select("club_shuttle");
    const form = nodes(f.render()).find(node => node.type === "pickup-form");
    assert.ok(form); assert.equal(form.props.venue.id, venue.id);
    assert.equal(nodes(f.render()).some(node => node.type === "form"), false, "no legacy shuttle form");
    const returnTo = new URL(form.props.returnTo, "https://example.test");
    assert.equal(returnTo.pathname, `/rides/${venue.id}`);
    assert.equal(returnTo.searchParams.get("dealId"), deal.id);
    assert.equal(returnTo.searchParams.get("sourceType"), "dancer_profile");
    assert.equal(returnTo.searchParams.get("attributionToken"), "signed-token");
    assert.equal(f.stored.has(key), false);
    f.blockStorage(true); assert.equal(form.props.saveAdmission("pickup-id"), false);
    assert.equal(f.stored.has(key), false);
    f.blockStorage(false); assert.equal(form.props.saveAdmission("pickup-id"), true);
    const saved = JSON.parse(f.stored.get(key));
    assert.equal(saved.venueId, venue.id); assert.equal(saved.dealId, deal.id);
    assert.equal(saved.transportation, "club_shuttle"); assert.equal(saved.pickupRequestId, "pickup-id");
    assert.equal(saved.shuttleRequestId, null); assert.equal(saved.attributionToken, "signed-token");
    assert.equal(saved.dancerId, "dancer"); assert.equal(saved.expiresAt - saved.savedAt, 12 * 60 * 60 * 1000);
    assert.equal(f.requests.length, 0);
  }
  const rideOnly = client({ pickupAvailable: true, deal: undefined });
  assert.equal(nodes(rideOnly.render()).find(node => node.type === "pickup-form").props.saveAdmission, undefined);
  assert.equal(rideOnly.stored.has(key), false);
});

test("guest phone fallback and professional pickup requests preserve contact and admission", async () => {
  for (const account of [{ ready: true, identity: "" }, { ready: true, identity: "venue-user", role: "venue" }]) {
    for (const rideOnly of [false, true]) {
      const f = client({ pickupAvailable: true, initialTransportation: "club_shuttle", ...(rideOnly ? { deal: undefined } : {}),
        sourceType: "dancer_profile", dancerId: "dancer", attributionToken: "signed-token" }, { account });
      if (!account.identity) {
        assert.ok(nodes(f.render()).some(node => node.type === "pickup-form"));
        f.click("Request by phone instead");
      }
      assert.equal(nodes(f.render()).some(node => node.type === "pickup-form"), false);
      assert.ok(nodes(f.render()).some(node => node.type === "input" && node.props.name === "phone"));
      await f.submit();
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].url, rideOnly ? `/api/venues/${venue.id}/shuttle` : `/api/deals/${deal.id}/shuttle`);
      assert.equal(f.requests[0].body.phone, "+17025550123");
      assert.equal(f.requests[0].body.handoffAccepted, true);
      assert.match(f.html(), /Awaiting club confirmation/);
      assert.doesNotMatch(f.html(), /Pickup chat is not enabled/);
      const saved = JSON.parse(f.stored.get(key) || "null");
      if (rideOnly) assert.equal(saved, null);
      else { assert.equal(saved.shuttleRequestId, f.requests[0].body.requestId); assert.equal(saved.attributionToken, "signed-token"); }
    }
  }
});

test("ride fields wait for local session initialization so typing cannot select the wrong form", () => {
  const account = { ready: false, identity: "" };
  const f = client({ pickupAvailable: true, initialTransportation: "club_shuttle" }, { account });
  assert.match(f.html(), /Loading pickup form/);
  assert.equal(nodes(f.render()).some(node => node.type === "input"), false);
  account.ready = true;
  assert.ok(nodes(f.render()).some(node => node.type === "pickup-form"));
});

test("customers can choose the public phone form without leaving their account", async () => {
  const f = client({ pickupAvailable: true, initialTransportation: "club_shuttle" });
  assert.ok(nodes(f.render()).some(node => node.type === "pickup-form"));
  f.click("Request by phone instead");
  assert.equal(nodes(f.render()).some(node => node.type === "pickup-form"), false);
  await f.submit(); assert.equal(f.requests.length, 1);
});

test("direct Club Pickup links open the guest-capable ride page for an eligible venue", async () => {
  for (const enabled of [true, false]) {
    const page = load("../app/pickups/new/page.tsx", {
      "next/link": { default: "a" }, "next/navigation": { redirect: url => { throw { destination: url }; } },
      "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
      "@/src/lib/dancr/pickup-eligibility": { getPickupVenue: async (_, selected) => selected === venue.id ? { ...venue, club_pickup_enabled: enabled } : null },
    });
    await assert.rejects(page.default({ searchParams: Promise.resolve({ venue: venue.id }) }), error => error.destination === `/rides/${venue.id}`);
    const unavailable = await page.default({ searchParams: Promise.resolve({ venue: "missing" }) });
    assert.match(renderToStaticMarkup(unavailable), /Club Pickup unavailable/);
  }
});

test("rideshares cannot prepare entry and selecting one clears a previous selection for this venue", async () => {
  const f = client(); f.stored.set(key, JSON.stringify({ venueId: venue.id, dealId: deal.id, transportation: "self_drive" }));
  f.select("rideshare_taxi"); await f.submit();
  assert.equal(f.stored.has(key), false); assert.equal(f.requests.length, 0);
  assert.doesNotMatch(f.html(), /type="submit"/);
  assert.match(f.html(), /does not qualify for free entry/);
  f.click("Request free club transport"); await f.submit();
  assert.equal(f.requests.length, 1); assert.equal(JSON.parse(f.stored.get(key)).transportation, "club_shuttle");
});

test("ineligible arrival leaves another venue's selection intact", () => {
  const f = client(); const previous = JSON.stringify({ venueId: "other-venue" }); f.stored.set(key, previous);
  f.select("rideshare_taxi"); assert.equal(f.stored.get(key), previous);
});

test("failed and unavailable pickup requests cannot prepare admission", async () => {
  for (const [props, options] of [[{ shuttleAvailable: false }, {}], [{}, { accepted: false }]]) {
    const f = client({ initialTransportation: "club_shuttle", ...props }, options);
    await f.submit(); assert.equal(f.stored.has(key), false); assert.doesNotMatch(f.html(), /Awaiting club confirmation/);
    if (props.shuttleAvailable === false) assert.equal(f.requests.length, 0);
  }
});

test("blocked storage can recover the admission selection without repeating a sent pickup request", async () => {
  const f = client({ initialTransportation: "club_shuttle" }); f.blockStorage(true); await f.submit();
  assert.equal(f.stored.has(key), false); assert.match(f.html(), /Save deal for cashier/);
  f.blockStorage(false); f.click("Save deal for cashier");
  assert.equal(f.requests.length, 1); assert.equal(JSON.parse(f.stored.get(key)).shuttleRequestId, f.requests[0].body.requestId);
});

test("ride-only fallback never advertises or prepares unavailable admission", async () => {
  const f = client({ deal: undefined }); assert.match(f.html(), /Free entry is currently unavailable/);
  assert.doesNotMatch(f.html(), /Waymo|Zoox|Cybercab|name="transportation"/);
  await f.submit(); assert.equal(f.requests[0].url, `/api/venues/${venue.id}/shuttle`);
  assert.equal(f.stored.has(key), false);
});

test("ride page resolves an active venue deal and preserves the exact attributed offer", async () => {
  const calls = []; const filters = [];
  const api = load("../app/rides/[venueId]/page.tsx", {
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ from() { return {
      select() { return this; }, eq(...args) { filters.push(args); return this; }, not(...args) { filters.push(args); return this; }, maybeSingle: async () => ({ data: { ...venue, club_pickup_available: true } }),
    }; } }) },
    "@/src/lib/dancr/deals": {
      getActiveClubDealForVenue: async (_, id) => { calls.push(id); return deal; },
      getActiveClubDealByIdForVenue: async (_, id, requested) => { calls.push([id, requested]); return requested === deal.id ? deal : null; },
    },
    "@/src/lib/dancr/public-club-deal": { toPublicClubDeal: value => value },
    "@/src/lib/dancr/uber": { formatPublicVenueAddress },
    "@/src/lib/dancr/club-shuttle-requests": { getClubShuttleRecipientIds: async () => ["owner"] },
    "@/app/deals/transportation/[dealId]/TransportationClient": { default: "transportation" },
  });
  const run = query => api.default({ params: Promise.resolve({ venueId: venue.id }), searchParams: Promise.resolve(query) });
  const direct = await run({}); assert.equal(direct.props.deal.id, deal.id); assert.equal(direct.props.initialTransportation, "club_shuttle");
  assert.equal(direct.props.pickupAvailable, true);
  assert.equal(direct.props.venue.address, venue.address);
  const attributed = await run({ dealId: deal.id, sourceType: "dancer_profile", dancerId: "dancer", attributionToken: "signed-token" });
  assert.deepEqual(calls[1], [venue.id, deal.id]); assert.equal(attributed.props.attributionToken, "signed-token");
  assert.equal(attributed.props.sourceType, "dancer_profile");
  assert.ok(filters.some(([key, value]) => key === "page_review_status" && value === "published"));
  assert.ok(filters.some(([key, value]) => key === "is_active" && value === true));
  await assert.rejects(run({ dealId: venue.id }), /NOT_FOUND/);
  await assert.rejects(run({ dealId: "invalid" }), /NOT_FOUND/);
  assert.equal((await run({ sourceType: "dancer_profile", attributionToken: "injected" })).props.sourceType, "club_page");
});

test("free-entry page supplies the public destination while retaining venue publication filters", async () => {
  const filters = [], selections = []; let pickupAvailable = false;
  const api = load("../app/deals/transportation/[dealId]/page.tsx", {
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ from() { return {
      select(value) { selections.push(value); return this; }, eq(...args) { filters.push(args); return this; }, not(...args) { filters.push(args); return this; },
      maybeSingle: async () => ({data:{...venue,address:"123 Test Rd",owner_user_id:"private-owner",phone:"private-phone",club_pickup_available:pickupAvailable}}),
    }; } }) },
    "@/src/lib/dancr/deals": { getActiveClubDealById: async () => deal },
    "@/src/lib/dancr/public-club-deal": { toPublicClubDeal: value => value },
    "@/src/lib/dancr/club-shuttle-requests": { getClubShuttleRecipientIds: async () => ["owner"] },
    "@/src/lib/dancr/uber": { formatPublicVenueAddress },
    "./TransportationClient": { default: "transportation" },
  });
  const result = await api.default({params:Promise.resolve({dealId:deal.id}),searchParams:Promise.resolve({})});
  assert.equal(result.props.pickupAvailable, false);
  pickupAvailable = true;
  assert.equal((await api.default({params:Promise.resolve({dealId:deal.id}),searchParams:Promise.resolve({})})).props.pickupAvailable, true);
  assert.equal(result.props.venue.address, venue.address);
  assert.deepEqual(Object.keys(result.props.venue).sort(), ["address","id","name","slug"]);
  assert.match(selections[0], /address, city, state/);
  assert.match(selections[0], /club_pickup_available/);
  assert.ok(filters.some(([key,value]) => key === "is_active" && value === true));
  assert.ok(filters.some(([key,value]) => key === "page_review_status" && value === "published"));
  assert.ok(filters.some(([key,operator,value]) => key === "published_at" && operator === "is" && value === null));
});
