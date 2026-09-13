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

export function adaptiveVideoPlaylist(manifest: AdaptiveVideoManifest, requestUrl: URL, rendition?: VideoRendition) {
  const endpoint = (name: string, media = false) => {
    const url = new URL(requestUrl.pathname, requestUrl.origin);
    // Preserve only the resource-bound preview capability, never arbitrary input.
    for (const key of ['id', 'preview']) if (requestUrl.searchParams.has(key)) url.searchParams.set(key, requestUrl.searchParams.get(key)!);
    url.searchParams.set('hls', media ? 'media' : name);
    url.searchParams.set('generation', manifest.generation);
    if (media) url.searchParams.set('rendition', name);
    return url.pathname + url.search;
  };
  if (!rendition) return '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n' + manifest.renditions.map(row => {
    const peak = Math.ceil(Math.max(...row.segments.map(segment => segment.bytes * 8 / segment.duration)));
    const average = Math.ceil(row.bytes * 8 / row.segments.reduce((sum, segment) => sum + segment.duration, 0));
    return `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${average},RESOLUTION=${row.width}x${row.height}${row.codecs ? `,CODECS="${row.codecs}"` : ''}\n${endpoint(row.name)}\n`;
  }).join('');
  const uri = endpoint(rendition.name, true);
  let offset = rendition.initBytes;
  return `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...rendition.segments.map(row => row.duration)))}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI="${uri}",BYTERANGE="${rendition.initBytes}@0"\n` + rendition.segments.map(segment => {
    const line = `#EXTINF:${segment.duration.toFixed(6)},\n#EXT-X-BYTERANGE:${segment.bytes}@${offset}\n${uri}\n`;
    offset += segment.bytes;
    return line;
  }).join('') + '#EXT-X-ENDLIST\n';
}
