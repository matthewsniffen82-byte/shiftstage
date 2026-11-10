// Dedicated anonymous delivery paths keep the main site's media gate intact.
// These serializers receive only media from the existing public profile loaders.
export function venueEmbedMediaUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.mydancr.com");
    const kind = url.pathname === "/api/media/dancer-photo" ? "photo" : url.pathname === "/api/media/dancer-video" ? "video" : null;
    if (!kind) return value;
    if (url.searchParams.has("preview")) return null;
    return `/api/public/venue-embed-media/${kind}${url.search}`;
  } catch { return null; }
}

export function venueEmbedMediaSrcSet(value, primaryPhotoUrl) {
  const variants = String(value || "").split(",").flatMap(source => {
    const match = source.trim().match(/^(\S+)\s+(\d+)w$/);
    const url = match && venueEmbedMediaUrl(match[1]);
    return url ? [`${url} ${match[2]}w`] : [];
  }).join(", ");
  if (variants) return variants;
  // Older approved photos lack a manifest. Request widths of the same authorized object.
  const photo = venueEmbedMediaUrl(primaryPhotoUrl);
  if (!photo?.startsWith("/api/public/venue-embed-media/photo?")) return null;
  const url = new URL(photo, "https://www.mydancr.com");
  if (url.searchParams.has("preview") || !url.searchParams.get("path")) return null;
  return [160, 320, 480, 640].map(width => {
    url.searchParams.set("width", String(width));
    return `${url.pathname}${url.search} ${width}w`;
  }).join(", ");
}

// Explicitly select public presentation fields; never serialize review notes or private profile data.
export function venueEmbedMediaSnapshot(profile, videos) {
  const portrait = prefix => ({
    [`${prefix}PhotoUrl`]: venueEmbedMediaUrl(profile[`${prefix}PhotoUrl`]),
    [`${prefix}PhotoSrcSet`]: venueEmbedMediaSrcSet(profile[`${prefix}PhotoSrcSet`]),
    [`${prefix}PhotoWidth`]: profile[`${prefix}PhotoWidth`] ?? null,
    [`${prefix}PhotoHeight`]: profile[`${prefix}PhotoHeight`] ?? null,
    [`${prefix}PhotoFocalX`]: profile[`${prefix}PhotoFocalX`] ?? profile.primaryPhotoFocalX ?? profile.photos[0]?.focalX ?? 50,
    [`${prefix}PhotoFocalY`]: profile[`${prefix}PhotoFocalY`] ?? profile.primaryPhotoFocalY ?? profile.photos[0]?.focalY ?? 50,
  });
  return {
    profile: { id: profile.id, ...portrait("primary"), ...portrait("avatar"),
      photos: profile.photos.map(photo => ({
        id: photo.id, imageUrl: venueEmbedMediaUrl(photo.imageUrl) || "",
        imageSrcSet: venueEmbedMediaSrcSet(photo.imageSrcSet), imageWidth: photo.imageWidth ?? null, imageHeight: photo.imageHeight ?? null,
        focalX: photo.focalX ?? 50, focalY: photo.focalY ?? 50,
        isPrimary: Boolean(photo.isPrimary), isPinned: Boolean(photo.isPinned), sortOrder: photo.sortOrder ?? 0, likeCount: photo.likeCount ?? 0,
      })),
    },
    tvVideos: videos.map(video => ({
      id: video.id, videoUrl: venueEmbedMediaUrl(video.videoUrl) || "", posterUrl: venueEmbedMediaUrl(video.posterUrl),
      durationSeconds: video.durationSeconds ?? 0, isPinned: Boolean(video.isPinned), publishedAt: video.publishedAt || "",
      mobilePlaybackAvailable: Boolean(video.mobilePlaybackAvailable), likeCount: video.likeCount ?? 0,
    })),
  };
}

// Ignore changing likes, but detect withdrawals, new media, cropping and display order.
export function venueEmbedMediaRevision(profile, videos) {
  const media = venueEmbedMediaSnapshot(profile, videos);
  const withoutLikes = rows => rows.map(({ likeCount: _likes, ...item }) => item);
  return JSON.stringify({ profile: { ...media.profile, photos: withoutLikes(media.profile.photos) }, tvVideos: withoutLikes(media.tvVideos) });
}
