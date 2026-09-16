import { createHmac, timingSafeEqual } from "node:crypto";

export const VENUE_VIDEO_COOKIE = "mydancrVenueVideo";
const UUID = /^[0-9a-f-]{36}$/i;
const signature = (value: string, secret: string) => createHmac("sha256", secret).update(`venue-video:${value}`).digest("base64url");

export function signVenueVideo(videoId: string, venueId: string, secret: string, now = Date.now()) {
  const value = `${videoId}.${venueId}.${now + 30 * 60 * 1000}`;
  return `${value}.${signature(value, secret)}`;
}

export function readVenueVideo(request: Request, venueId: string, secret: string | undefined, now = Date.now()): string | null {
  if (!secret) return null;
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${VENUE_VIDEO_COOKIE}=`))?.slice(VENUE_VIDEO_COOKIE.length + 1);
  if (!cookie || cookie.length > 200) return null;
  const [video, venue, expires, signed, extra] = cookie.split(".");
  if (extra || !UUID.test(video || "") || venue !== venueId || !Number.isFinite(Number(expires)) || Number(expires) <= now || Number(expires) > now + 30 * 60 * 1000) return null;
  const expected = signature(`${video}.${venue}.${expires}`, secret);
  if (!signed || !/^[A-Za-z0-9_-]{43}$/.test(signed) || !timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return null;
  return video;
}
