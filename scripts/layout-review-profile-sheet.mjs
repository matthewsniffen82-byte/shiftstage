import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const PROFILE_SHEET_URL = new URL(
  "./assets/dancer-profile-sheet.jpg",
  import.meta.url,
);

const COLUMN_BOUNDS = [
  { left: 190, width: 204 },
  { left: 399, width: 195 },
  { left: 599, width: 208 },
  { left: 812, width: 226 },
  { left: 1043, width: 218 },
];

export const PROFILE_DEFINITIONS = [
  {
    stageName: "Luna",
    tiles: rowTiles(12, 153),
  },
  {
    stageName: "Ivy",
    tiles: rowTiles(169, 141),
  },
  {
    stageName: "Kai",
    tiles: rowTiles(314, 138),
  },
  {
    stageName: "Sienna",
    tiles: rowTiles(456, 133),
  },
  {
    stageName: "Nova",
    tiles: rowTiles(593, 123),
  },
  {
    stageName: "Bella",
    tiles: rowTiles(720, 118),
  },
];

const EXPECTED_SHEET = {
  format: "jpeg",
  height: 853,
  width: 1280,
};

let validationPromise;

export async function createProfilePhoto(
  definition,
  photoIndex,
  sourceUrl = PROFILE_SHEET_URL,
) {
  await validateProfileSheet(sourceUrl);
  const tile = definition?.tiles?.[photoIndex];
  if (!tile) {
    throw new Error(
      `Photo ${photoIndex + 1} is not defined for ${definition?.stageName || "profile"}.`,
    );
  }

  return sharp(fileURLToPath(sourceUrl))
    .extract(tile)
    .resize({
      fit: "cover",
      height: 900,
      kernel: sharp.kernel.lanczos3,
      position: sharp.strategy.attention,
      width: 1200,
      withoutEnlargement: false,
    })
    .sharpen({ sigma: 0.75 })
    .jpeg({
      chromaSubsampling: "4:4:4",
      mozjpeg: true,
      quality: 92,
    })
    .toBuffer();
}

export async function validateProfileSheet(sourceUrl = PROFILE_SHEET_URL) {
  if (!validationPromise) {
    validationPromise = sharp(fileURLToPath(sourceUrl))
      .metadata()
      .then((metadata) => {
        const actual = {
          format: metadata.format,
          height: metadata.height,
          width: metadata.width,
        };
        if (
          actual.format !== EXPECTED_SHEET.format ||
          actual.height !== EXPECTED_SHEET.height ||
          actual.width !== EXPECTED_SHEET.width
        ) {
          throw new Error(
            `Unexpected dancer profile sheet: ${JSON.stringify(actual)}.`,
          );
        }
        return actual;
      });
  }
  return validationPromise;
}

function rowTiles(top, height) {
  return COLUMN_BOUNDS.map((column) => ({
    height,
    left: column.left,
    top,
    width: column.width,
  }));
}
