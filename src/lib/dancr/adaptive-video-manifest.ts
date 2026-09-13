// Retained only to remove already-created private derivatives when their video is deleted.
// Only generated, bounded indexes are accepted. Never trust a playlist URL or
// object path from JSON metadata or from a browser request.
export type VideoRendition = {
  name: string;
  width: number;
  height: number;
  bytes: number;
  initBytes: number;
  codecs?: string;
  segments: Array<{ duration: number; bytes: number }>;
};
export type AdaptiveVideoManifest = { version: 1; generation: string; renditions: VideoRendition[] };
const integer = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;
export function parseAdaptiveVideoManifest(value: any): AdaptiveVideoManifest | null {
  if (value?.version !== 1 || !/^[a-f0-9]{32}$/.test(value.generation) || !Array.isArray(value.renditions)
    || value.renditions.length < 2 || value.renditions.length > 3) return null;
  const names = new Set<string>();
  for (const row of value.renditions) {
    if (!row || !['360', '720', 'source'].includes(row.name) || names.has(row.name)
      || !integer(row.width, 4096) || !integer(row.height, 4096) || !integer(row.bytes, 75 * 1024 * 1024)
      || !integer(row.initBytes, 65536) || !Array.isArray(row.segments) || !row.segments.length || row.segments.length > 32
      || (row.codecs !== undefined && (typeof row.codecs !== 'string' || !/^avc1\.[a-f0-9]{6}(,mp4a\.40\.2)?$/.test(row.codecs)))) return null;
    names.add(row.name);
    let bytes = row.initBytes;
    let duration = 0;
    for (const segment of row.segments) {
      if (!integer(segment.bytes, 20 * 1024 * 1024) || !Number.isFinite(segment.duration)
        || segment.duration <= 0 || segment.duration > 3) return null;
      bytes += segment.bytes; duration += segment.duration;
    }
    if (bytes !== row.bytes || duration > 31) return null;
  }
  if (!names.has('source')) return null;
  const reference = value.renditions[0].segments;
  if (value.renditions.some((row: VideoRendition) => row.segments.length !== reference.length
    || row.segments.some((segment, index) => Math.abs(segment.duration - reference[index].duration) > .05))) return null;
  return value;
}

export function adaptiveVideoPath(source: string, manifest: AdaptiveVideoManifest, name: string) {
  if (!/^[a-zA-Z0-9/_ .-]+\.mp4$/.test(source) || source.split('/').some(part => !part || part === '.' || part === '..')
    || !parseAdaptiveVideoManifest(manifest) || !manifest.renditions.some(row => row.name === name)) throw new Error('Invalid adaptive video path.');
  return `${source}.hls-${manifest.generation}-${name}.mp4`;
}
