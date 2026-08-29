import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [auth, recovery] = await Promise.all([
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/account-recovery/route.ts", import.meta.url), "utf8"),
]);

test("public authentication and recovery bodies are stream bounded", () => {
  assert.match(auth, /const MAX_AUTH_BODY_BYTES = 8_192/);
  assert.match(auth, /readBoundedJsonObject\(request, \{/);
  assert.match(auth, /maxBytes: MAX_AUTH_BODY_BYTES/);
  assert.doesNotMatch(auth, /request\.json\(/);

  assert.match(recovery, /const MAX_RECOVERY_BODY_BYTES = 4_096/);
  assert.match(recovery, /readBoundedJsonObject\(request, \{/);
  assert.match(recovery, /maxBytes: MAX_RECOVERY_BODY_BYTES/);
  assert.doesNotMatch(recovery, /request\.json\(/);
});

test("login and signup attempts have durable keyed throttles", () => {
  assert.match(auth, /enforceAuthAttemptRateLimit\(request, mode, role, email\)/);
  assert.match(auth, /namespace: `auth_\$\{mode\}`/);
  assert.match(auth, /subject: `\$\{role\}:\$\{email\}`/);
  assert.match(auth, /error instanceof PublicRequestRateLimitError/);
  assert.match(auth, /status: 429/);
});

test("admin signup secrets use constant-time comparison and auth failures stay private", () => {
  assert.match(auth, /createHash\("sha256"\)\.update\(expected\)\.digest\(\)/);
  assert.match(auth, /timingSafeEqual\(expectedDigest, providedDigest\)/);
  assert.match(auth, /isAuthError\(error\)/);
  assert.match(auth, /Email or password is incorrect\./);
  assert.match(auth, /return apiError\(error, "Unable to authenticate\."\)/);
  assert.doesNotMatch(auth, /apiError\(error, "Unable to authenticate\.", 400\)/);
});
