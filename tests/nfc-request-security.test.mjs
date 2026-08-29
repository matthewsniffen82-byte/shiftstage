import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/nfc/[token]/route.ts", import.meta.url),
  "utf8",
);

test("NFC tap requests reject oversized bodies before processing", () => {
  assert.match(route, /const MAX_NFC_BODY_BYTES = 4_096/);
  assert.match(route, /declaredLength > MAX_NFC_BODY_BYTES/);
  assert.match(route, /raw\.length > MAX_NFC_BODY_BYTES/);
  assert.match(route, /"Tap request is too large\.", 413/);
  assert.match(route, /if \(error instanceof PublicApiError\) throw error/);
});

test("NFC tap requests preserve the strict session and tag boundaries", () => {
  assert.match(route, /UUID_PATTERN\.test\(sessionId\)/);
  assert.match(route, /resolveNfcTag\(admin, token\)/);
  assert.match(route, /account\?\.role !== "dancer"/);
  assert.match(route, /completeCashierDealRedemption\(admin, \{/);
});
