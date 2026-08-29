import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "../app/api/dancer/avatar/route.ts",
  "../app/api/dancer/photos/route.ts",
  "../app/api/venue/cover-image/route.ts",
  "../app/api/venue/logo-image/route.ts",
  "../app/api/admin/venues/media/route.ts",
];
const sources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("all multipart image uploads stream-bound the complete request before parsing", () => {
  for (const [index, source] of sources.entries()) {
    assert.match(source, /readBoundedFormData\(request, \{/, routePaths[index]);
    assert.doesNotMatch(source, /request\.formData\(/, routePaths[index]);
    assert.match(source, /MAX_DANCR_RAW_UPLOAD_BYTES \+ 64 \* 1024/, routePaths[index]);
  }
});

test("all multipart image uploads authenticate before consuming their bodies", () => {
  for (const [index, source] of sources.entries()) {
    const authBoundary = index === 4 ? "requireAdmin(" : "createRequestSupabaseContext(request)";
    assert.ok(source.indexOf(authBoundary) < source.indexOf("readBoundedFormData(request"), routePaths[index]);
  }
});
