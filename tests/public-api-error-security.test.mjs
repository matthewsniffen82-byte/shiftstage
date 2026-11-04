import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolveApiError } from "../src/lib/api-error-policy.ts";

for (const route of ["dancers", "dancers/[slug]", "venues", "venues/[slug]"]) {
  test(`public ${route} reads sanitize dependency errors without depending on display wording`, async () => {
    const source = readFileSync(new URL(`../app/api/public/${route}/route.ts`, import.meta.url), "utf8");
    const exports = {}, calls = [];
    const failure = Object.assign(new Error("synthetic-private-database-message"), { details: "synthetic-private-query", code: "XX000" });
    const fail = () => { calls.push("database"); throw failure; };
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, URL, require(name) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/src/lib/api") return { apiError(error, fallback, status) {
        assert.equal(error, failure);
        assert.equal(typeof fallback, "string");
        assert.ok(fallback.length > 0);
        assert.equal(status, 500);
        calls.push("sanitized");
        const result = resolveApiError(error, fallback, status);
        return Response.json(result.body, { status: result.status });
      } };
      if (name === "@/src/lib/supabase/admin") return { createAdminSupabaseClient: () => ({ from: fail }) };
      if (name === "@/src/lib/dancr/discovery-pagination") return { parseDiscoveryCursor: () => "", directoryVenue: () => undefined };
      if (name === "@/src/lib/dancr/public-directory") return { getRankedDirectoryPage: fail };
      if (name === "@/src/lib/dancr/public") return { getDancerProfile: fail, getVenueProfile: fail };
      if (name === "@/src/lib/dancr/public-request-rate-limit") return { PublicRequestRateLimitError: class extends Error {} };
      return {};
    } });
    const response = await exports.GET(new Request("https://www.mydancr.com/api/public/" + route), { params: Promise.resolve({ slug: "synthetic-profile" }) });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, "string");
    assert.doesNotMatch(JSON.stringify(body), /synthetic-private|XX000/);
    assert.deepEqual(calls, ["database", "sanitized"]);
  });
}
