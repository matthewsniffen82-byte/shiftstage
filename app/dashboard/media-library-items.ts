export type MediaLibraryItem = {
  id: string;
  previewKey?: string;
  previousId?: string;
  isPrimary?: boolean;
  isPinned?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  status: string;
  moderationStatus?: string;
  upload?: {
    label: string;
    progress?: number;
    error?: string;
    removing?: boolean;
    onRemove: () => void;
  };
};

export function mergeMediaLibraryItems(saved: MediaLibraryItem[], uploads: MediaLibraryItem[], removed: string[] = []) {
  const visible = uploads.filter(item => !removed.includes(item.id) && !removed.includes(item.previousId || ""));
  const queued = visible.filter(item => item.previewKey);
  const snapshots = visible.filter(item => !item.previewKey);
  const uploadedIds = new Set(queued.flatMap(item => [item.id, item.previousId || item.id]));
  const persisted = saved.filter(item => !removed.includes(item.id)).map(item => snapshots.find(snapshot => snapshot.id === item.id) || item);
  const extraSnapshots = snapshots.filter(item => !persisted.some(stored => stored.id === item.id));
  return [
    ...[...persisted, ...extraSnapshots].filter(item => !uploadedIds.has(item.id)),
    ...queued.map(item => {
      const stored = saved.find(photo => photo.id === item.id);
      return { ...stored, ...item,
        imageUrl: item.imageUrl || stored?.imageUrl,
        videoUrl: item.videoUrl || stored?.videoUrl,
      };
    }),
  ].sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
}
