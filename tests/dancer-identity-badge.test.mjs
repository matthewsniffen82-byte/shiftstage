import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function loadTs(file, suffix = "", dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file) + suffix, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, console: { warn() {} }, require: name => name === "react/jsx-runtime" ? require(name) : dependencies[name] || {} });
  return exports;
}
const service = loadTs("src/lib/dancr/public.ts", "\nexport { withIdentityVerification, buildDancerCard };", {
  "./responsive-image": { responsivePublicImage: () => null },
});
function verificationClient(records = [], failure = false) {
  const calls = [], filters = [];
  const query = {
    select(value) { calls.push(["select", value]); return this; },
    in(column, values) { calls.push(["in", column, [...values]]); filters.push(row => values.includes(row[column])); return this; },
    eq(column, value) { calls.push(["eq", column, value]); filters.push(row => row[column] === value); return this; },
    not(column, operator, value) { calls.push(["not", column, operator, value]); filters.push(row => row[column] != null); return this; },
    then(resolve, reject) {
      if (failure === "throw") return Promise.reject(new Error("unavailable")).then(resolve, reject);
      return Promise.resolve({ error: failure ? { message: "unavailable" } : null,
        data: records.filter(row => filters.every(filter => filter(row))).map(({ user_id }) => ({ user_id })) }).then(resolve, reject);
    },
  };
  return { calls, client: { from(table) { calls.push(["from", table]); return query; } } };
}

test("only completed Ondato checks grant a badge, independently of profile or club approval", async () => {
  const records = [
    { user_id: "verified", provider: "ondato", status: "verified", verified_at: "2026-10-30T12:00:00Z" },
    ...["not_started", "pending", "in_review", "declined", "expired"].map(status => ({ user_id: status, provider: "ondato", status, verified_at: null })),
    { user_id: "other-provider", provider: "didit", status: "verified", verified_at: "2026-10-30T12:00:00Z" },
    { user_id: "incomplete", provider: "ondato", status: "verified", verified_at: null },
  ];
  const fixture = verificationClient(records);
  const rows = [...records, { user_id: "not-required" }, { user_id: "club-approved" }].map(({ user_id }) => ({
    user_id, status: "approved", verification_status: "approved", identity_verified: true,
  }));
  const result = await service.withIdentityVerification(fixture.client, [...rows, rows[0]]);
  assert.deepEqual(Array.from(result, row => row.identity_verified), [true, false, false, false, false, false, false, false, false, false, true]);
  assert.deepEqual(fixture.calls.filter(([method]) => method === "select"), [["select", "user_id"]]);
  assert.equal(fixture.calls.filter(([method]) => method === "from").length, 1, "one batched query, never one query per dancer");
  assert.equal(fixture.calls.find(([method]) => method === "in")[2].length, rows.length, "duplicate IDs are removed");
});

test("verification outages hide badges without losing cards, and empty pages skip the query", async () => {
  for (const failure of [true, "throw"]) {
    const fixture = verificationClient([], failure);
    const [row] = await service.withIdentityVerification(fixture.client, [{ id: "dancer", user_id: "user", identity_verified: true }]);
    assert.equal(row.id, "dancer");
    assert.equal(row.identity_verified, false);
  }
  const fixture = verificationClient();
  assert.equal((await service.withIdentityVerification(fixture.client, [])).length, 0);
  assert.equal((await service.withIdentityVerification(fixture.client, [{ id: "no-owner" }]))[0].identity_verified, false);
  assert.equal(fixture.calls.length, 0);
});

test("public cards expose only the boolean, never verification records or account identifiers", () => {
  const row = { id: "dancer", user_id: "private-user", stage_name: "Ty", slug: "ty", city: "Las Vegas",
    identity_verified: true, verified_at: "private-date", session_id: "private-session", document: { dateOfBirth: "private" }, dancer_photos: [] };
  const { card } = service.buildDancerCard({}, row);
  assert.equal(card.identityVerified, true);
  for (const key of ["user_id", "session_id", "verified_at", "document", "identity_verified"]) assert.equal(key in card, false);
  assert.equal(service.buildDancerCard({}, { ...row, identity_verified: undefined }).card.identityVerified, false);
});

function badgeFixture() {
  const handlers = {}, dialogs = [];
  const document = {
    addEventListener(type, callback, capture) { handlers[type] = { callback, capture }; },
    body: { append(dialog) { dialogs.push(dialog); } },
    createElement() {
      return { open: false, listeners: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, callback) { this.listeners[type] = callback; },
        showModal() { this.open = true; },
        close() { this.open = false; this.listeners.close(); },
      };
    },
  };
  const window = { document };
  vm.runInNewContext(read("public/dancer-identity-badge.js"), { window });
  vm.runInNewContext(read("public/dancer-grid-card.js"), { window });
  return { window, handlers, dialogs };
}

test("grid badges require an explicit boolean and remain outside both profile links", () => {
  const { window } = badgeFixture();
  const card = { id: "dancer", name: "Ty", reference: "ty", href: "/dancers/ty", compact: true, groupClass: "is-now", scheduleLabel: "Working now" };
  for (const identityVerified of [false, undefined, "true", 1]) {
    assert.doesNotMatch(window.MydancrDancerGrid.render({ ...card, identityVerified, verified: true }), /data-identity-verified-badge/);
  }
  const html = window.MydancrDancerGrid.render({ ...card, identityVerified: true });
  assert.match(html, /aria-label="ID verified\. Learn about verification"/);
  assert.equal((html.match(/href="\/dancers\/ty"/g) || []).length, 2);
  let links = 0;
  for (const tag of html.match(/<[^>]+>/g)) {
    if (/^<a\s/.test(tag)) links++;
    if (/^<\/a>/.test(tag)) links--;
    if (tag.includes("data-identity-verified-badge")) assert.equal(links, 0, "no button nested in a link");
  }
  assert.match(html, /home-dancer-grid-availability/);
});

test("tapping the badge opens one accessible explanation without navigation or analytics bubbling", () => {
  const { handlers, dialogs } = badgeFixture();
  let prevented = 0, stopped = 0, focused = 0;
  const button = { isConnected: true, focus() { focused++; } };
  const event = { target: { closest: () => button }, preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } };
  handlers.click.callback(event);
  assert.equal(handlers.click.capture, true);
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  assert.equal(dialogs[0].open, true);
  assert.equal(dialogs[0].attributes["aria-describedby"], "dancer-identity-description");
  assert.match(dialogs[0].innerHTML, /Identity and age 18\+ verified through Ondato\./);
  assert.match(dialogs[0].innerHTML, /method="dialog"/);
  dialogs[0].close();
  assert.equal(focused, 1);
  handlers.click.callback(event);
  assert.equal(dialogs.length, 1);
});

test("profile badges show only an icon with an accessible label and require successful verification", () => {
  const { DancerIdentityBadge } = loadTs("app/components/DancerIdentityBadge.tsx");
  assert.equal(DancerIdentityBadge({ verified: false }), null);
  assert.equal(DancerIdentityBadge({}), null);
  const { window } = badgeFixture();
  for (const html of [renderToStaticMarkup(DancerIdentityBadge({ verified: true })), window.MydancrIdentityBadge.markup(true, true)]) {
    assert.equal(html.replace(/<[^>]+>/g, "").trim(), "", "the visible badge contains no wording");
    assert.match(html, /<svg[^>]+aria-hidden="true"/);
    assert.match(html, /aria-label="ID verified\. Learn about verification"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /type="button"/);
  }
});
