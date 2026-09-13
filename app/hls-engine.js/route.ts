import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const script = await readFile(path.join(process.cwd(), 'node_modules/hls.js/dist/hls.light.min.mjs'));
  return new Response(script, { headers: {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': new URL(request.url).searchParams.get('v') === '1.7.3'
      ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  } });
}
