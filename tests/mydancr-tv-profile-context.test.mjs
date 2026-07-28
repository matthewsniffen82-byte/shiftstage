import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [tvService, dancerStudio] = await Promise.all([
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
]);

test("the dancer TV studio identifies and links its real public profile", () => {
  assert.match(
    tvService,
    /profile:\s*\{\s*stageName:\s*dancer\.stage_name,\s*slug:\s*dancer\.slug,\s*\}/,
  );
  assert.match(
    dancerStudio,
    /<h2>[\s\S]*?MyDancr TV[\s\S]*?href=\{`\/dancers\/\$\{encodeURIComponent\(workspace\.profile\.slug\)\}`\}[\s\S]*?\{workspace\.profile\.stageName\}[\s\S]*?<\/h2>/,
  );
  assert.match(
    dancerStudio,
    /Videos published here appear on your public \{workspace\.profile\.stageName\} profile\./,
  );
});
