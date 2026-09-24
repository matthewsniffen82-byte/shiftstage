export function publishDancerVisibility(dancerId: string, isPublic: boolean) {
  window.dispatchEvent(new CustomEvent("mydancr:dancer-visibility-saved", {
    detail: { dancerId, isPublic },
  }));
}
