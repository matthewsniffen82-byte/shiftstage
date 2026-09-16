import sharp from "sharp";
import { fileURLToPath } from "node:url";

// Preserve the existing vector artwork; raster icons support Home Screen installs.
const source = fileURLToPath(new URL("../public/mydancr-icon.svg", import.meta.url));
for (const size of [180, 192, 512]) {
  await sharp(source)
    .resize(size, size).flatten({ background: "#050507" }).png()
    .toFile(fileURLToPath(new URL(`../public/mydancr-icon-${size}.png`, import.meta.url)));
}
