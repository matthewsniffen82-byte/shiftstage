import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const warmup = source.slice(source.indexOf("function warmDashboardRoleTools("), source.indexOf("const PUBLIC_DISCOVERY_REFRESH_KEY"));
const code = ts.transpileModule(warmup, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

for (const [role, expected] of [
  ["customer", []],
  ["dancer", ["./DancerNfcPanel", "./DancerShiftManager"]],
  ["venue", ["./VenueNfcTagPanel", "./VenueTeamPanel", "./VenueTvPanel"]],
]) {
  test(`${role} warms only its own core tools without waiting for chunks`, async () => {
    const requested = [];
    let settled;
    const context = vm.createContext({
      require(name) { requested.push(name); throw new Error("offline chunk"); },
      Promise: { resolve: Promise.resolve.bind(Promise), allSettled(promises) { settled = Promise.allSettled(promises); return settled; } },
    });
    vm.runInContext(code, context);
    assert.equal(context.warmDashboardRoleTools(role), undefined);
    const results = await settled;
    assert.deepEqual(requested, expected);
    assert.ok(results.every(result => result.status === "rejected"));
    assert.ok(!requested.some(name => /TvStudio|MediaUploads/.test(name)), "closed editors stay deferred");
  });
}
