import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DANCR_INPUT_DIMENSION,
  MAX_DANCR_INPUT_PIXELS,
  validateAndPrepareDancrImage,
} from "../src/lib/dancr/image-validation.ts";

test("image decoding has finite dimension and pixel limits", async () => {
  assert.equal(MAX_DANCR_INPUT_DIMENSION, 16_384);
  assert.equal(MAX_DANCR_INPUT_PIXELS, 64 * 1024 * 1024);

  const oversizedPngHeader = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPngHeader, 0);
  oversizedPngHeader.write("IHDR", 12, "ascii");
  oversizedPngHeader.writeUInt32BE(100_000, 16);
  oversizedPngHeader.writeUInt32BE(100_000, 20);

  await assert.rejects(
    validateAndPrepareDancrImage(new Blob([oversizedPngHeader])),
    /Photo dimensions are too large/,
  );
});
