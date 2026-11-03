type Preview = { key: string; version?: string; previewUrl: string; posterUrl: string; withdrawn: boolean };
/** UI-local cache. Fresh API authorization/status always decides which items exist. */
export function createReviewPreviewCache() {
  const urls = new Map<string, { version?: string; until: number; previewUrl: string; posterUrl: string }>();
  return {
    clear: () => urls.clear(),
    apply<T extends Preview>(items: T[], now = Date.now()): T[] {
      const active = new Set(items.map(item => item.key));
      for (const key of urls.keys()) if (!active.has(key)) urls.delete(key);
      return items.map(item => {
        if (item.withdrawn || !item.previewUrl) { urls.delete(item.key); return item; }
        const old = urls.get(item.key);
        // Signed previews live five minutes; allow a full minute for delivery.
        if (old && old.version === item.version && old.until > now && Boolean(old.posterUrl) === Boolean(item.posterUrl)) {
          return { ...item, previewUrl: old.previewUrl, posterUrl: old.posterUrl };
        }
        urls.set(item.key, { version: item.version, until: now + 240_000, previewUrl: item.previewUrl, posterUrl: item.posterUrl });
        return item;
      });
    },
  };
}
