# Android TV playback, September 13, 2026

The remaining reproduced problem was buffer underflow after a swipe. Chromium
often retained only 0.3–0.7 seconds of an adjacent high-bitrate MP4, even when its
preload setting had been promoted to auto. A current-buffer gating experiment and
a one-time metadata reload did not improve total stalls and were discarded.
Removing the native poster did not resolve the problem either. These experiments
made no production playback changes.

Android phones now select a separate progressive MP4 copy when the public feed
confirms one exists. The native player, scroll settings, full-priority current
video, strong previous/next preload and light second-neighbor preload are retained.
Homepage warmup adopts the same selected URL and video element. iPhone, desktop,
profile viewers and videos without a mobile copy retain the full-resolution URL.
This adds neither HLS nor a new player library, and does not change visual styling.

Copies fit within a 720-pixel short edge and 1280-pixel long edge, without upscaling.
The shared encoder uses H.264 medium/CRF 22, a 2.5 Mbps video rate limit with a
5 Mb buffer, AAC audio, yuv420p and MP4 faststart. It preserves frame rate and
watermark. A copy is retained only when it saves at least 20% of the file size.
The existing full-resolution and archived original files are not overwritten.

The preparation script reviewed all 22 currently public videos. Seventeen copies
passed both size and quality gates: 113,538,891 full-resolution bytes became
53,777,007 mobile bytes, a 52.6% reduction. Their minimum mean VMAF was 95.38 and
minimum sampled-frame score 89.74, compared at the delivered mobile resolution.
These scores measure encoding loss at that resolution, not equivalence to the
full-resolution detail. Three candidates failed the quality gate and two lacked
enough size savings; those five keep their original delivery.

Future upload, automatic review, manual review and platform-import publication
use the same encoder after watermarking. Optional processing requires sufficient
remaining job time. Encoding/upload failures or insufficient savings leave a
valid full-quality publication available. A derivative's metadata is published
only after a matching Storage upload receipt. Deleting a video also removes its
mobile copy, including an unrecorded copy left by a failed receipt.

Every mobile request still awaits anonymous public RLS and active-owner checks.
Storage remains private and responses remain private/no-store. Paths are derived
from the verified source, never accepted from request metadata. Missing or stale
copies redirect to the full-video endpoint so byte ranges cannot silently change
representation. Native decode/stream failure retries the original once, retaining
playback position and respecting existing active-player/manual-pause guards.

Validation used a production-mode local server and the same eight forward/back
swipes at 4 Mbps, 100 ms latency and 4x Chromium CPU slowdown. Full-resolution
control accumulated 8.09 seconds waiting after playback started; mobile copies
accumulated 4.74 seconds, about 41% less. First-frame samples were 75–205 ms versus
72–144 ms. Both retained one playing video. This is one controlled browser run,
not a physical Android measurement or a guarantee on every cellular connection.
The Windows localhost run logged a pre-existing inline device-script CSP hash
mismatch in both control and treatment; HTTPS production checks verify the
deployed browser path separately without changing CSP.

Focused checks cover native encoding/audio/faststart, short job deadlines, upload
receipts, public access and cancellation, URL selection, fallback and position,
homepage adoption, bidirectional buffer windows, profile ownership, visibility,
worker races and deletion. A production build and public-build security check
passed. Chromium and WebKit browser checks supplement these tests; physical
Android and iPhone hardware are not available in this environment.

Remaining limits: native preload is a browser hint, very slow networks can still
stall, and the five unchanged clips retain their original bandwidth requirement.
Multi-quality adaptive delivery and a dedicated encoding worker would be separate
architecture work. The full-resolution copy remains available throughout.
