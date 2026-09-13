// Read the actual AVC profile/compatibility/level from our generated fMP4 init.
// The encoder explicitly emits AAC-LC when an audio track is present.
export function adaptiveVideoCodecs(init: Buffer) {
  if (!init.length || init.length > 65536) throw new Error('Invalid adaptive initialization segment.');
  const video: string[] = [];
  let audio = false;
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  function visit(start: number, end: number) {
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) throw new Error('Truncated adaptive initialization box.');
      const size = init.readUInt32BE(offset);
      if (size < 8 || offset + size > end) throw new Error('Invalid adaptive initialization box size.');
      const type = init.toString('ascii', offset + 4, offset + 8);
      const payload = offset + 8, next = offset + size;
      if (containers.has(type)) visit(payload, next);
      else if (type === 'stsd') visit(payload + 8, next);
      else if (type === 'avc1') visit(payload + 78, next);
      else if (type === 'mp4a') audio = true;
      else if (type === 'avcC') {
        if (payload + 4 > next || init[payload] !== 1) throw new Error('Invalid AVC decoder configuration.');
        video.push('avc1.' + init.subarray(payload + 1, payload + 4).toString('hex'));
      }
      offset = next;
    }
  }
  visit(0, init.length);
  if (video.length !== 1) throw new Error('Expected one AVC track in adaptive video.');
  return video[0] + (audio ? ',mp4a.40.2' : '');
}
