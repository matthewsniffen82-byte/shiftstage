import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerCard, DancerProfile } from "./types";

export type ClubMedia = { photoIds: Set<string>; videoIds: Set<string>; avatarPaths: Set<string> };
export async function clubMediaPermissions(client: SupabaseClient, venueId: string, dancerIds: string[]) {
  const result = new Map<string, ClubMedia>();
  const ids = [...new Set(dancerIds)];
  for (const id of ids) result.set(id, { photoIds: new Set(), videoIds: new Set(), avatarPaths: new Set() });
  if (!ids.length) return result;
  const { data, error } = await client.rpc("club_public_media", { p_venue_id: venueId, p_dancer_ids: ids });
  if (error || !Array.isArray(data)) throw error || new Error("Club media permissions unavailable.");
  for (const row of data) {
    const media = result.get(row.dancerId);
    if (!media) continue;
    if (typeof row.photoId === "string") media.photoIds.add(row.photoId);
    if (typeof row.videoId === "string") media.videoIds.add(row.videoId);
    if (typeof row.avatarPath === "string") media.avatarPaths.add(row.avatarPath);
  }
  return result;
}

export function restrictClubCard<T extends DancerCard>(card: T, media: ClubMedia): T | null {
  const indices = (card.galleryPhotoIds || []).flatMap((id, i) => media.photoIds.has(id) ? [i] : []);
  if (!indices.length) return null;
  const primary = indices.find(i => card.galleryPhotoUrls?.[i] === card.primaryPhotoUrl) ?? indices[0];
  const imageUrl = card.galleryPhotoUrls?.[primary] || null;
  const srcSet = card.galleryPhotoSrcSets?.[primary] || null;
  // Club avatars follow the approved main photo; a separate personal avatar
  // must never reintroduce imagery the club has declined.
  return { ...card, primaryPhotoUrl: imageUrl, primaryPhotoSrcSet: srcSet,
    avatarPhotoUrl: imageUrl, avatarPhotoSrcSet: srcSet,
    primaryPhotoFocalX: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalX : 50,
    primaryPhotoFocalY: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalY : 50,
    primaryPhotoWidth: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoWidth : null,
    primaryPhotoHeight: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoHeight : null,
    avatarPhotoFocalX: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalX : 50,
    avatarPhotoFocalY: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalY : 50,
    avatarPhotoWidth: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoWidth : null,
    avatarPhotoHeight: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoHeight : null,
    galleryPhotoIds: indices.map(i => card.galleryPhotoIds![i]),
    galleryPhotoUrls: indices.map(i => card.galleryPhotoUrls![i]),
    galleryPhotoSrcSets: indices.map(i => card.galleryPhotoSrcSets?.[i] || null),
    galleryPhotoLikeCounts: indices.map(i => card.galleryPhotoLikeCounts?.[i] || 0),
    galleryPhotoPins: indices.map(i => Boolean(card.galleryPhotoPins?.[i])),
  };
}

export async function restrictClubCards<T extends DancerCard>(client: SupabaseClient, cards: T[], venueId?: string): Promise<T[]> {
  const venues = [...new Set(cards.map(card => venueId || card.venueId).filter((id): id is string => Boolean(id)))];
  const permissions = new Map(await Promise.all(venues.map(async id => [id,
    await clubMediaPermissions(client, id, cards.filter(card => (venueId || card.venueId) === id).map(card => card.id))] as const)));
  return cards.flatMap(card => {
    const id = venueId || card.venueId;
    if (!id) return [card];
    const allowed = permissions.get(id)!.get(card.id)!;
    const scoped = restrictClubCard(card, allowed);
    return scoped ? [scoped] : [];
  });
}

export async function restrictClubProfile(client: SupabaseClient, profile: DancerProfile, venueId: string): Promise<DancerProfile | null> {
  const allowed = (await clubMediaPermissions(client, venueId, [profile.id])).get(profile.id)!;
  const card = restrictClubCard(profile, allowed);
  return card ? { ...card, photos: profile.photos.filter(photo => allowed.photoIds.has(photo.id)) } : null;
}
