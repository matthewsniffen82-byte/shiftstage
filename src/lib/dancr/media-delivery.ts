import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyMediaPreview } from './media-delivery-url.ts';
import { myDancrTvPosterStoragePath } from './media-watermark.ts';

const NO_STORE = 'private, no-store, max-age=0';
const HEADERS = { 'Cache-Control': NO_STORE, 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const one = (row: any) => Array.isArray(row) ? row[0] : row;
const ACTIVE_PROFILE = 'id,disabled_at,user_id,app_users!dancer_profiles_user_id_fkey(account_state)';
const isActive = (row: any) => row && !row.disabled_at && one(row.app_users)?.account_state === 'active';
const safePath = (path: string) => path.length > 0 && path.length <= 1024 && /^[a-zA-Z0-9/_ .-]+$/.test(path)
  && !path.startsWith('/') && !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
const unavailable = (status = 404) => new Response(null, { status, headers: HEADERS });

type Dependencies = { publicClient: SupabaseClient; admin: SupabaseClient; storageUrl: string; serviceKey: string; fetch?: typeof fetch };
export async function serveDancerMedia(request: Request, kind: 'photo' | 'video', deps: Dependencies) {
  try {
    if (request.signal.aborted) return unavailable(503);
    const params = new URL(request.url).searchParams;
    const requestedPath = params.get('path') || '';
    const id = params.get('id') || '';
    const widthValue = params.get('width');
    const width = widthValue === null ? undefined : Number(widthValue);
    if (width !== undefined && ![96,160,320,480,640,1280,2048].includes(width)) return unavailable(400);
    if (kind === 'photo' ? !safePath(requestedPath) : !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return unavailable(400);
    const preview = params.has('preview') && verifyMediaPreview(params.get('preview') || '', kind === 'photo' ? 'photo:' + requestedPath : 'video:' + id);
    if (params.has('preview') && !preview) return unavailable();
    let path = requestedPath;
    let bucket = 'dancer-photos';
    if (kind === 'photo') {
      const master = requestedPath.replace(/\.w(320|480|640|1280|2048)\.webp$/, '');
      // Both public reads use anonymous Postgres RLS, never a service-role public
      // visibility shortcut. A saved URL is rechecked even if its feed was cached.
      const client = preview ? deps.admin : deps.publicClient;
      const [photo, avatar] = await Promise.all([
        client.from('dancer_photos').select(preview ? `storage_path,dancer_profiles!inner(${ACTIVE_PROFILE})` : 'storage_path').eq('storage_path', master).limit(1).abortSignal(request.signal).maybeSingle(),
        client.from('dancer_profiles').select(preview ? ACTIVE_PROFILE : 'id').eq('avatar_storage_path', master).limit(1).abortSignal(request.signal).maybeSingle(),
      ]);
      if (request.signal.aborted) return unavailable(503);
      if (photo.error || avatar.error) return unavailable(503);
      const allowed = preview ? isActive(one((photo.data as any)?.dancer_profiles)) || isActive(avatar.data) : Boolean(photo.data || avatar.data);
      if (!allowed) return unavailable();
      if (master !== requestedPath) {
        const manifest = master.match(/\.r(0|[1-9]\d*(?:-[1-9]\d*)*)\.m[1-9]\d*x[1-9]\d*(?:\.f\d{1,3}x\d{1,3})?\.[a-z0-9]+$/i);
        const variant = requestedPath.match(/\.w(\d+)\.webp$/)?.[1];
        if (!manifest || !variant || !manifest[1].split('-').includes(variant)) return unavailable();
      }
    } else {
      // Resolve private object names only after the public RLS row is visible.
      if (!preview) {
        const visible = await deps.publicClient.from('mydancr_tv_videos').select('id').eq('id',id).abortSignal(request.signal).maybeSingle();
        if (request.signal.aborted) return unavailable(503);
        if (visible.error) return unavailable(503);
        if (!visible.data) return unavailable();
      }
      const video = await deps.admin.from('mydancr_tv_videos').select(`storage_path,moderation_details,dancer_profiles!inner(${ACTIVE_PROFILE})`).eq('id',id).abortSignal(request.signal).maybeSingle();
      if (request.signal.aborted) return unavailable(503);
      if (video.error) return unavailable(503);
      if (!video.data || !isActive(one((video.data as any).dancer_profiles))) return unavailable();
      path = (video.data as any).storage_path;
      bucket = 'mydancr-tv-videos';
      // Old open tabs must fail back to MP4, not download an MP4 as a playlist.
      if (params.has('hls')) return unavailable();
      if (params.get('poster') === '1') {
        const expected = myDancrTvPosterStoragePath(path);
        if ((video.data as any).moderation_details?.posterStoragePath !== expected) return unavailable();
        path = expected; bucket = 'dancer-photos';
      }
      if (!safePath(path)) return unavailable();
    }
    const range = request.headers.get('range');
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return unavailable(416);
    const transform = width !== undefined && bucket === 'dancer-photos';
    const upstreamUrl = new URL(`/storage/v1/${transform ? 'render/image/authenticated' : 'object/authenticated'}/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,deps.storageUrl);
    if (transform) { upstreamUrl.searchParams.set('width',String(width)); upstreamUrl.searchParams.set('quality','80'); upstreamUrl.searchParams.set('resize','contain'); }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.signal.addEventListener('abort',cancel,{once:true});
    const timeout = setTimeout(cancel, 60_000);
    let upstream: Response;
    try {
      upstream = await (deps.fetch || fetch)(upstreamUrl, { method:request.method==='HEAD'?'HEAD':'GET', cache:'no-store', redirect:'error',
        signal:abort.signal, headers:{apikey:deps.serviceKey,authorization:`Bearer ${deps.serviceKey}`,...(range?{range}:{})} });
    } catch { clearTimeout(timeout); request.signal.removeEventListener('abort',cancel); return unavailable(503); }
    // Dispose of late headers even if the upstream transport ignored cancellation.
    if (abort.signal.aborted) { await upstream.body?.cancel(); clearTimeout(timeout); request.signal.removeEventListener('abort',cancel); return unavailable(503); }
    if (![200,206].includes(upstream.status)) { await upstream.body?.cancel(); clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);return unavailable(upstream.status===416?416:upstream.status>=500?503:404); }
    const headers = new Headers(HEADERS);
    for(const name of ['content-type','content-length','content-range','accept-ranges']) { const value=upstream.headers.get(name);if(value)headers.set(name,value); }
    const maximumBytes = bucket === 'dancer-photos' ? 10 * 1024 * 1024 : 75 * 1024 * 1024;
    const allowedType = bucket === 'dancer-photos' ? /^image\/(jpeg|png|webp)(?:;|$)/i : /^video\/(mp4|webm|quicktime)(?:;|$)/i;
    if (!allowedType.test(headers.get('content-type')||'') || Number(headers.get('content-length')) > maximumBytes) {await upstream.body?.cancel();clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);return unavailable();}
    if(request.method==='HEAD'||!upstream.body) {clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);return new Response(null,{status:upstream.status,headers});}
    const reader=upstream.body.getReader();
    const release=()=>{clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);};
    let transferred = 0;
    const body = new ReadableStream({async pull(controller){try{const next=await reader.read();if(next.done){release();controller.close();}else {transferred += next.value.byteLength;if(transferred > maximumBytes){cancel();await reader.cancel();throw new Error('Media size exceeded.');}controller.enqueue(next.value);}}catch{release();controller.error(new Error('Media stream unavailable.'));}},async cancel(){cancel();release();await reader.cancel();}});
    return new Response(body,{status:upstream.status,headers});
  } catch {return unavailable(503);}
}
