import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerCard, DancerProfile } from "./types";

export type ClubMedia = { photoIds: Set<string>; videoIds: Set<string>; avatarPaths: Set<string>; mainPhotoId?: string; pins?: Map<string, boolean> };
export async function withApprovedClubAffiliations<T extends DancerCard>(client: SupabaseClient, cards: T[]): Promise<T[]> {
  const ids = [...new Set(cards.filter(card => !card.venueId).map(card => card.id))];
  if (!ids.length) return cards;
  const { data, error } = await client.rpc("public_dancer_club_affiliations", { p_dancer_ids: ids });
  if (error || !Array.isArray(data)) throw error || new Error("Club affiliations unavailable.");
  const venues = new Map(data.map(row => [row.dancer_id, row]));
  return cards.map(card => {
    const venue = !card.venueId && venues.get(card.id);
    return venue ? { ...card, venueId: venue.venue_id, venueName: venue.venue_name, venueSlug: venue.venue_slug } : card;
  });
}

export async function clubMediaPermissions(client: SupabaseClient, venueId: string, dancerIds: string[]) {
  const result = new Map<string, ClubMedia>();
  const ids = [...new Set(dancerIds)];
  for (const id of ids) result.set(id, { photoIds: new Set(), videoIds: new Set(), avatarPaths: new Set(), pins: new Map() });
  if (!ids.length) return result;
  const { data, error } = await client.rpc("club_public_media", { p_venue_id: venueId, p_dancer_ids: ids });
  if (error || !Array.isArray(data)) throw error || new Error("Club media permissions unavailable.");
  for (const row of data) {
    const media = result.get(row.dancerId);
    if (!media) continue;
    if (typeof row.photoId === "string") media.photoIds.add(row.photoId);
    if (typeof row.videoId === "string") media.videoIds.add(row.videoId);
    if (typeof row.avatarPath === "string") media.avatarPaths.add(row.avatarPath);
    if (row.isMain && typeof row.photoId === "string") media.mainPhotoId = row.photoId;
    if (typeof row.isPinned === "boolean") media.pins?.set(row.photoId || row.videoId, row.isPinned);
  }
  return result;
}

export function restrictClubCard<T extends DancerCard>(card: T, media: ClubMedia): T | null {
  const indices = (card.galleryPhotoIds || []).flatMap((id, i) => media.photoIds.has(id) ? [i] : []);
  if (!indices.length) return null;
  const primary = indices.find(i => card.galleryPhotoIds?.[i] === media.mainPhotoId)
    ?? indices.find(i => card.galleryPhotoUrls?.[i] === card.primaryPhotoUrl) ?? indices[0];
  const imageUrl = card.galleryPhotoUrls?.[primary] || null;
  const srcSet = card.galleryPhotoSrcSets?.[primary] || null;
  // Keep the saved face crop only when it belongs to this club's approved main.
  // A replacement main or unrelated personal avatar must use the safe fallback.
  const keepAvatar = Boolean(card.avatarPhotoUrl && card.avatarSourcePhotoId
    && card.avatarSourcePhotoId === card.galleryPhotoIds?.[primary]);
  return { ...card, primaryPhotoUrl: imageUrl, primaryPhotoSrcSet: srcSet,
    avatarPhotoUrl: keepAvatar ? card.avatarPhotoUrl : imageUrl,
    avatarPhotoSrcSet: keepAvatar ? card.avatarPhotoSrcSet : srcSet,
    avatarSourcePhotoId: keepAvatar ? card.avatarSourcePhotoId : null,
    primaryPhotoFocalX: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalX : 50,
    primaryPhotoFocalY: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalY : 50,
    primaryPhotoWidth: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoWidth : null,
    primaryPhotoHeight: imageUrl === card.primaryPhotoUrl ? card.primaryPhotoHeight : null,
    avatarPhotoFocalX: keepAvatar ? card.avatarPhotoFocalX : imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalX : 50,
    avatarPhotoFocalY: keepAvatar ? card.avatarPhotoFocalY : imageUrl === card.primaryPhotoUrl ? card.primaryPhotoFocalY : 50,
    avatarPhotoWidth: keepAvatar ? card.avatarPhotoWidth : imageUrl === card.primaryPhotoUrl ? card.primaryPhotoWidth : null,
    avatarPhotoHeight: keepAvatar ? card.avatarPhotoHeight : imageUrl === card.primaryPhotoUrl ? card.primaryPhotoHeight : null,
    galleryPhotoIds: indices.map(i => card.galleryPhotoIds![i]),
    galleryPhotoUrls: indices.map(i => card.galleryPhotoUrls![i]),
    galleryPhotoSrcSets: indices.map(i => card.galleryPhotoSrcSets?.[i] || null),
    galleryPhotoLikeCounts: indices.map(i => card.galleryPhotoLikeCounts?.[i] || 0),
    galleryPhotoPins: indices.map(i => media.pins?.get(card.galleryPhotoIds![i]) ?? Boolean(card.galleryPhotoPins?.[i])),
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
  return card ? { ...card, photos: profile.photos.filter(photo => allowed.photoIds.has(photo.id))
    .map(photo => ({ ...photo, isPrimary: allowed.mainPhotoId ? photo.id === allowed.mainPhotoId : photo.isPrimary })) } : null;
}
