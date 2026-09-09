import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";

const { responsivePublicImage } = await import("../src/lib/dancr/responsive-image.ts");
const shell = readFileSync("outputs/index.html", "utf8");
const client = { storage: { from: () => ({ getPublicUrl: (path, options) => {
  if (options) assert.equal(options.transform.resize, "contain", "preserve the full photo aspect ratio");
  return { data: { publicUrl: `https://images.example/${path}${options ? `?width=${options.transform.width}&quality=${options.transform.quality}` : ""}` } };
} }) } };

test("tiny avatar candidates preserve full-size fallbacks and the existing watermarked source", () => {
  const path = "owner/photo.r320-480-640.m1200x1800.f35x40.jpg";
  const image = responsivePublicImage(client, "photos", path);
  assert.match(image.imageSrcSet, /\.w320\.webp\?width=96&quality=80 96w/);
  assert.match(image.imageSrcSet, /\.w320\.webp\?width=160&quality=80 160w/);
  assert.equal(image.imageUrl, `https://images.example/${path}.w480.webp`);
  assert.equal(image.masterImageUrl, `https://images.example/${path}`);
  assert.equal(image.imageFocalX, 35);
  assert.equal(image.imageFocalY, 40);
  for (const width of [80, 120, 240]) {
    const small = responsivePublicImage(client, "photos", `owner/small.r0.m${width}x300.jpg`);
    const widths = [...small.imageSrcSet.matchAll(/ (\d+)w/g)].map(match => Number(match[1]));
    assert.ok(widths.every(candidate => candidate <= width), "delivery must not upscale");
    assert.equal(small.imageUrl, small.masterImageUrl, "small original stays the fallback");
  }
});

test("thumbnail candidates do not downgrade CSS portraits or native fallback images", () => {
  const context = vm.createContext({ safeCssUrl: value => value, safeExternalHref: value => value, escapeOptionValue: value => value });
  for (const name of ["responsiveCssImageSet", "nativeResponsivePhotoAttrs"]) {
    const source = shell.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0];
    assert.ok(source);
    vm.runInContext(source, context);
  }
  const original = "https://images.example/320 320w, https://images.example/480 480w, https://images.example/640 640w";
  const added = "https://images.example/96 96w, https://images.example/160 160w, " + original;
  const previous = context.responsiveCssImageSet(original);
  const current = context.responsiveCssImageSet(added);
  for (const candidate of previous.slice(10, -1).split(", ")) assert.ok(current.includes(candidate));
  assert.match(context.nativeResponsivePhotoAttrs("https://images.example/master", added), /^src="https:\/\/images.example\/320"/);
  assert.match(context.nativeResponsivePhotoAttrs("https://images.example/master", "https://images.example/96 96w, https://images.example/240 240w"), /^src="https:\/\/images.example\/240"/);
});

test("responsive hero assets retain geometry and use content-addressed, smaller WebP files", async () => {
  const original = readFileSync("public/outputs/dancr-hero.webp");
  const hero = shell.match(/<img[^>]*class="hero-art"[^>]*>/)?.[0];
  assert.ok(hero);
  assert.match(hero, /width="1590"\s+height="889"/);
  const candidates = [...hero.matchAll(/\/outputs\/(dancr-hero-(\d+)-([a-f0-9]+)\.webp) (\d+)w/g)];
  assert.equal(candidates.length, 3);
  for (const [, name, width, hash, descriptor] of candidates) {
    const data = readFileSync(`public/outputs/${name}`);
    const metadata = await sharp(data).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, Number(width));
    assert.equal(width, descriptor);
    assert.ok(Math.abs(metadata.height / metadata.width - 889 / 1590) < .002);
    assert.equal(createHash("sha256").update(data).digest("hex").slice(0, 12), hash);
    assert.ok(data.length < original.length);
  }
});
