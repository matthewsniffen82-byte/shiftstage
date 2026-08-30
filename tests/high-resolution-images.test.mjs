import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

const {
  prepareResponsiveImage,
  responsiveImageStoragePaths,
  responsivePublicImage,
  uploadResponsiveImage,
} = await import(
  new URL("../src/lib/dancr/responsive-image.ts", import.meta.url)
);

const imageValidation = readFileSync(
  new URL("../src/lib/dancr/image-validation.ts", import.meta.url),
  "utf8",
);
const responsiveImages = readFileSync(
  new URL("../src/lib/dancr/responsive-image.ts", import.meta.url),
  "utf8",
);
const moderation = readFileSync(
  new URL("../src/lib/dancr/image-moderation.ts", import.meta.url),
  "utf8",
);
const venue = readFileSync(
  new URL("../src/lib/dancr/venue.ts", import.meta.url),
  "utf8",
);
const publicService = readFileSync(
  new URL("../src/lib/dancr/public.ts", import.meta.url),
  "utf8",
);
const discoveryRoute = readFileSync(
  new URL("../app/api/public/discovery/route.ts", import.meta.url),
  "utf8",
);
const venueRoute = readFileSync(
  new URL("../app/api/public/venues/route.ts", import.meta.url),
  "utf8",
);
const dancerProfile = readFileSync(
  new URL("../app/dancers/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const dancerCarousel = readFileSync(
  new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const adminDashboard = readFileSync(
  new URL("../app/admin/AdminClient.tsx", import.meta.url),
  "utf8",
);
const liveShell = readFileSync(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("HEIC conversion retains high visual quality without enlarging the source", () => {
  assert.match(imageValidation, /DANCR_HEIC_JPEG_QUALITY = 94/);
  assert.match(imageValidation, /withoutEnlargement: true/);
  assert.match(imageValidation, /chromaSubsampling: "4:4:4"/);
  assert.match(imageValidation, /quality: DANCR_HEIC_JPEG_QUALITY/);
  assert.doesNotMatch(imageValidation, /quality: 88/);
});

test("responsive image processing preserves the master and creates production display sizes", () => {
  assert.match(
    responsiveImages,
    /DANCR_RESPONSIVE_IMAGE_WIDTHS = \[320, 480, 640, 1280, 2048\]/,
  );
  assert.match(responsiveImages, /DANCR_RESPONSIVE_IMAGE_QUALITY = 84/);
  assert.match(responsiveImages, /candidateWidth < width/);
  assert.match(responsiveImages, /withoutEnlargement: true/);
  assert.match(responsiveImages, /\.webp\(\{[\s\S]*?quality: DANCR_RESPONSIVE_IMAGE_QUALITY/);
  assert.match(
    responsiveImages,
    /buffer: prepared\.master\.buffer[\s\S]*?contentType: prepared\.master\.contentType/,
  );
  assert.match(responsiveImages, /responsiveVariantStoragePath/);
  assert.match(responsiveImages, /position: sharp\.strategy\.attention/);
  assert.match(responsiveImages, /result\.info\.attentionX/);
  assert.match(responsiveImages, /result\.info\.attentionY/);
  assert.match(responsiveImages, /imageSrcSet: sourceSet/);
  assert.match(responsiveImages, /fallbackSource[\s\S]*?masterImageUrl/);
});

test("responsive image processing preserves bytes, emits real WebP variants, and never upscales", async () => {
  const masterBuffer = await sharp({
    create: {
      width: 2500,
      height: 1600,
      channels: 3,
      background: { r: 76, g: 29, b: 149 },
    },
  })
    .jpeg({ quality: 96 })
    .toBuffer();
  const master = {
    buffer: masterBuffer,
    contentType: "image/jpeg",
    extension: "jpg",
    width: 2500,
    height: 1600,
    sha256: "test",
    storageFileName: "profile.jpg",
  };

  const prepared = await prepareResponsiveImage(master);
  assert.deepEqual(
    prepared.variants.map((variant) => variant.width),
    [320, 480, 640, 1280, 2048],
  );
  assert.equal(prepared.master.buffer, masterBuffer);
  for (const variant of prepared.variants) {
    assert.ok(variant.width < master.width);
    assert.equal(variant.contentType, "image/webp");
    const metadata = await sharp(variant.buffer).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, variant.width);
  }

  const uploads = [];
  const removals = [];
  const storageClient = {
    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options) {
            uploads.push({ bucket, path, buffer, options });
            return { data: { path }, error: null };
          },
          async remove(paths) {
            removals.push({ bucket, paths });
            return { data: [], error: null };
          },
          getPublicUrl(path) {
            return {
              data: {
                publicUrl: `https://images.example/${bucket}/${path}`,
              },
            };
          },
        };
      },
    },
  };
  const uploaded = await uploadResponsiveImage(
    storageClient,
    "dancer-photos",
    "user/profile",
    master,
  );
  assert.match(
    uploaded.storagePath,
    /^user\/profile\/profile\.r320-480-640-1280-2048\.m2500x1600\.f\d{1,3}x\d{1,3}\.jpg$/,
  );
  assert.ok(uploaded.focalX >= 0 && uploaded.focalX <= 100);
  assert.ok(uploaded.focalY >= 0 && uploaded.focalY <= 100);
  assert.equal(uploads.length, 6);
  assert.equal(uploads[0].buffer, masterBuffer);
  assert.deepEqual(
    responsiveImageStoragePaths(uploaded.storagePath),
    uploads.map((upload) => upload.path),
  );
  const publicImage = responsivePublicImage(
    storageClient,
    "dancer-photos",
    uploaded.storagePath,
  );
  assert.match(publicImage.imageUrl, /\.w480\.webp$/);
  assert.match(publicImage.imageSrcSet, /\.w320\.webp 320w/);
  assert.match(publicImage.imageSrcSet, /\.w480\.webp 480w/);
  assert.match(publicImage.imageSrcSet, /\.w640\.webp 640w/);
  assert.match(publicImage.imageSrcSet, /\.w1280\.webp 1280w/);
  assert.match(publicImage.imageSrcSet, /\.w2048\.webp 2048w/);
  assert.match(publicImage.imageSrcSet, /\.jpg 2500w$/);
  assert.equal(publicImage.imageFocalX, uploaded.focalX);
  assert.equal(publicImage.imageFocalY, uploaded.focalY);
  assert.deepEqual(removals, []);
});

