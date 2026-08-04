import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const PROFILE_SHEET_URL = new URL(
  "./assets/dancer-profile-sheet.jpg",
  import.meta.url,
);

export const ADDITIONAL_PROFILE_SHEET_URL = new URL(
  "./assets/dancer-profile-sheet-2.jpg",
  import.meta.url,
);

const ORIGINAL_COLUMN_BOUNDS = [
  { left: 190, width: 204 },
  { left: 399, width: 195 },
  { left: 599, width: 208 },
  { left: 812, width: 226 },
  { left: 1043, width: 218 },
];

const ADDITIONAL_COLUMN_BOUNDS = [
  { left: 113, width: 227 },
  { left: 344, width: 225 },
  { left: 574, width: 226 },
  { left: 805, width: 227 },
  { left: 1037, width: 239 },
];

const ORIGINAL_PROFILE_DEFINITIONS = [
  {
    stageName: "Luna",
    tiles: rowTiles(ORIGINAL_COLUMN_BOUNDS, 12, 153),
  },
  {
    stageName: "Ivy",
    tiles: rowTiles(ORIGINAL_COLUMN_BOUNDS, 169, 141),
  },
  {
    stageName: "Kai",
    tiles: rowTiles(ORIGINAL_COLUMN_BOUNDS, 314, 138),
  },
  {
    stageName: "Sienna",
    tiles: rowTiles(ORIGINAL_COLUMN_BOUNDS, 456, 133),
  },
  {
    stageName: "Nova",
    tiles: rowTiles(ORIGINAL_COLUMN_BOUNDS, 593, 123),
  },
  {
    stageName: "Bella",
    tiles: rowTiles(ORIGINAL_COLUMN_BOUNDS, 720, 118),
  },
];

export const ADDITIONAL_PROFILE_DEFINITIONS = [
  {
    outputHeight: 1200,
    outputWidth: 900,
    primaryPhotoIndex: 2,
    sourceUrl: ADDITIONAL_PROFILE_SHEET_URL,
    stageName: "Luna",
    tiles: rowTiles(ADDITIONAL_COLUMN_BOUNDS, 5, 228),
  },
  {
    outputHeight: 1200,
    outputWidth: 900,
    primaryPhotoIndex: 3,
    sourceUrl: ADDITIONAL_PROFILE_SHEET_URL,
    stageName: "Jada",
    tiles: rowTiles(ADDITIONAL_COLUMN_BOUNDS, 239, 223),
  },
  {
    outputHeight: 1200,
    outputWidth: 900,
    primaryPhotoIndex: 1,
    sourceUrl: ADDITIONAL_PROFILE_SHEET_URL,
    stageName: "Nikki",
    tiles: rowTiles(ADDITIONAL_COLUMN_BOUNDS, 468, 225),
  },
  {
    outputHeight: 1200,
    outputWidth: 900,
    primaryPhotoIndex: 4,
    sourceUrl: ADDITIONAL_PROFILE_SHEET_URL,
    stageName: "Vanessa",
    tiles: rowTiles(ADDITIONAL_COLUMN_BOUNDS, 700, 224),
  },
  {
    outputHeight: 1200,
    outputWidth: 900,
    primaryPhotoIndex: 0,
    sourceUrl: ADDITIONAL_PROFILE_SHEET_URL,
    stageName: "Sienna",
    tiles: rowTiles(ADDITIONAL_COLUMN_BOUNDS, 930, 237),
  },
];

export const PROFILE_DEFINITIONS = [
  ...ORIGINAL_PROFILE_DEFINITIONS,
  ...ADDITIONAL_PROFILE_DEFINITIONS,
];

const EXPECTED_SHEETS = new Map([
  [
    PROFILE_SHEET_URL.href,
    {
      format: "jpeg",
      height: 853,
      width: 1280,
    },
  ],
  [
    ADDITIONAL_PROFILE_SHEET_URL.href,
    {
      format: "jpeg",
      height: 1170,
      width: 1280,
    },
  ],
]);

const validationPromises = new Map();

export async function createProfilePhoto(
  definition,
  photoIndex,
  sourceUrl = definition?.sourceUrl || PROFILE_SHEET_URL,
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
      height: definition?.outputHeight || 900,
      kernel: sharp.kernel.lanczos3,
      position: sharp.strategy.attention,
      width: definition?.outputWidth || 1200,
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
  const expected = EXPECTED_SHEETS.get(sourceUrl.href);
  if (!expected) {
    throw new Error(`No validation contract exists for ${sourceUrl.href}.`);
  }

  if (!validationPromises.has(sourceUrl.href)) {
    validationPromises.set(sourceUrl.href, sharp(fileURLToPath(sourceUrl))
      .metadata()
      .then((metadata) => {
        const actual = {
          format: metadata.format,
          height: metadata.height,
          width: metadata.width,
        };
        if (
          actual.format !== expected.format ||
          actual.height !== expected.height ||
          actual.width !== expected.width
        ) {
          throw new Error(
            `Unexpected dancer profile sheet: ${JSON.stringify(actual)}.`,
          );
        }
        return actual;
      }));
  }
  return validationPromises.get(sourceUrl.href);
}

function rowTiles(columns, top, height) {
  return columns.map((column) => ({
    height,
    left: column.left,
    top,
    width: column.width,
  }));
}
