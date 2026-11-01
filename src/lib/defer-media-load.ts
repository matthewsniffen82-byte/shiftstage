// Delay the authenticated fetch itself, rather than only the eventual blob img.
export function deferMediaLoad(
  element: Element | null,
  load: () => void,
  { eager = false, Observer = globalThis.IntersectionObserver } = {},
) {
  if (eager || !element || !Observer) {
    load();
    return () => {};
  }
  let started = false;
  const observer = new Observer(entries => {
    if (started || !entries.some(entry => entry.isIntersecting)) return;
    started = true;
    observer.disconnect();
    load();
  }, { rootMargin: "600px 0px" });
  observer.observe(element);
  return () => { started = true; observer.disconnect(); };
}
