import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";

const messages = {
  invalidMessage: "Invalid test payload.",
  tooLargeMessage: "Test payload is too large.",
};

test("bounded JSON parsing accepts a streamed object within the byte limit", async () => {
  const request = new Request("https://www.mydancr.com/api/test", {
    method: "POST",
    body: JSON.stringify({ action: "save", count: 2 }),
  });

  assert.deepEqual(
    await readBoundedJsonObject(request, { maxBytes: 64, ...messages }),
    { action: "save", count: 2 },
  );
});

test("bounded JSON parsing rejects a declared oversized body before reading it", async () => {
  let bodyAccessed = false;
  const request = {
    headers: new Headers({ "content-length": "65" }),
    get body() {
      bodyAccessed = true;
      throw new Error("The body must not be read.");
    },
  };

  await assert.rejects(
    readBoundedJsonObject(request, { maxBytes: 64, ...messages }),
    (error) => error?.status === 413 && error?.message === messages.tooLargeMessage,
  );
  assert.equal(bodyAccessed, false);
});

test("bounded JSON parsing counts UTF-8 bytes and cancels an oversized stream", async () => {
  const request = new Request("https://www.mydancr.com/api/test", {
    method: "POST",
    body: JSON.stringify({ value: "😀".repeat(20) }),
  });

  await assert.rejects(
    readBoundedJsonObject(request, { maxBytes: 48, ...messages }),
    (error) => error?.status === 413 && error?.code === "INVALID_REQUEST",
  );
});

test("bounded JSON parsing rejects malformed JSON and non-object roots", async () => {
  for (const body of ["not-json", "[]", "null"]) {
    const request = new Request("https://www.mydancr.com/api/test", { method: "POST", body });
    await assert.rejects(
      readBoundedJsonObject(request, { maxBytes: 64, ...messages }),
      (error) => error?.status === 400 && error?.message === messages.invalidMessage,
    );
  }
});
