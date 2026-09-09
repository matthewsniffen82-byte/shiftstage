// Public images only; no credentials or storage writes. Signed URLs are not retained.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const output = process.env.PERF_OUTPUT || ".qa/image-storage";
await mkdir(output, { recursive: true });
const response = await fetch("https://www.mydancr.com/api/public/discovery?city=Las%20Vegas");
assert.ok(response.ok);
const discovery = await response.json();
const photos = discovery.dancers.filter(dancer => dancer.primaryPhotoUrl?.includes("/render/image/")).slice(0, 3);
assert.equal(photos.length, 3);
const results = [];
for (const photo of photos) {
  for (const [width, resize] of [[320, null], [320, "contain"], [96, "contain"], [160, "contain"]]) {
    const url = new URL(photo.primaryPhotoUrl);
    url.searchParams.set("width", String(width));
    url.searchParams.delete("resize");
    if (resize) url.searchParams.set("resize", resize);
    const image = await fetch(url, { headers: { Accept: "image/webp" } });
    assert.ok(image.ok);
    const buffer = Buffer.from(await image.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    if (resize === "contain") {
      assert.equal(metadata.width, width);
      assert.ok(Math.abs(metadata.height / metadata.width - photo.primaryPhotoHeight / photo.primaryPhotoWidth) < .02, "full photo aspect ratio");
    }
    results.push({ path: url.pathname, requestedWidth: width, resize: resize || "default", width: metadata.width, height: metadata.height, bytes: buffer.length, format: metadata.format, cache: image.headers.get("cache-control") });
  }
}
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ requestedWidth, resize, width, height, bytes }) => ({ requestedWidth, resize, width, height, bytes }))));
