import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidatedDancrImage } from "./image-validation";

export const DANCR_RESPONSIVE_IMAGE_WIDTHS = [640, 1280, 2048] as const;
export const DANCR_RESPONSIVE_IMAGE_QUALITY = 90;

type DancrClient = SupabaseClient<any, any, any>;

export type ResponsiveImageVariant = {
  buffer: Buffer;
  contentType: "image/webp";
  height: number;
  width: number;
};

export type PreparedResponsiveImage = {
  height: number;
  master: ValidatedDancrImage;
  variants: ResponsiveImageVariant[];
  width: number;
};

export type UploadedResponsiveImage = {
  height: number;
  responsiveWidths: number[];
  storagePath: string;
  width: number;
};

export type ResponsivePublicImage = {
  imageHeight: number | null;
  imageSrcSet: string | null;
  imageUrl: string;
  imageWidth: number | null;
  masterImageUrl: string;
};

type ResponsiveImageManifest = {
  height: number;
  responsiveWidths: number[];
  width: number;
};

const RESPONSIVE_MANIFEST_PATTERN =
  /\.r(0|[1-9]\d*(?:-[1-9]\d*)*)\.m([1-9]\d*)x([1-9]\d*)\.[a-z0-9]+$/i;

export async function prepareResponsiveImage(
  master: ValidatedDancrImage,
): Promise<PreparedResponsiveImage> {
  const sharp = await loadSharp();
  const metadata = await sharp(master.buffer, {
    failOn: "error",
    limitInputPixels: false,
  }).metadata();
  const width = positiveDimension(master.width) || positiveDimension(metadata.width);
  const height = positiveDimension(master.height) || positiveDimension(metadata.height);
  if (!width || !height) {
    throw new Error("Unable to read the uploaded photo dimensions.");
  }

  const requestedWidths = DANCR_RESPONSIVE_IMAGE_WIDTHS.filter(
    (candidateWidth) => candidateWidth < width,
  );
  const variants = await Promise.all(
    requestedWidths.map(async (candidateWidth) => {
      const result = await sharp(master.buffer, {
        failOn: "error",
        limitInputPixels: false,
      })
        .resize({
          width: candidateWidth,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({
          effort: 4,
          quality: DANCR_RESPONSIVE_IMAGE_QUALITY,
          smartSubsample: true,
        })
        .toBuffer({ resolveWithObject: true });
      const variantWidth = positiveDimension(result.info.width);
      const variantHeight = positiveDimension(result.info.height);
      if (!variantWidth || !variantHeight) {
        throw new Error("Unable to generate a responsive photo size.");
      }
      return {
        buffer: result.data,
        contentType: "image/webp" as const,
        height: variantHeight,
        width: variantWidth,
      };
    }),
  );

  return {
    height,
    master: {
      ...master,
      height,
      width,
    },
    variants,
    width,
  };
}

export async function uploadResponsiveImage(
  client: DancrClient,
  bucket: string,
  directory: string,
  master: ValidatedDancrImage,
  cacheControl = "31536000",
): Promise<UploadedResponsiveImage> {
  const prepared = await prepareResponsiveImage(master);
  const storagePath = responsiveMasterStoragePath(directory, prepared);
  const objects = [
    {
      buffer: prepared.master.buffer,
      contentType: prepared.master.contentType,
      path: storagePath,
    },
    ...prepared.variants.map((variant) => ({
      buffer: variant.buffer,
      contentType: variant.contentType,
      path: responsiveVariantStoragePath(storagePath, variant.width),
    })),
  ];

  const uploadResults = await Promise.all(
    objects.map(async (object) => ({
      path: object.path,
      result: await client.storage.from(bucket).upload(object.path, object.buffer, {
        cacheControl,
        contentType: object.contentType,
        upsert: false,
      }),
    })),
  );
  const failedUpload = uploadResults.find(({ result }) => result.error);
  if (failedUpload) {
    await client.storage
      .from(bucket)
      .remove(objects.map((object) => object.path))
      .catch(() => null);
    throw failedUpload.result.error;
  }

  return {
    height: prepared.height,
    responsiveWidths: prepared.variants.map((variant) => variant.width),
    storagePath,
    width: prepared.width,
  };
}

export async function removeResponsiveImage(
  client: DancrClient,
  bucket: string,
  storagePath: string | null | undefined,
) {
  const paths = responsiveImageStoragePaths(storagePath);
  if (!paths.length) return;
  const { error } = await client.storage.from(bucket).remove(paths);
  if (error) throw error;
}

export function responsiveImageStoragePaths(
  storagePath: string | null | undefined,
) {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) return [];
  const manifest = parseResponsiveImageManifest(normalizedPath);
  return [
    normalizedPath,
    ...(manifest?.responsiveWidths || []).map((width) =>
      responsiveVariantStoragePath(normalizedPath, width),
    ),
  ];
}

export function responsivePublicImage(
  client: DancrClient,
  bucket: string,
  storagePath: string | null | undefined,
): ResponsivePublicImage | null {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) return null;
  if (/^https?:\/\//i.test(normalizedPath)) {
    return {
      imageHeight: null,
      imageSrcSet: null,
      imageUrl: normalizedPath,
      imageWidth: null,
      masterImageUrl: normalizedPath,
    };
  }

  const masterImageUrl = publicStorageUrl(client, bucket, normalizedPath);
  const manifest = parseResponsiveImageManifest(normalizedPath);
  if (!manifest) {
    return {
      imageHeight: null,
      imageSrcSet: null,
      imageUrl: masterImageUrl,
      imageWidth: null,
      masterImageUrl,
    };
  }

  const responsiveSources = manifest.responsiveWidths.map((width) => ({
    url: publicStorageUrl(
      client,
      bucket,
      responsiveVariantStoragePath(normalizedPath, width),
    ),
    width,
  }));
  const fallbackSource =
    responsiveSources[responsiveSources.length - 1]?.url || masterImageUrl;
  const sourceSet = [
    ...responsiveSources.map((source) => `${source.url} ${source.width}w`),
    `${masterImageUrl} ${manifest.width}w`,
  ].join(", ");

  return {
    imageHeight: manifest.height,
    imageSrcSet: sourceSet,
    imageUrl: fallbackSource,
    imageWidth: manifest.width,
    masterImageUrl,
  };
}

