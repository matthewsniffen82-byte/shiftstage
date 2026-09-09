import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/openai-client.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function fixture(loadSdk) {
  const exports = {}, requested = [];
  vm.runInNewContext(compiled, { exports, require(name) {
    requested.push(name);
    if (name === "server-only") return {};
    if (name === "openai") return loadSdk();
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return { exports, requested };
}

test("importing moderation client helpers does not initialize the SDK", async () => {
  let clients = 0;
  const context = fixture(() => ({ default: class { constructor(options) { this.options = options; clients++; } } }));
  assert.deepEqual(context.requested, ["server-only"]);
  const firstOptions = { apiKey: "fixture-first", timeout: 1500, maxRetries: 1 };
  const secondOptions = { apiKey: "fixture-second" };
  const [first, second] = await Promise.all([context.exports.createOpenAIClient(firstOptions), context.exports.createOpenAIClient(secondOptions)]);
  assert.equal(clients, 2);
  assert.notEqual(first, second);
  assert.equal(first.options, firstOptions);
  assert.equal(second.options, secondOptions);
});

test("SDK load and construction failures propagate without an approval fallback", async () => {
  const failure = new Error("Fixture SDK load failed");
  const context = fixture(() => { throw failure; });
  await assert.rejects(context.exports.createOpenAIClient({ apiKey: "fixture" }), error => error === failure);
  const constructorFailure = fixture(() => ({ default: class { constructor() { throw failure; } } }));
  await assert.rejects(constructorFailure.exports.createOpenAIClient({ apiKey: "fixture" }), error => error === failure);
});

test("all AI review entry points use the server-only lazy client after credential checks", async () => {
  assert.match(source, /import "server-only"/);
  for (const name of ["avatar-face", "image-moderation", "media-identity", "video-moderation"]) {
    const reviewSource = await readFile(new URL(`../src/lib/dancr/${name}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(reviewSource, /import OpenAI from|new OpenAI\(/);
    assert.match(reviewSource, /await createOpenAIClient\(/);
    assert.match(reviewSource, /getServerEnv\("OPENAI_API_KEY"\)/);
  }
});
