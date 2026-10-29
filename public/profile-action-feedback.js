/* Small, transient confirmations shared by public profiles and the discovery shell. */
(() => {
  "use strict";
  let dismissCurrent = () => {};

  function dismiss() { dismissCurrent(); }

  function show(anchor, message) {
    dismiss();
    if (!anchor?.isConnected || !anchor.getClientRects().length) return;
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= win.innerHeight) return;
    const notice = doc.createElement("span");
    notice.className = "profile-action-feedback";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-atomic", "true");
    (doc.fullscreenElement || doc.body).appendChild(notice);
    notice.textContent = message;
    const size = notice.getBoundingClientRect();
    const left = rect.left >= size.width + 16 ? rect.left - size.width - 8 : rect.right + 8;
    notice.style.left = `${Math.max(8, Math.min(left, win.innerWidth - size.width - 8))}px`;
    notice.style.top = `${Math.max(8, Math.min(rect.top + (rect.height - size.height) / 2, win.innerHeight - size.height - 8))}px`;
    const remove = () => {
      win.clearTimeout(timer);
      doc.removeEventListener("scroll", remove, true);
      win.removeEventListener("resize", remove);
      win.removeEventListener("pagehide", remove);
      notice.remove();
      if (dismissCurrent === remove) dismissCurrent = () => {};
    };
    const timer = win.setTimeout(remove, 1800);
    doc.addEventListener("scroll", remove, true);
    win.addEventListener("resize", remove);
    win.addEventListener("pagehide", remove);
    dismissCurrent = remove;
  }

  const api = { show, dismiss };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.MyDancrActionFeedback = api;
})();
