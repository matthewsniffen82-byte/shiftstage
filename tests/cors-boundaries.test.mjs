import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import nextConfig from "../next.config.mjs";
import * as documentPolicy from "../src/lib/security/document-content-security-policy.mjs";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const { autoImplementMethods } = require("next/dist/server/route-modules/app-route/helpers/auto-implement-methods");
const origins = ["https://www.mydancr.com", "https://untrusted.example", "https://mydancr.com.untrusted.example", "null"];
const apiDirectory = new URL("../app/api/", import.meta.url);
const routes = readdirSync(apiDirectory, { recursive: true }).map(String).map(path => path.replaceAll("\\", "/")).filter(path => path.endsWith("/route.ts"));
const middlewareCode = ts.transpileModule(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function routeMethods(path) {
  const source = readFileSync(new URL(path + "/route.ts", apiDirectory), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(node.name?.text || "")).map(node => node.name.text);
}

function assertNoCorsGrant(headers) {
  for (const name of ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers"]) {
    assert.equal(headers.get(name), null, name + " requires explicit security review before cross-origin access is introduced");
  }
}

test("deployment and framework header rules preserve same-origin API access", async () => {
  for (const rule of await nextConfig.headers()) assertNoCorsGrant(new Headers(rule.headers.map(({ key, value }) => [key, value])));
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const rule of vercel.headers || []) assertNoCorsGrant(new Headers(rule.headers.map(({ key, value }) => [key, value])));
});

test("API route inventory contains no unreviewed CORS grant or custom preflight handler", () => {
  assert.ok(routes.length > 100);
  for (const route of routes) {
    const source = readFileSync(new URL(route, apiDirectory), "utf8"), methods = routeMethods(route.slice(0, -"/route.ts".length));
    assert.ok(methods.length, route + " must have its exported methods reviewed");
    assert.ok(!methods.includes("OPTIONS"), route + " has a custom preflight requiring CORS review");
    assert.doesNotMatch(source, /access-control-(?:allow|expose)-/i, route + " has a CORS header requiring review");
  }
});

for (const path of ["account", "admin/venue-claim-codes", "dancer/profile", "dancer/photos", "venue/dashboard", "auth", "public/discovery", "stripe/webhook"]) {
  test(path + " preflights advertise methods without granting cross-origin access or running handlers", async () => {
    const methods = routeMethods(path), calls = [], exports = {};
    vm.runInNewContext(middlewareCode, { exports, Headers, require(name) {
      if (name === "next/server") return { NextResponse };
      if (name.includes("document-content-security-policy")) return documentPolicy;
      return { SESSION_RESPONSE_HEADERS: {}, async refreshExpiringRequestSession() { calls.push("refresh"); throw new Error("A browser preflight must not refresh sessions"); } };
    } });
    const handlers = Object.fromEntries(methods.map(method => [method, () => { calls.push(method); throw new Error("Preflight must not run a route handler"); }]));
    const implemented = autoImplementMethods(handlers);
    for (const origin of origins) {
      const request = new NextRequest("https://www.mydancr.com/api/" + path, { method: "OPTIONS", headers: {
        origin, "access-control-request-method": methods.includes("POST") ? "POST" : methods[0],
        "access-control-request-headers": "authorization,content-type,x-dancr-refresh-token",
      } });
      const middlewareResponse = await exports.middleware(request), response = await implemented.OPTIONS(request);
      assertNoCorsGrant(middlewareResponse.headers); assertNoCorsGrant(response.headers);
      assert.equal(response.status, 204); assert.equal(await response.text(), "");
      const allow = response.headers.get("allow").split(/,\s*/);
      for (const method of methods) assert.ok(allow.includes(method));
      assert.ok(allow.includes("OPTIONS"));
      assert.deepEqual(calls, []);
    }
  });
}
