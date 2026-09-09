# Step 3 — image delivery

## Starting evidence

Step 2 (`ac9ea442c1ff9f7f649d36446c25efe5583dae32`) was pushed and deployed successfully. The matched customer mobile fixture dropped from 339,945 to 249,273 transferred JavaScript bytes (26.7%) and from 670,719 to 579,726 total bytes (13.6%). Requests fell from 30 to 27, median LCP from 2,192 to 1,804 ms, and CLS remained 0.001. All three dashboard role smoke checks, health, public data and anonymous private-data rejection passed. These are lab rendering results, not private database or field INP measurements.

The Step 3 baseline is recorded in `step-03-before.json`: three cold cellular samples each of home, the public dancer profile and the venue feed. Median total transfer was respectively 1,115,196, 363,378 and 899,397 bytes. LCP was 1,188, 2,680 and 1,312 ms. Timing varies substantially with host/CDN conditions; the final comparison also checks deterministic image dimensions and transferred bytes.

At 393px/DPR 2, the hero displayed at 369 × 206 but downloaded the 1,590 × 889, 45,754-byte source. Venue lineup avatars displayed at 24 × 24 but selected 320px transforms. The public profile's first photo row was visible at y=397 and its first image became LCP, but all gallery photos were lazy. Grid photos already had responsive sources, dimensions and suitable 320px choices; venue logos were native SVGs. Existing uploads already preserve originals, watermark public media and generate quality-84 WebP variants at 320/480/640/1280/2048 widths. Those working paths are retained.

## Changes

- Generate 480, 800 and 1280px hero WebPs directly from the original PNG, preserving the artwork and geometry. Content-addressed files receive immutable caching. At DPR 2 the phone candidate is 19,778 bytes, 56.8% below the original. The original remains the fallback and highest-resolution candidate.
- Match responsive hero preload and image source selection. Omit the preload's `href` so browsers without responsive-preload support discover the image normally instead of downloading two versions. This follows the [responsive preload guidance](https://web.dev/articles/preload-responsive-images).
- Add 96/160px delivery candidates using the existing image service and existing watermarked source, without generating more stored uploads. Keep full-size fallback selection and legacy CSS portrait density choices intact.
- Explicitly preserve aspect ratio with the transformation's `contain` resize mode. The live storage probe found default width-only resizing produced, for one source, a 320 × 1,037 crop from a 640 × 1,037 image. `contain` returned 320 × 519; the 96px thumbnail returned 96 × 156. This avoids magnifying that crop in tiny avatars. Existing CSS object-fit and focal positions still determine display framing. See [Supabase resize-mode documentation](https://supabase.com/docs/guides/storage/serving/image-transformations).
- Eagerly load only the first three public profile photos, with high priority only on the first. Dashboard previews and later photos retain lazy loading. Video poster loading and playback are unchanged.

## Validation and limits

New tests cover thumbnail fallbacks, no upscaling, preserved focal metadata, CSS/native candidate compatibility, real WebP dimensions/content hashes, hero geometry and matched preloads. Four older poster assertions accidentally matched the preceding photo's `loading="lazy"`; they now assert the existing poster rule (first six eager, later lazy). No video policy changed.

`image-smoke.mjs` checks one hero request at phone DPR 2/DPR 3 and desktop DPR 2, expected source selection, cache headers and JavaScript errors. `image-storage-probe.mjs` checks real transform dimensions and bytes for three public images without storing signed URLs or writing storage. The complete automated suite, TypeScript, lint, production build, mobile samples and deployment health are release gates. Upstream security environment validation and the crop-editor copy fix are preserved.

No upload master was recompressed, no new vendor or paid plan was added, and no layout or branding was redesigned. Existing storage transformation usage remains within the project's existing service; this pass does not introduce a transcoding service. Physical iPhone/Android image-quality validation remains part of the mobile limitations in the final report.
