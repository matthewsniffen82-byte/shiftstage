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
    const href = /^(\/dancers\/|#profile-)/.test(card.href) ? card.href : "#";
    return `<article data-venue-brand="${escape(card.venueSlug || "")}" data-public-dancer-id="${escape(card.id)}"${card.discoveryAttributes || ""} class="dancer-card home-dancer-grid-card ${group}${card.compact ? " is-compact-directory" : ""}" data-profile="${escape(card.name)}" data-profile-reference="${escape(card.reference)}" data-grid-group="${group}" aria-label="${escape(card.name)}, ${escape(card.scheduleLabel)}">
      <a class="home-dancer-grid-link" href="${escape(href)}"${card.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""} aria-label="Open ${escape(card.name)}'s full profile${card.newTab ? " (opens in a new tab)" : ""}">
        ${card.photoMarkup || ""}
        <span class="home-dancer-grid-copy">
          <h3 class="home-dancer-grid-name">${escape(card.name)}</h3>
          ${card.cityMarkup || ""}${card.venueMarkup || ""}${card.distanceMarkup || ""}
          <span class="home-dancer-grid-status ${group}">${escape(card.scheduleLabel)}</span>
        </span>
      </a>${card.actionsMarkup || ""}
    </article>`;
  }
  root.MydancrDancerGrid = Object.freeze({ render, escape });
})(window);