export function responsiveVariantStoragePath(
  masterStoragePath: string,
  width: number,
) {
  return `${masterStoragePath}.w${width}.webp`;
}

function responsiveMasterStoragePath(
  directory: string,
  image: PreparedResponsiveImage,
) {
  const normalizedDirectory = directory.replace(/^\/+|\/+$/g, "");
  const fileName = image.master.storageFileName;
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension =
    extensionIndex > 0 ? fileName.slice(extensionIndex + 1) : image.master.extension;
  const responsiveWidths =
    image.variants.map((variant) => variant.width).join("-") || "0";
  return `${normalizedDirectory}/${stem}.r${responsiveWidths}.m${image.width}x${image.height}.${extension}`;
}

function parseResponsiveImageManifest(
  storagePath: string,
): ResponsiveImageManifest | null {
  const match = storagePath.match(RESPONSIVE_MANIFEST_PATTERN);
  if (!match) return null;
  const responsiveWidths =
    match[1] === "0"
      ? []
      : match[1]
          .split("-")
          .map((width) => Number.parseInt(width, 10))
          .filter((width) => Number.isInteger(width) && width > 0);
  const width = Number.parseInt(match[2], 10);
  const height = Number.parseInt(match[3], 10);
  if (!width || !height) return null;
  return { height, responsiveWidths, width };
}

function publicStorageUrl(
  client: DancrClient,
  bucket: string,
  storagePath: string,
) {
  return client.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}

function positiveDimension(value: unknown) {
  const dimension = Number(value || 0);
  return Number.isInteger(dimension) && dimension > 0 ? dimension : 0;
}

async function loadSharp(): Promise<any> {
  const imported = await import("sharp");
  return imported.default || imported;
}
