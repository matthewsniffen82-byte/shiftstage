import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "../app/api/venue/team/route.ts",
  "../app/api/venue/team/invitations/route.ts",
  "../app/api/venue/profile/route.ts",
  "../app/api/venue/publication/route.ts",
  "../app/api/venue/deal-requests/route.ts",
  "../app/api/venue/nfc-support/route.ts",
  "../app/api/venue/access-code/preview/route.ts",
  "../app/api/venue/signup-requests/route.ts",
];
const sources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("venue and venue-onboarding JSON writes stream-bound their request bodies", () => {
  for (const [index, source] of sources.entries()) {
    assert.match(source, /readBoundedJsonObject\(request, \{/, routePaths[index]);
    assert.doesNotMatch(source, /request\.json\(/, routePaths[index]);
  }
});

test("public venue access codes have explicit field and body limits", () => {
  const accessPreview = sources[6];
  assert.match(accessPreview, /MAX_ACCESS_CODE_BODY_BYTES = 2_048/);
  assert.match(accessPreview, /code\.length > 256/);
});
