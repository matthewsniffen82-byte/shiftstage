import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { safeLocalReturnPath } from "../src/lib/dancr/safe-return-path.ts";
import { publicAppUrl } from "../src/lib/dancr/public-app-url.ts";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const homeStart = home.indexOf("    function safeLocalReturnPath(value)");
const homeEnd = home.indexOf("    function accountLoginDestination", homeStart);
assert.ok(homeStart > 0 && homeEnd > homeStart);
const homeContext = { URL };
vm.runInNewContext(home.slice(homeStart, homeEnd), homeContext);
const outsidePaths = [
  "/a/..//outside.example/path", "/a/%2e%2e//outside.example/path", "/.//outside.example/path",
  "/a/.%2E//outside.example/path", "/a/%2E.//outside.example/path", "/a/..///outside.example/path",
  "/a/b/../../%2foutside.example/path", "/a/../%5coutside.example/path",
];
for (const [name, validate] of [["shared", safeLocalReturnPath], ["homepage", homeContext.safeLocalReturnPath]]) {
  for (const input of outsidePaths) test(`${name}: normalization cannot introduce an authority separator: ${input}`, () => {
    assert.equal(validate(input), "");
  });
  for (const input of ["/dashboard/venue?tab=team#invite", "/nfc/synthetic", "/deals/claim/synthetic", "/a/../dashboard/dancer", "/?city=Las%20Vegas&view=venues", "/venue//local-path"]) {
    test(`${name}: ordinary local navigation remains valid: ${input}`, () => {
      const result = validate(input);
      assert.ok(result);
      assert.equal(new URL(result, "https://www.mydancr.com").origin, "https://www.mydancr.com");
      assert.equal(validate(result), result, "accepted destinations are stable when revalidated");
    });
  }
}

// Execute the actual route functions without loading credentials or calling Auth.
const auth = readFileSync(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("auth.ts", auth, ts.ScriptTarget.Latest, true);
const names = new Set(["safeEmailRedirectTo", "allowedAuthRedirectOrigins", "readOptional"]);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const emailContext = { URL, publicAppUrl: () => publicAppUrl({ NODE_ENV: "production" }) };
vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, emailContext);
const fallback = "https://www.mydancr.com/auth/callback";
for (const input of [
  "https://www.mydancr.com/auth/callback-extra", "https://www.mydancr.com/auth/callback/elsewhere",
  "https://name@www.mydancr.com/auth/callback?role=dancer", "https://name:synthetic@www.mydancr.com/auth/callback",
  "https://www.mydancr.com/auth/callback#injected-fragment", "https://outside.example/auth/callback",
  "https://www.mydancr.com.outside.example/auth/callback", "https://www.mydancr.com:8443/auth/callback",
  "javascript:alert(1)", "data:text/html,synthetic", "//www.mydancr.com/auth/callback", "/auth/callback",
]) test(`email callbacks reject unexpected destinations: ${input}`, () => {
  assert.equal(emailContext.safeEmailRedirectTo(input), fallback);
});
for (const origin of ["https://www.mydancr.com", "https://mydancr.com", "https://shiftstage.vercel.app"]) {
  test(`email callback query data is preserved on the existing trusted origin: ${origin}`, () => {
    const input = `${origin}/auth/callback?dancr_reset=1&role=dancer&return_to=%2Fnfc%2Fsynthetic&resume=synthetic`;
    assert.equal(emailContext.safeEmailRedirectTo(input), input);
  });
}


for (const configuredOrigin of ["https://dancr-recovery-example.vercel.app", "http://localhost:3000"]) {
  const isolatedContext = { URL, publicAppUrl: () => configuredOrigin };
  vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, isolatedContext);
  const isolatedFallback = `${configuredOrigin}/auth/callback`;

  test(`account email callbacks stay within their isolated or local site: ${configuredOrigin}`, () => {
    const ownCallback = `${isolatedFallback}?dancr_reset=1&role=dancer&return_to=%2Fdashboard%2Fdancer`;
    assert.equal(isolatedContext.safeEmailRedirectTo(ownCallback), ownCallback);
    assert.equal(isolatedContext.safeEmailRedirectTo(undefined), isolatedFallback);
    for (const otherOrigin of ["https://www.mydancr.com", "https://mydancr.com", "https://shiftstage.vercel.app", "https://another-rehearsal.vercel.app"]) {
      assert.equal(isolatedContext.safeEmailRedirectTo(`${otherOrigin}/auth/callback?dancr_reset=1`), isolatedFallback);
    }
  });
}

test("an invalid isolated deployment never falls back to a live account email callback", () => {
  const invalidContext = {
    URL,
    publicAppUrl: () => publicAppUrl({ DANCR_ISOLATED_SUPABASE_REF: "" }),
  };
  vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, invalidContext);
  assert.throws(() => invalidContext.safeEmailRedirectTo("https://www.mydancr.com/auth/callback"), /Invalid isolated application configuration/);
});
