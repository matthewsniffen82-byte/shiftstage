import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [limiter, photos, avatar, videos, videoAction] = await Promise.all([
  readFile(new URL("../src/lib/dancr/media-request-rate-limit.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/photos/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/avatar/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/tv/videos/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/tv/videos/[id]/route.ts", import.meta.url), "utf8"),
]);

test("authenticated media uploads use persistent per-user and per-IP limits", () => {
  assert.match(limiter, /enforcePublicRequestRateLimit/);
  assert.match(limiter, /subject: input\.userId/);
  assert.match(limiter, /windowSeconds: 60 \* 60/);

  for (const source of [photos, avatar, videos, videoAction]) {
    const authIndex = source.indexOf("createRequestSupabaseContext(request)");
    const limitIndex = source.indexOf("enforceDancerMediaRequestRateLimit", authIndex);
    assert.ok(authIndex >= 0);
    assert.ok(limitIndex > authIndex);
    assert.match(source, /status: 429/);
    assert.match(source, /retry-after/);
  }
});
