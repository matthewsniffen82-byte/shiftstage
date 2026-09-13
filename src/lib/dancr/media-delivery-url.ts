import { publicAppUrl } from './public-app-url.ts';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Called only by server serializers after their normal owner/admin authorization.
// Preview capabilities never authorize a disabled account, and never reveal a
// provider credential or a direct Storage signed URL.
const PREVIEW_SECONDS = 3600;
function signature(value: string) {
  const secret = process.env.DANCR_ACCOUNT_RECOVERY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Media preview signing is unavailable.');
  return createHmac('sha256', secret).update('mydancr-media-preview-v1\0' + value).digest('base64url');
}
export function mediaPreviewToken(resource: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ resource, expires: Math.floor(now / 1000) + PREVIEW_SECONDS })).toString('base64url');
  return payload + '.' + signature(payload);
}
export function verifyMediaPreview(token: string, resource: string, now = Date.now()) {
  if (token.length > 4096) return false;
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra || !/^[\w-]+$/.test(supplied)) return false;
  const expected = signature(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return value.resource === resource && Number.isSafeInteger(value.expires)
      && value.expires > Math.floor(now / 1000);
  } catch { return false; }
}
export function dancerPhotoDeliveryUrl(path: string, width?: number, preview = false) {
  const query = new URLSearchParams({ path });
  if (width) query.set('width', String(width));
  if (preview) query.set('preview', mediaPreviewToken('photo:' + path));
  return publicAppUrl() + '/api/media/dancer-photo?' + query;
}
export function dancerVideoDeliveryUrl(id: string, poster = false, preview = false) {
  const query = new URLSearchParams({ id });
  if (poster) query.set('poster', '1');
  if (preview) query.set('preview', mediaPreviewToken('video:' + id));
  return publicAppUrl() + '/api/media/dancer-video?' + query;
}
