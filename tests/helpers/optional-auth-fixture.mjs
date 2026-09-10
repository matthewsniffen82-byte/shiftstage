import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../../src/lib/bounded-json-body.ts";

const require = createRequire(import.meta.url);
export const verifiedUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const resourceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const paths = {
  going: "app/api/customer/going/route.ts",
  activity: "app/api/deals/redemptions/[token]/events/route.ts",
  analytics: "app/api/events/route.ts",
  report: "app/api/reports/route.ts",
  cashier: "src/lib/dancr/cashier-deal-redemption.ts",
};

function load(path, dependencies) {
  const source = process.env.OPTIONAL_AUTH_BASELINE === "1"
    ? execFileSync("git", ["show", "HEAD:" + path], { encoding: "utf8", windowsHide: true })
    : readFileSync(new URL("../../" + path, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Error, Date, URL, Request, Response, Headers, process,
    console: { info() {}, warn() {}, error() {} },
    require(name) {
      if (name === "node:crypto" || name === "next/server") return require(name);
      assert.ok(name in dependencies, "Unexpected dependency: " + name);
      return dependencies[name];
    },
  });
  return exports;
}

export function optionalAuthHarness(kind, options = {}) {
  const writes = [], queries = [], authCalls = [];
  const client = {
    auth: {
      async getUser(token) {
        authCalls.push(token);
        if (options.authThrow) throw options.authThrow;
        return { data: { user: options.authError || options.noUser ? null : { id: verifiedUserId } }, error: options.authError || null };
      },
    },
    from(table) {
      let inserted = null;
      const filters = [];
      const q = {
        select: () => q,
        eq(key, value) { filters.push([key, value]); return q; },
        is: () => q, gt: () => q, gte: () => q,
        insert(value) { inserted = value; return q; },
        maybeSingle: execute, single: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        queries.push({ table, filters });
        if (inserted) {
          writes.push({ table, value: inserted });
          return { data: { id: resourceId, ...inserted }, error: null };
        }
        if (table === "app_users") return {
          data: options.noAccount ? null : { role: options.role || "customer", account_state: options.state || "active" },
          error: options.accountError || null,
        };
        if (table === "shifts") return { data: { id: resourceId, status: "posted", ends_at: "2099-01-01T00:00:00Z", dancer_profiles: {} }, error: null };
        if (table === "going_signals") return { count: 2, error: null };
        if (table === "dancer_profiles") return { data: { id: resourceId }, error: null };
        throw new Error("Unexpected table: " + table);
      }
      return q;
    },
  };
  const requestApi = load("src/lib/supabase/request.ts", {
    "@supabase/supabase-js": { createClient: () => client },
    "../env.ts": { getPublicEnv: () => ({ supabaseUrl: "https://example.invalid", supabaseAnonKey: "synthetic-public-key" }) },
    "../api-error-policy.ts": { PublicApiError },
    "./bounded-fetch.ts": { boundedSupabaseFetch() { throw new Error("No network expected"); } },
  });
  const rate = { PublicRequestRateLimitError: class extends Error {}, enforcePublicRequestRateLimit: async () => {} };
  const action = identity => { writes.push({ identity }); return { id: resourceId, status: "redeemed" }; };
  const redemptionActions = {
    enforceDealGenerationRateLimit: async () => {},
    issueAndConfirmDealRedemptionFromNfc: async (_client, input) => action(input.customerId),
    recordDealRedemptionEvent: async (_client, _token, _type, _request, input) => action(input.actorUserId),
  };
  const actionModule = load(paths[kind], {
    "@/src/lib/api": { PublicApiError, apiError(error, fallback, status) {
      const result = resolveApiError(error, fallback, status);
      return Response.json(result.body, { status: result.status });
    } },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/security/browser-mutation": { requireSameOriginJsonMutation: () => {} },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => client },
    "@/src/lib/supabase/request": requestApi,
    "../supabase/request": requestApi,
    "@/src/lib/dancr/public-request-rate-limit": rate,
    "@/src/lib/dancr/resource-authorization": {},
    "@/src/lib/dancr/profile-approval": { isPublicDancerProfileEligible: () => true },
    "@/src/lib/dancr/customer": {
      markGoing: async (_client, id) => action(id), cancelGoing: async (_client, id) => action(id),
      markAnonymousGoing: async () => action(null), cancelAnonymousGoing: async () => action(null),
    },
    "@/src/lib/dancr/deal-redemption-actions": redemptionActions,
    "./deal-redemption-actions": redemptionActions,
    "./deal-redemption-attribution": { resolveDealRedemptionAttribution: async () => ({ sourceType: "venue_profile", dancerId: null, shiftId: null }) },
    "./deals": { getActiveClubDealByIdForVenue: async () => ({ id: resourceId, dealTitle: "Synthetic deal" }) },
    "../api-error-policy": { PublicApiError },
  });
  async function run({ bearer = true, method = "POST" } = {}) {
    const payload = kind === "analytics" ? { type: "profile_view", dancerId: resourceId }
      : kind === "report" ? { targetType: "contact_message", targetLabel: "Synthetic contact", reason: "Spam" }
      : kind === "activity" ? { eventType: "shared" } : { shiftId: resourceId, going: true };
    const request = new Request("https://www.mydancr.com/api/synthetic?shiftId=" + resourceId, {
      method, headers: { "content-type": "application/json", ...(bearer ? { authorization: "Bearer synthetic-browser" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
    });
    if (kind === "cashier") {
      try {
        await actionModule.completeCashierDealRedemption(client, { request, dealId: resourceId, venueId: resourceId, nfcTagId: resourceId, sourceType: "venue_profile", sessionId: resourceId });
        return Response.json({ ok: true });
      } catch (error) {
        const resolved = resolveApiError(error, "Unable to redeem.");
        return Response.json(resolved.body, { status: resolved.status });
      }
    }
    return method === "GET" ? actionModule.GET(request) : actionModule.POST(request, { params: Promise.resolve({ token: "a".repeat(40) }) });
  }
  return { run, writes, queries, authCalls, requestApi };
}
