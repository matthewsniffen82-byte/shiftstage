import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedFormData } from "../src/lib/bounded-form-data.ts";

const messages = {
  invalidMessage: "Invalid test upload.",
  tooLargeMessage: "Test upload is too large.",
};

test("bounded form parsing accepts multipart data within the byte limit", async () => {
  const form = new FormData();
  form.set("label", "avatar");
  form.set("file", new Blob(["image-data"], { type: "image/jpeg" }), "avatar.jpg");
  const request = new Request("https://www.mydancr.com/api/test", { method: "POST", body: form });

  const parsed = await readBoundedFormData(request, { maxBytes: 4_096, ...messages });
  assert.equal(parsed.get("label"), "avatar");
  assert.equal(parsed.get("file")?.size, 10);
});

test("bounded form parsing rejects declared and streamed oversized uploads", async () => {
  const declared = {
    url: "https://www.mydancr.com/api/test",
    headers: new Headers({
      "content-length": "65",
      "content-type": "multipart/form-data; boundary=test",
    }),
    get body() {
      throw new Error("The body must not be read.");
    },
  };
  await assert.rejects(
    readBoundedFormData(declared, { maxBytes: 64, ...messages }),
    (error) => error?.status === 413 && error?.message === messages.tooLargeMessage,
  );

  const streamed = new Request("https://www.mydancr.com/api/test", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: `--test\r\nContent-Disposition: form-data; name="file"; filename="large.bin"\r\n\r\n${"x".repeat(128)}\r\n--test--`,
  });
  await assert.rejects(
    readBoundedFormData(streamed, { maxBytes: 64, ...messages }),
    (error) => error?.status === 413 && error?.code === "INVALID_REQUEST",
  );
});

test("bounded form parsing rejects non-multipart requests", async () => {
  const request = new Request("https://www.mydancr.com/api/test", { method: "POST", body: "not-form-data" });
  await assert.rejects(
    readBoundedFormData(request, { maxBytes: 64, ...messages }),
    (error) => error?.status === 400 && error?.message === messages.invalidMessage,
  );
});
