// A modal dialog makes its background inert, but does not stop page scrolling.
// Fix the body as well as hiding root overflow so mobile browsers stay put.
export function lockHelpPageScroll(page: Document = document, viewport: Window = window) {
  const root = page.documentElement;
  const body = page.body;
  const left = viewport.scrollX;
  const top = viewport.scrollY;
  const gutter = Math.max(0, viewport.innerWidth - root.clientWidth);
  const paddingRight = viewport.getComputedStyle(body).paddingRight;
  const previous: Array<{ style: CSSStyleDeclaration; property: string; value: string; priority: string }> = [];
  function set(style: CSSStyleDeclaration, property: string, value: string) {
    previous.push({ style, property, value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) });
    style.setProperty(property, value, "important");
  }
  set(root.style, "overflow", "hidden");
  set(root.style, "overscroll-behavior", "none");
  set(body.style, "position", "fixed");
  set(body.style, "top", `${-top}px`);
  set(body.style, "left", `${-left}px`);
  set(body.style, "width", "100%");
  set(body.style, "box-sizing", "border-box");
  set(body.style, "overflow", "hidden");
  if (gutter) set(body.style, "padding-right", `calc(${paddingRight} + ${gutter}px)`);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const { style, property, value, priority } of previous.reverse()) {
      if (value) style.setProperty(property, value, priority);
      else style.removeProperty(property);
    }
    viewport.scrollTo({ left, top, behavior: "instant" });
  };
}
