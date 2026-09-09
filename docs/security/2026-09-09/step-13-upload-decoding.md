# Step 13 — Upload and media decoding

## Confirmed finding and correction

**MEDIUM — Unsupported upload bytes reached a native decoder before container validation.** `inspectStoredMyDancrTvVideo` already bounded downloaded bytes and checked real dimensions, duration and container/MIME agreement, but the container check ran after FFmpeg decoded a frame. Renamed HTML, SVG, PDF, playlists, images or audio could reach unnecessary native parsers even though the later validation rejected them. The initial 34-case regression set failed 29 checks. This demonstrates the validation-order gap; it does not demonstrate production code execution or SSRF.

The existing signature detector now gates downloaded bytes before temporary-file creation or decoder invocation. Container/MIME agreement is checked again at the moderation, poster and watermark boundaries. The post-decode dimension, duration and actual-format checks remain. These checks complement parsing; matching a short header alone does not establish that media is safe or valid.

All four decoder entry paths restrict the untrusted video input to local files and the MOV/ISO-BMFF and Matroska/WebM demuxers. FFmpeg documents the input [protocol allowlist](https://ffmpeg.org/ffmpeg-protocols.html) and [demuxer allowlist](https://ffmpeg.org/ffmpeg-formats.html); unrelated network protocols and playlist demuxers are unnecessary for stored uploads. Generated watermark overlays retain their own image input. A native decoder pixel ceiling uses the existing 7,680-pixel dimension limit squared, so frames beyond the supported maximum cannot be allocated before the later metadata check. This uses FFmpeg's [maximum decoded pixel setting](https://www.ffmpeg.org/doxygen/trunk/structAVCodecContext.html), confirmed in the installed binary's option help.

## Upload inventory and stronger controls retained

- The six active multipart image routes cover admin venue media, venue logos/covers and dancer avatar/photo/preview operations. Their boundaries enforce role/ownership checks, bounded multipart bodies and image budgets. The shared image validator identifies actual JPEG, PNG, WebP, HEIC or HEIF bytes, caps input at 25 MiB, 16,384 pixels per dimension and 64 million pixels, decodes strictly, and normalizes to supported output at at most 6,000 pixels and 10 MiB. Public output is re-encoded and storage names are server-generated UUIDs. Later processing receives this validated master.
- Venue media administration still requires the centralized admin gate. Ordinary venue logo/cover helpers intentionally reject changes managed by MyDancr. Aspect-ratio, minimum-size and moderation checks remain.
- TV initialization accepts only MP4, MOV and WebM declarations with existing 75 MiB, one-to-30-second and vertical/square bounds. The private upload uses an ownership-checked user/dancer/video UUID path and an immutable signed target. Finalization verifies stored size/MIME and actual media before approval. Both dancer and platform-owner publishing paths invoke the inspector. Upload IDs are validated and resume only the caller's own matching record.
- Image identity review, video visual/audio moderation, private originals and moderation artifacts, watermarking, and existing publication rules remain. No upload becomes public to simplify validation.
- Step 4's ten bucket contracts and browser write restrictions remain. The legacy venue-proof helper accepts bounded signature-checked PDF/images into a private UUID path, but its public claim route is retired with HTTP 410. No sensitive verification document is fetched or modified during this review.

No database migration, bucket change, new dependency, paid service or UI redesign is introduced.

## Validation and limits

Thirty-seven new tests exercise the real boundary code and native decoder. Coverage includes unsupported and truncated bytes, MIME mismatches, size checks, preserved metadata validation, option placement on every decoder path and real MP4/H.264/AAC, MOV/H.264 without audio and WebM/VP9/Opus processing. Synthetic short clips pass inspection, moderation frame/audio extraction and WebP poster creation. The existing native MP4 watermark regression also passes. The focused suite passes all 48 tests.

A tiny generated clip with a deliberately reduced test pixel ceiling proves the native decoder rejects excessive dimensions without constructing a large image. A generated PNG is rejected by the video demuxer allowlist. An ephemeral loopback server receives zero requests when a synthetic HTTP video input is rejected by the protocol allowlist. These isolated tests neither contact internal production services nor establish a pre-existing production URL-injection exploit.

No real-user upload, provider moderation request, private verification document, oversized allocation or production abuse traffic is used. Existing decoder timeouts and the 75 MiB download limit remain; native codec defects, memory cost within permitted dimensions and processing concurrency are not eliminated by these controls. Step 29 reviews resource ceilings. Actual accepted media still undergoes all existing moderation decisions.