test("legacy responsive photos gain small transformed sources and retain a centered avatar fallback", () => {
  const storageClient = {
    storage: {
      from(bucket) {
        return {
          getPublicUrl(path, options) {
            const transform = options?.transform;
            const query = transform
              ? `?width=${transform.width}&quality=${transform.quality}`
              : "";
            return { data: { publicUrl: `https://images.example/${bucket}/${path}${query}` } };
          },
        };
      },
    },
  };
  const publicImage = responsivePublicImage(
    storageClient,
    "dancer-photos",
    "user/profile/legacy.r640.m1200x1800.jpg",
  );
  assert.equal(publicImage.imageFocalX, 50);
  assert.equal(publicImage.imageFocalY, 50);
  assert.match(publicImage.imageUrl, /legacy\.r640\.m1200x1800\.jpg\.w640\.webp\?width=480&quality=80$/);
  assert.match(publicImage.imageSrcSet, /\.w640\.webp\?width=320&quality=80 320w/);
  assert.match(publicImage.imageSrcSet, /\.w640\.webp\?width=480&quality=80 480w/);
  assert.match(publicImage.imageSrcSet, /\.w640\.webp 640w/);
});

test("dancer and venue uploads publish and clean up complete responsive image sets", () => {
  assert.match(moderation, /uploadResponsiveImage\(/);
  assert.match(moderation, /removeResponsiveImage\(/);
  assert.match(venue, /uploadResponsiveImage\(/);
  assert.match(venue, /removeResponsiveImage\(/);
  assert.match(venue, /coverImageSrcSet:/);
});

test("public image responses expose responsive sources with legacy fallbacks", () => {
  assert.match(publicService, /responsivePublicImage\(/);
  assert.match(publicService, /primaryPhotoSrcSet:/);
  assert.match(publicService, /galleryPhotoSrcSets:/);
  assert.match(publicService, /coverImageSrcSet:/);
  assert.match(publicService, /logoImageSrcSet:/);
  assert.match(discoveryRoute, /coverImageSrcSet:/);
  assert.match(discoveryRoute, /logoImageSrcSet:/);
  assert.match(venueRoute, /coverImageSrcSet:/);
  assert.match(venueRoute, /logoImageSrcSet:/);
});

test("profile surfaces use responsive sources and concise plural upload guidance", () => {
  assert.match(dancerProfile, /srcSet=\{avatarPhotoSrcSet \|\| undefined\}/);
  assert.match(dancerProfile, /fetchPriority="high"[\s\S]*?sizes="72px"/);
  assert.match(dancerCarousel, /srcSet=\{item\.imageSrcSet \|\| undefined\}/);
  assert.match(
    dancerCarousel,
    /srcSet=\{item\.imageSrcSet \|\| undefined\}/,
  );
  assert.match(adminDashboard, /original camera image/);
  assert.match(dashboard, /Choose profile photos/);
  assert.doesNotMatch(dashboard, /Choose the original camera photo for maximum detail/);
  assert.doesNotMatch(dashboard, /never enlarges a small/);
  assert.match(liveShell, /function responsiveCssImageSet/);
  assert.match(liveShell, /profilePhotoSrcSet/);
  assert.match(liveShell, /nativeResponsivePhotoAttrs\(logoImageUrl, venue\?\.logoImageSrcSet\)/);
  assert.match(liveShell, /original camera images/);
  assert.match(liveShell, /image\/heic,image\/heif/);
  assert.match(dashboard, /className="customer-saved-card-image"[\s\S]*?loading="lazy"[\s\S]*?sizes="\(max-width: 860px\)/);
});
