import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";
import { readBoundedFormData } from "../src/lib/bounded-form-data.ts";
import { PublicApiError } from "../src/lib/api-error-policy.ts";
import { MAX_DANCR_RAW_UPLOAD_BYTES, validateAndPrepareDancrImage } from "../src/lib/dancr/image-validation.ts";

const code = ts.transpileModule(fs.readFileSync("app/api/dancer/photos/preview/route.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
class RateLimitError extends Error { retryAfterSeconds = 60; }

function route({ signedIn = true, ownsProfile = true, limited = false } = {}) {
  const events = [], exports = {};
  const client = { from(table) {
    assert.equal(table, "dancer_profiles");
    return { select(fields) {
      assert.equal(fields, "id");
      return { eq(column, value) {
        assert.equal(column, "user_id"); assert.equal(value, "signed-in-user");
        return { maybeSingle: async () => ({ data: ownsProfile ? { id: "own-profile" } : null, error: null }) };
      } };
    } };
  } };
  const modules = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    sharp,
    "@/src/lib/api": { PublicApiError, apiError: (error, fallback) => Response.json({ ok: false, error: fallback }, { status: error.status || 500 }) },
    "@/src/lib/bounded-form-data": { readBoundedFormData: async (...args) => { events.push("body"); return readBoundedFormData(...args); } },
    "@/src/lib/dancr/image-validation": { MAX_DANCR_RAW_UPLOAD_BYTES, validateAndPrepareDancrImage: async file => { events.push("decode"); return validateAndPrepareDancrImage(file); } },
    "@/src/lib/dancr/public-request-rate-limit": {
      PublicRequestRateLimitError: RateLimitError,
      enforcePublicRequestRateLimit: async (_admin, input) => { events.push("rate"); assert.equal(input.subject, "signed-in-user"); if (limited) throw new RateLimitError(); },
    },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => { assert.ok(signedIn); return client; } },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => {
      events.push("auth"); if (!signedIn) throw Object.assign(new Error("Sign in required."), { status: 401 });
      return { client: { from() { assert.fail("The private profile identifier requires the owner-scoped server lookup"); } }, user: { id: "signed-in-user" }, session: { accessToken: "test-session-only" } };
    } },
  };
  vm.runInNewContext(code, { exports, Blob, Buffer, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return { post: exports.POST, events };
}
function request(file) {
  const body = new FormData();
  if (file) body.set("file", file);
  return new Request("https://example.test/api/dancer/photos/preview", { method: "POST", body });
}

test("preview refuses anonymous and unrelated accounts before reading upload bytes", async () => {
  for (const [options, status] of [[{ signedIn: false }, 401], [{ ownsProfile: false }, 403], [{ limited: true }, 429]]) {
    const api = route(options), response = await api.post(request(new Blob(["untrusted"])));
    assert.equal(response.status, status);
    assert.ok(!api.events.includes("body") && !api.events.includes("decode"));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
  }
});

test("preview rejects missing files and spoofed image data", async () => {
  const api = route();
  assert.equal((await api.post(request())).status, 400);
  const response = await api.post(request(new Blob(["<svg onload=alert(1)></svg>"], { type: "image/jpeg" })));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).imageDataUrl, undefined);
});

test("preview honors EXIF orientation and sends a bounded private JPEG without publication", async () => {
  const input = await sharp({ create: { width: 3000, height: 1600, channels: 3, background: "#8351a2" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const api = route(), response = await api.post(request(new Blob([input], { type: "image/jpeg" })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const data = await response.json();
  assert.match(data.imageDataUrl, /^data:image\/jpeg;base64,/);
  const meta = await sharp(Buffer.from(data.imageDataUrl.split(",")[1], "base64")).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(meta.height > meta.width && meta.height <= 2560);
  assert.equal(meta.orientation, undefined);
  assert.deepEqual(api.events, ["auth", "rate", "body", "decode"]);
});

test("private previews decode PNG and WebP uploads and flatten transparency safely", async () => {
  for (const format of ["png", "webp"]) {
    const input = await sharp({ create: {
      width: 80, height: 120, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 },
    } })[format]().toBuffer();
    const response = await route().post(request(new Blob([input], { type: `image/${format}` })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const data = await response.json();
    const output = Buffer.from(data.imageDataUrl.split(",")[1], "base64");
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 80);
    assert.equal(metadata.height, 120);
    assert.equal(metadata.hasAlpha, false);
    const pixels = await sharp(output).raw().toBuffer();
    assert.ok(pixels.every(value => value <= 2), `${format}: transparent pixels should become black`);
  }
});
