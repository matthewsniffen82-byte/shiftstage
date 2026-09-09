import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getAdminVenueRegistrations, mapApprovedVenue } from "../src/lib/dancr/admin-venue-registration.ts";

const submitted = {
  id: "request-1", matched_venue_id: "venue-1", venue_name: "Harbor Club",
  street_address: "123 Harbor Street", city: "Portland", state: "OR", postal_code: "97201",
  contact_name: "Sam Manager", contact_title: "Owner", contact_email: "business@example.com",
  contact_phone: "503-555-0123", login_email: "manager@example.com", website: "https://example.com",
  message: "Call after 3pm", submitted_at: "2026-09-08T08:00:00Z",
};
function fakeClient(rows, error = null) {
  const calls = [];
  const client = { from(table) {
    assert.equal(table, "venue_signup_requests");
    const query = {
      select(columns) { assert.doesNotMatch(columns, /password|code_digest|request_ip|access_code/); return this; },
      eq(column, value) { assert.equal(column, "status"); assert.equal(value, "approved"); return this; },
      in(column, ids) { assert.equal(column, "matched_venue_id"); calls.push(ids); return this; },
      order(column, options) { assert.equal(column, "submitted_at"); assert.equal(options.ascending, false); return Promise.resolve({data: rows, error}); },
    }; return query;
  } };
  return {client, calls};
}

test("approval response retains signup fields needed by the managed venue form", () => {
  const venue = mapApprovedVenue({id:"venue-1",name:submitted.venue_name,address:"123 Harbor Street, Portland, OR 97201",city:"Portland",state:"OR",phone:submitted.contact_phone,website:submitted.website,timezone:"America/Los_Angeles",latitude:0,longitude:0,opens_at:"18:00:00",closes_at:"02:00:00",is_active:false});
  assert.equal(venue.phone, submitted.contact_phone);
  assert.equal(venue.website, submitted.website);
  assert.equal(venue.timezone, "America/Los_Angeles");
  assert.equal(venue.latitude, 0);
  assert.equal(venue.opens_at, "18:00:00");
  assert.equal(venue.closes_at, "02:00:00");
  assert.equal(venue.isActive, false);
  assert.equal(mapApprovedVenue(null), null);
});

test("approved registration details stay attached to the exact venue after reload", async () => {
  const {client,calls} = fakeClient([submitted, {...submitted, id:"older-request",contact_name:"Previous contact"}]);
  const records = await getAdminVenueRegistrations(client, ["venue-1","venue-1"]);
  assert.deepEqual(calls, [["venue-1"]]);
  assert.equal(records.get("venue-1").contactName, "Sam Manager");
  assert.equal(records.get("venue-1").contactEmail, "business@example.com");
  assert.equal(records.get("venue-1").loginEmail, "manager@example.com");
  assert.equal(records.get("venue-1").postalCode, "97201");
  assert.equal(records.get("venue-1").message, "Call after 3pm");
  assert.equal(records.get("unrelated-venue"), undefined);
});

test("registration lookup skips empty rosters, batches large rosters, and surfaces failed reads", async () => {
  const {client,calls} = fakeClient([]);
  assert.equal((await getAdminVenueRegistrations(client, [])).size,0);
  assert.equal(calls.length,0);
  await getAdminVenueRegistrations(client,Array.from({length:201},(_,i)=>`venue-${i}`));
  assert.deepEqual(calls.map(ids=>ids.length),[200,1]);
  const unavailable = fakeClient(null,new Error("Database unavailable"));
  await assert.rejects(getAdminVenueRegistrations(unavailable.client,["venue-1"]),/Database unavailable/);
});

test("admin uses registration data both immediately after approval and on reload without replacing edited public fields", async () => {
  const [admin,ui] = await Promise.all([
    readFile(new URL("../src/lib/dancr/admin.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/admin/AdminClient.tsx",import.meta.url),"utf8"),
  ]);
  assert.match(admin,/getAdminVenueRegistrations\(client, venueIds\)/);
  assert.match(admin,/signup_request: registrations\.get\(String\(row\.id\)\) \|\| null/);
  assert.match(ui,/signup_request: data\.request \|\| request/);
  assert.match(ui,/aria-label="Venue registration details"/);
  assert.match(ui,/name="phone" defaultValue=\{asText\(venue\.phone\)\}/);
  assert.match(ui,/name="website" defaultValue=\{asText\(venue\.website\)\}/);
});
