import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "../app/api/dancer/profile/route.ts",
  "../app/api/dancer/profile/visibility/route.ts",
  "../app/api/dancer/photos/route.ts",
  "../app/api/dancer/tv/videos/route.ts",
  "../app/api/dancer/tv/videos/[id]/route.ts",
];
const sources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("dancer JSON writes stream-bound profile and media request bodies", () => {
  for (const [index, source] of sources.entries()) {
    assert.match(source, /readBoundedJsonObject\(request, \{/, routePaths[index]);
    assert.doesNotMatch(source, /request\.json\(/, routePaths[index]);
  }
});

test("retired dancer payouts reject requests without consuming a body", async () => {
  const finance = await readFile(new URL("../app/api/dancer/finance/route.ts", import.meta.url), "utf8");
  const post = finance.slice(finance.indexOf("export async function POST"));
  assert.match(post, /status: 410/);
  assert.doesNotMatch(post, /readBoundedJsonObject|request\.(json|text|formData)\(/);
});

test("dancer profile failures do not return internal provider or database codes", () => {
  const profile = sources[0];
  assert.match(profile, /error instanceof PublicApiError/);
  assert.doesNotMatch(profile, /errorCode: typeof error\?\.code/);
});

test("photo deletion validates the requested record identifier", () => {
  const photos = sources[2];
  assert.match(photos, /UUID_PATTERN\.test\(photoId\)/);
});
