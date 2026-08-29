import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeLocalReturnPath } from "../src/lib/dancr/safe-return-path.ts";

const [accountSource, callbackSource, liveAppSource] = await Promise.all([
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("return destinations remain on the current MyDancr origin", () => {
  assert.equal(safeLocalReturnPath("/dashboard/venue?tab=team#invite"), "/dashboard/venue?tab=team#invite");
  assert.equal(safeLocalReturnPath("/\\evil.example/path"), "");
  assert.equal(safeLocalReturnPath("//evil.example/path"), "");
  assert.equal(safeLocalReturnPath("/%2fevil.example/path"), "");
  assert.equal(safeLocalReturnPath("/%5cevil.example/path"), "");
  assert.equal(safeLocalReturnPath("https://evil.example/path"), "");
  assert.equal(safeLocalReturnPath("javascript:alert(1)"), "");
});

test("every authentication return path uses strict local validation", () => {
  assert.match(accountSource, /import \{ safeLocalReturnPath \} from "@\/src\/lib\/dancr\/safe-return-path"/);
  assert.equal((accountSource.match(/safeLocalReturnPath\(searchParams\.get\("return_to"\)\)/g) || []).length, 3);
  assert.match(callbackSource, /import \{ safeLocalReturnPath \} from "@\/src\/lib\/dancr\/safe-return-path"/);
  assert.equal((callbackSource.match(/safeLocalReturnPath\(url\.searchParams\.get\("return_to"\)\)/g) || []).length, 2);
  assert.match(liveAppSource, /function safeLocalReturnPath\(value\)[\s\S]*?requested\.includes\("\\\\"\)[\s\S]*?destination\.origin !== base\.origin/);
  assert.match(liveAppSource, /const safeReturnTo = safeLocalReturnPath\(url\.searchParams\.get\("return_to"\)\)/);
  assert.doesNotMatch(accountSource, /requestedReturnTo\.startsWith\("\/"\)/);
  assert.doesNotMatch(liveAppSource, /requestedReturnTo\.startsWith\("\/"\)/);
});
