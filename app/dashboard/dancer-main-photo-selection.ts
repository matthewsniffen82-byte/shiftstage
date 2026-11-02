import { clubEditorMedia, mediaClubStatuses, mediaLibraryStatus, selectedClubMediaRows, type ClubMediaState } from "../../src/lib/dancr/club-media-status.ts";
import type { DancerPhotoItem } from "./dashboard-types";

// Club main-photo flags take precedence over the global profile's main photo.
export function dancerMainPhotoSelection(items: DancerPhotoItem[], clubMedia?: ClubMediaState) {
  const scoped = Boolean(clubMedia?.filterToClub);
  const unavailable = scoped && (!clubMedia?.selectedClub || Boolean(clubMedia.loading || clubMedia.error));
  const rows = selectedClubMediaRows(clubMedia);
  const photos = clubEditorMedia(items, clubMedia).map(photo => scoped ? {
    ...photo,
    isPrimary: mediaClubStatuses(rows, photo.id).some(row => row.isMain ?? photo.isPrimary),
  } : photo);
  const approved = (photo: DancerPhotoItem) => photo.status === "approved"
    && (!scoped || mediaLibraryStatus(photo, clubMedia, "photo") === "approved");
  const main = photos.find(photo => photo.isPrimary && approved(photo));
  const pendingPhoto = photos.find(photo => photo.isPrimary && (scoped ? !approved(photo) : photo.status === "pending"));
  return { photos, main, pendingPhoto, displayed: pendingPhoto || main, unavailable };
}
