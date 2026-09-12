import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { refreshExpiringRequestSession, SESSION_RESPONSE_HEADERS } from "../src/lib/supabase/session-transport.ts";
import { resolveApiError } from "../src/lib/api-error-policy.ts";
import * as documentPolicy from "../src/lib/security/document-content-security-policy.mjs";

const token = claims => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const request = claims => new Request("https://www.mydancr.com/api/account", {
  headers: { authorization: `Bearer ${token(claims)}`, "x-dancr-refresh-token": "synthetic-refresh" },
});

for (const claims of [null, false, 0, "text", [], {}, { exp: "0", sub: "account-a" }, { exp: 0, sub: null }]) {
  test("invalid refresh scheduling claims do not cause an outage or contact the provider: " + JSON.stringify(claims), async () => {
    let calls = 0;
    const result = await refreshExpiringRequestSession(request(claims), async () => { calls++; throw new Error("Unexpected provider request"); });
    assert.equal(result, null);
    assert.equal(calls, 0);
  });
}

test("middleware forwards malformed scheduling claims to normal authentication without rotating credentials", async () => {
  const { NextResponse, NextRequest } = createRequire(import.meta.url)("next/server");
  const exports = {};
  let calls = 0;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Headers, require(name) {
    if (name === "next/server") return { NextResponse };
    if (name.includes("document-content-security-policy")) return documentPolicy;
    if (name.includes("api-error-policy")) return { resolveApiError };
    if (name.includes("session-transport")) return { SESSION_RESPONSE_HEADERS,
      refreshExpiringRequestSession: request => refreshExpiringRequestSession(request, async () => { calls++; throw new Error("Unexpected provider request"); }),
    };
    throw new Error("Unexpected dependency");
  } });
  const incoming = new NextRequest(request(null));
  const response = await exports.middleware(incoming);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("x-middleware-request-authorization"), incoming.headers.get("authorization"));
  assert.equal(response.headers.get(SESSION_RESPONSE_HEADERS.access), null);
  assert.equal(response.headers.get(SESSION_RESPONSE_HEADERS.refresh), null);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(calls, 0);
});
