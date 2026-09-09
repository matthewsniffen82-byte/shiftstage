// Generate immutable display sizes from the original artwork, never from a
// previously compressed WebP. Existing originals and fallbacks stay intact.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../public/outputs/dancr-hero.png", import.meta.url));
const variants = [];
for (const width of [480, 800, 1280]) {
  const { data, info } = await sharp(source).resize({ width, withoutEnlargement: true })
    .webp({ quality: 84, effort: 6, smartSubsample: true }).toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
  const name = `dancr-hero-${info.width}-${hash}.webp`;
  await writeFile(new URL(`../public/outputs/${name}`, import.meta.url), data);
  variants.push({ url: `/outputs/${name}`, width: info.width, height: info.height, bytes: data.length });
}
console.log(JSON.stringify(variants, null, 2));
