const PROFILE_MAIN_CONTEXT = "profile_main";
const PROFILE_GALLERY_CONTEXT = "profile_gallery";

export type ProfilePhotoSlot = {
  isPrimary: boolean;
  sortOrder: number | null;
  key: string;
};

export function profilePhotoUploadContext(isPrimary: boolean, sortOrder: number) {
  if (isPrimary) return PROFILE_MAIN_CONTEXT;
  const normalizedSortOrder = normalizeGallerySortOrder(sortOrder);
  return normalizedSortOrder === null
    ? PROFILE_GALLERY_CONTEXT
    : `${PROFILE_GALLERY_CONTEXT}:${normalizedSortOrder}`;
}

export function profilePhotoSlotFromUploadContext(
  value: unknown,
  fallbackSortOrder: number | null = null,
): ProfilePhotoSlot {
  const context = String(value || "").trim().toLowerCase();
  if (context === PROFILE_MAIN_CONTEXT || context.startsWith(`${PROFILE_MAIN_CONTEXT}:`)) {
    return { isPrimary: true, sortOrder: 0, key: "main" };
  }

  const matchedSortOrder = context.match(/^profile_gallery:(\d+)$/)?.[1];
  const sortOrder = normalizeGallerySortOrder(matchedSortOrder ?? fallbackSortOrder);
  return {
    isPrimary: false,
    sortOrder,
    key: sortOrder === null ? "gallery:unassigned" : `gallery:${sortOrder}`,
  };
}

export function profilePhotoSlotKey(photo: {
  is_primary?: unknown;
  isPrimary?: unknown;
  sort_order?: unknown;
  sortOrder?: unknown;
}) {
  const isPrimary = Boolean(photo?.is_primary || photo?.isPrimary);
  if (isPrimary) return "main";
  const sortOrder = normalizeGallerySortOrder(photo?.sort_order ?? photo?.sortOrder);
  return sortOrder === null ? "gallery:unassigned" : `gallery:${sortOrder}`;
}

function normalizeGallerySortOrder(value: unknown) {
  const sortOrder = Number(value);
  return Number.isInteger(sortOrder) && sortOrder > 0 ? sortOrder : null;
}
