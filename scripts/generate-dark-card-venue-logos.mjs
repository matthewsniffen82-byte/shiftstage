import sharp from "sharp";
import { fileURLToPath } from "node:url";

const VENUE_LOGO_DIRECTORY = new URL("../public/venue-logos/", import.meta.url);
const DARK_CARD_MARK = [244, 244, 247];

const variants = [
  ["deja-vu-showgirls-las-vegas.png", "deja-vu-showgirls-las-vegas-dark.png"],
  ["little-darlings-las-vegas.png", "little-darlings-las-vegas-dark.png"],
  ["talk-of-the-town.png", "talk-of-the-town-dark.png"],
];

for (const [sourceName, outputName] of variants) {
  const { data, info } = await sharp(fileURLToPath(new URL(sourceName, VENUE_LOGO_DIRECTORY)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] === 0) continue;
    data[offset] = DARK_CARD_MARK[0];
    data[offset + 1] = DARK_CARD_MARK[1];
    data[offset + 2] = DARK_CARD_MARK[2];
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(fileURLToPath(new URL(outputName, VENUE_LOGO_DIRECTORY)));

  console.log(`Generated ${outputName} from ${sourceName}`);
}
