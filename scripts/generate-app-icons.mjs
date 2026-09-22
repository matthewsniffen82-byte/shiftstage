import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Rasterize the wordmark once so Android does not substitute its own SVG fonts.
const source = await readFile(new URL("../public/mydancr-icon.svg", import.meta.url), "utf8");
// Android supplies the outer shape. Keep a full, opaque background and leave
// the wordmark inside the central 40%-radius circle required for maskable icons.
const maskable = source.replace('rx="112"', 'rx="0"')
  .replace(/<rect x="36" y="36"[^>]*\/>/, '<rect width="512" height="512" fill="url(#glow)"/>')
  .replace(/<rect id="tile-frame"[^>]*\/>/, "");
if (maskable === source || maskable.includes('id="tile-frame"')) throw new Error("Missing app icon maskable surface.");
const icons = [];
for (const [size, purpose] of [[180, "any"], [192, "any"], [512, "any"], [192, "maskable"], [512, "maskable"]]) {
  const asset = `/mydancr-icon-${purpose === "maskable" ? "maskable-" : ""}${size}.png`;
  const bytes = await sharp(Buffer.from(purpose === "maskable" ? maskable : source))
    .resize(size, size).flatten({ background: "#050507" }).png()
    .toBuffer();
  await writeFile(new URL(`../public${asset}`, import.meta.url), bytes);
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  if (size !== 180) icons.push({ src: `${asset}?v=${version}`, sizes: `${size}x${size}`, type: "image/png", purpose });
}
const manifestPath = new URL("../public/manifest.webmanifest", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.icons = icons;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
// Samsung Internet uses a browser bookmark, avoiding its outdated WebAPK installer.
await writeFile(new URL("../public/manifest-shortcut.webmanifest", import.meta.url), JSON.stringify({
  ...manifest, display: "browser", display_override: ["browser"],
}, null, 2) + "\n");
