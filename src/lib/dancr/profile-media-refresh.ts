/** Keep the viewed item after additions/reordering; choose a neighbor if it was withdrawn. */
export function refreshedMediaIndex(previous: readonly { id: string }[], next: readonly { id: string }[], index: number) {
  if (!next.length) return null;
  const retained = next.findIndex(item => item.id === previous[index]?.id);
  return retained >= 0 ? retained : Math.min(Math.max(index, 0), next.length - 1);
}
