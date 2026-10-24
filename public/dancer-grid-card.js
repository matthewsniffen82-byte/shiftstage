/* Shared by homepage discovery and the public venue embed. Markup slots contain
 * trusted, escaped application markup; all scalar values are escaped here. */
(function (root) {
  "use strict";
  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }
  function render(card) {
    const group = ["is-now", "is-upcoming"].includes(card.groupClass) ? card.groupClass : "is-open";
    const href = /^(\/dancers\/|#profile-)/.test(card.href)
      || /^\/embed\/venues\/[a-z0-9-]+\/dancers\/[a-z0-9-]+(?:\?[a-zA-Z0-9%=&._-]*)?$/.test(card.href) ? card.href : "#";
    const nameMarkup = card.compact
      ? `<span class="home-dancer-grid-name-text">${escape(card.name)}</span>${group === "is-now" ? `<span class="home-dancer-grid-availability" role="img" aria-label="${escape(card.scheduleLabel)}" title="${escape(card.scheduleLabel)}"></span>` : ""}`
      : escape(card.name);
    const detailsMarkup = card.compact
      ? `${card.venueMarkup || card.cityMarkup || ""}${group === "is-now" && card.venueMarkup ? card.distanceMarkup || "" : ""}`
      : `${card.cityMarkup || ""}${card.venueMarkup || ""}${card.distanceMarkup || ""}<span class="home-dancer-grid-status ${group}">${escape(card.scheduleLabel)}</span>`;
    return `<article data-venue-brand="${escape(card.venueSlug || "")}" data-public-dancer-id="${escape(card.id)}"${card.discoveryAttributes || ""} class="dancer-card home-dancer-grid-card ${group}${card.compact ? " is-compact-directory" : ""}" data-profile="${escape(card.name)}" data-profile-reference="${escape(card.reference)}" data-grid-group="${group}" aria-label="${escape(card.name)}, ${escape(card.scheduleLabel)}">
      <a class="home-dancer-grid-link" href="${escape(href)}"${card.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""} aria-label="Open ${escape(card.name)}'s full profile${card.newTab ? " (opens in a new tab)" : ""}">
        ${card.photoMarkup || ""}
        <span class="home-dancer-grid-copy">
          <h3 class="home-dancer-grid-name">${nameMarkup}</h3>
          ${detailsMarkup}
        </span>
      </a>${card.compact ? card.quickFollowMarkup || "" : ""}${card.actionsMarkup || ""}
    </article>`;
  }
  // Patch cards in place so changing a count, placement or name does not
  // unmount every portrait and restart the grid's image loading state.
  const snapshots = new WeakMap();
  function key(node) { return node.getAttribute?.("data-public-dancer-id") || ""; }
  function remember(node) {
    snapshots.set(node, node.cloneNode(true));
    node.childNodes.forEach(remember);
  }
  function syncNode(current, next) {
    const previous = current && snapshots.get(current);
    const changedImage = previous?.nodeName === "IMG" && next.nodeName === "IMG"
      && ["src", "srcset", "sizes"].some(name => previous.getAttribute(name) !== next.getAttribute(name));
    if (!previous || previous.nodeName !== next.nodeName || changedImage) {
      remember(next);
      return next;
    }
    if (previous.isEqualNode(next)) return current;
    const snapshot = next.cloneNode(true);
    if (next.nodeType === 1) {
      [...previous.attributes].forEach(({ name }) => { if (!next.hasAttribute(name)) current.removeAttribute(name); });
      [...next.attributes].forEach(({ name, value }) => { if (previous.getAttribute(name) !== value) current.setAttribute(name, value); });
      syncChildren(current, next);
    } else current.nodeValue = next.nodeValue;
    snapshots.set(current, snapshot);
    return current;
  }
  function syncChildren(current, next) {
    const existing = [...current.childNodes];
    const keyed = new Map(existing.map(node => [key(node), node]).filter(([id]) => id));
    const retained = new Set();
    [...next.childNodes].forEach((child, index) => {
      const id = key(child);
      const candidate = id ? keyed.get(id) : existing[index];
      const previous = candidate && !retained.has(candidate) && key(candidate) === id ? candidate : null;
      const node = syncNode(previous, child);
      retained.add(node);
      if (current.childNodes[index] !== node) current.insertBefore(node, current.childNodes[index] || null);
    });
    existing.forEach(node => { if (!retained.has(node) && node.parentNode === current) node.remove(); });
  }
  function update(container, markup) {
    const template = container.ownerDocument.createElement("template");
    template.innerHTML = markup;
    syncChildren(container, template.content);
  }
  root.MydancrDancerGrid = Object.freeze({ render, escape, update });
})(window);
