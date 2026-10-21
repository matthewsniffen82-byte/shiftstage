import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as catalog from "../src/lib/dancr/operations-guides.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const source = readFileSync(new URL("../app/api/guides/route.ts", import.meta.url), "utf8");

function fixture({ role = "dancer", state = "active", venueRole = null, auth = true, dbError = null, membershipError = null, wrongAccount = false } = {}) {
  const calls = { files: [], privileged: 0, accountFilters: [], contexts: [] };
  const account = { id: wrongAccount ? "another-account" : "signed-in-account", role, account_state: state };
  const client = { from(table) {
    assert.equal(table, "app_users");
    return { select() { return this; }, eq(...args) { calls.accountFilters.push(args); return this; },
      async maybeSingle() { return { data: account, error: dbError }; } };
  } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, {
    exports, Request, Response, Headers, URL, Uint8Array, process: { cwd: () => "/workspace" },
    require(name) {
      if (name === "node:fs/promises") return { readFile: async file => { calls.files.push(file); return Buffer.from("%PDF-1.4\nfixture"); } };
      if (name === "node:path") return require(name);
      if (name === "next/server") return { NextResponse };
      if (name.endsWith("/api")) return { PublicApiError, apiError(error, fallback) {
        const resolved = resolveApiError(error, fallback); return NextResponse.json(resolved.body, { status: resolved.status });
      } };
      if (name.endsWith("/supabase/request")) return { createRequestSupabaseContext: async (_request, access) => {
        calls.contexts.push(access); if (!auth) throw new PublicApiError("AUTH_REQUIRED", "Sign in required.", 401);
        return { client, user: { id: "signed-in-account", user_metadata: { role: "admin" } }, session: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: 99999999 } };
      } };
      if (name.endsWith("/supabase/admin")) return { createAdminSupabaseClient: () => { calls.privileged++; return {}; } };
      if (name.endsWith("/session-transport")) return { SESSION_RESPONSE_HEADERS: { access: "x-dancr-session-access", refresh: "x-dancr-session-refresh", expires: "x-dancr-session-expires" } };
      if (name.endsWith("/venue-access")) return { getVenueAccess: async () => {
        if (membershipError) throw membershipError;
        return venueRole ? { role: venueRole, venueName: "Training Club" } : null;
      } };
      if (name.endsWith("/operations-guides")) return catalog;
      throw new Error("Unexpected import " + name);
    },
  });
  return { calls, get: id => exports.GET(new Request("https://www.mydancr.com/api/guides" + (id === undefined ? "" : "?document=" + encodeURIComponent(id)))) };
}

test("dancers receive only dancer PDFs, including when user-editable metadata claims admin", async () => {
  const f = fixture();
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).documents, ["dancer-guide", "dancer-cheat-sheet"]);
  for (const document of catalog.GUIDE_DOCUMENTS.filter(d => d.role !== "dancer")) assert.equal((await f.get(document.id)).status, 403);
  assert.equal(f.calls.files.length, 0); assert.equal(f.calls.privileged, 0);
  assert.ok(f.calls.accountFilters.every(([column, value]) => column === "id" && value === "signed-in-account"));
});

test("an active dancer can download both dancer handouts", async () => {
  const f = fixture();
  for (const id of ["dancer-guide", "dancer-cheat-sheet"]) {
    const response = await f.get(id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(await response.text(), /^%PDF/);
  }
  assert.equal(f.calls.files.length, 2);
});

for (const options of [{ role: "venue", venueRole: "owner" }, { role: "venue", venueRole: "manager" }, { role: "admin" }]) {
  test(`active ${options.venueRole || options.role} can obtain each guide through checked downloads`, async () => {
    const f = fixture(options);
    const response = await f.get();
    assert.equal((await response.json()).documents.length, 10);
    for (const doc of catalog.GUIDE_DOCUMENTS) {
      const pdf = await f.get(doc.id);
      assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.match(pdf.headers.get("content-disposition"), /attachment; filename="MyDancr_.+\.pdf"/);
      assert.match(pdf.headers.get("cache-control"), /private, no-store/);
      assert.equal(pdf.headers.get("x-dancr-session-access"), "synthetic-access");
      assert.match(await pdf.text(), /^%PDF/);
    }
    assert.equal(f.calls.files.length, 10);
  });
}

for (const options of [{ role: "customer" }, { role: "venue", venueRole: "staff" }, { role: "venue" }, { role: "admin", state: "disabled" }, { role: "dancer", state: "paused" }, { auth: false }, { wrongAccount: true }, { dbError: new Error("Unavailable") }, { role: "venue", membershipError: new Error("Unavailable") }]) {
  test(`restricted or unavailable access never reads private PDFs: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    for (const doc of catalog.GUIDE_DOCUMENTS) {
      const response = await f.get(doc.id);
      assert.notEqual(response.status, 200);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
    }
    assert.equal(f.calls.files.length, 0);
  });
}

test("unknown IDs and traversal attempts cannot select a filesystem path", async () => {
  const f = fixture({ role: "admin" });
  for (const id of ["", "../.env.local", "../../MyDancr_Operations_Manual.pdf", "constructor", "__proto__", "dancer-guide/../../secret", "MyDancr_Operations_Manual.pdf"]) {
    assert.equal((await f.get(id)).status, 404);
  }
  assert.equal(f.calls.files.length, 0);
});

test("the catalog points to complete PDFs outside the public directory", () => {
  assert.equal(new Set(catalog.GUIDE_DOCUMENTS.map(d => d.id)).size, 10);
  for (const doc of catalog.GUIDE_DOCUMENTS) {
    const pdf = readFileSync(new URL(`../output/pdf/mydancr-operations/${doc.file}`, import.meta.url));
    assert.equal(pdf.subarray(0,4).toString(), "%PDF");
    assert.match(pdf.subarray(-30).toString(), /%%EOF/);
    assert.ok(!existsSync(new URL(`../public/${doc.file}`, import.meta.url)));
  }
});

test("download page renders four role choices with accessible download names before sign-in", () => {
  const exports = {};
  const React = require("react");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/guides/GuidesClient.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name.endsWith("/operations-guides")) return catalog;
    if (name.includes("dashboard-session") || name.includes("browser-session")) return {};
    throw new Error("Unexpected dependency " + name);
  } });
  const html = require("react-dom/server").renderToStaticMarkup(React.createElement(exports.default));
  assert.equal((html.match(/class="guide-card"/g) || []).length, 4);
  for (const role of catalog.GUIDE_ROLES) assert.ok(html.includes(`Download ${role.title.replaceAll("&", "&amp;")} onboarding guide`));
  assert.ok(html.includes("mailto:support@mydancr.com"));
});
