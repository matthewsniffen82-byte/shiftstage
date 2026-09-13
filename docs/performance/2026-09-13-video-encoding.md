# Video delivery and encoding, September 13, 2026

The remaining slow swipes are primarily limited by available video bytes. The
existing player and its bidirectional preload window are unchanged.

## Measurement

The focused Chromium journey used the same eight TV transitions, two seconds of
watching between transitions, a Pixel 5 viewport, 4 Mbps download throughput,
100 ms latency, and 4x CPU slowdown. Native video-frame callbacks measured the
first presented frame. Profile videos were checked with six forward/backward
transitions under the same conditions. These are browser simulations, not
physical-phone or real-cellular measurements.

Buffered TV transitions took roughly 0.07–0.13 seconds in the diagnostic run.
Two transitions with no buffered data took 1.25 and 2.52 seconds. Several clips
started from less than one second of buffered media and subsequently stalled.
The sampled 1080x1920 MP4s were 3.3–15.4 MB for approximately 8–15 seconds.

Changing a suspended metadata preload into an explicit reload discarded useful
initial data and slowed one transition. Lowering the preload hint after a paused
video had buffered one or three seconds did not consistently stop in-flight
traffic. Neither experiment was applied to the player.

## Change

Longer encoding jobs use H.264 medium/CRF 22 for sources up to 1080x1920, retaining
resolution, frame rate, AAC audio, yuv420p, moving watermark, and MP4 fast-start
metadata. Three representative comparisons saved approximately 15–16% versus
veryfast/CRF 20. Mean VMAF changed by +0.11, +0.28, and -0.36 points; visual
inspection of a moving-water sample showed comparable appearance.

A 30-second 1080x1920 sample took 58.6 seconds with two encoder threads. The
existing 45-second moderation jobs therefore retain their faster encoding path.
The efficient path requires at least the combined video/poster processing budget
to remain. Sources above 1080x1920 and WebM keep their existing codec settings.

## Refreshing existing videos

`scripts/performance/optimize-public-video-encoding.mjs` prepares local candidates
from archived originals. It backs up the currently published MP4s and changes
nothing remotely during preparation. Every candidate is decoded for VMAF
comparison against the original plus the same watermark, sampling every third
frame. Acceptance requires at least 5% fewer bytes, mean VMAF of at least 95,
no more than a 0.5-point mean decrease, and no more than a 1-point minimum decrease.
VMAF is an estimate of visual quality, not proof of identical pixels.

The September 13 preparation checked all 22 currently public videos. Twenty-one
passed: 162,467,506 bytes became 138,148,769 bytes, a 14.97% reduction (24.32 MB).
Individual savings ranged from 9.84% to 16.64%. The lowest accepted mean VMAF was
95.55 and the largest mean decrease was 0.37 points. One video was left out
because it saved only about 1.3%. These are encoded-file measurements, not a
claim that every swipe becomes 15% faster.

Run with the repository's supported Node version and existing local credentials:

```powershell
node scripts/performance/optimize-public-video-encoding.mjs --output=.next-video-refresh
node scripts/performance/optimize-public-video-encoding.mjs --output=.next-video-refresh --apply
```

`--id=<uuid>` restricts either phase to one video. Inspect the local manifest
before applying. Application rechecks anonymous RLS visibility, the exact video
record, candidate hash, and previous published bytes. A confirmed Storage receipt
is required before recording completion. Only the approved MP4 object changes;
posters, archived originals, database rows, access policies, UI, and playback
settings are preserved. Local manifests and media remain in ignored `.next-*`
directories and must not be committed.

Focused checks cover real H.264/AAC decoding, dimensions/duration, fast-start box
order, the short-job fallback, preservation of originals, failed Storage receipts,
changed or hidden videos, and existing preload/visibility/playback ownership.

## Remaining limits

Browser preload hints do not guarantee a number of buffered seconds or strict
network priority. High-bitrate videos can still outrun cellular throughput.
Automating efficient encoding for every future upload needs a worker with a
longer processing budget; the current short moderation jobs deliberately remain
unchanged. Native WebKit checks use host networking and advancing playback time,
so their timing is not directly comparable to Chromium's throttled frame callbacks.
