(() => {
  if (window.__mydancrThirdPartySocialLinkWarning) return;
  window.__mydancrThirdPartySocialLinkWarning = true;

  const socialDestinations = [
    { domain: "instagram.com", label: "Instagram" },
    { domain: "tiktok.com", label: "TikTok" },
    { domain: "snapchat.com", label: "Snapchat" },
    { domain: "onlyfans.com", label: "OnlyFans" },
    { domain: "x.com", label: "X" },
    { domain: "twitter.com", label: "X" },
    { domain: "threads.net", label: "Threads" },
    { domain: "facebook.com", label: "Facebook" },
    { domain: "youtube.com", label: "YouTube" },
    { domain: "youtu.be", label: "YouTube" },
    { domain: "twitch.tv", label: "Twitch" },
    { domain: "reddit.com", label: "Reddit" },
    { domain: "linkedin.com", label: "LinkedIn" },
    { domain: "discord.com", label: "Discord" },
    { domain: "discord.gg", label: "Discord" },
  ];
  const replayLinks = new WeakSet();
  let activeLink = null;
  let activeDestination = null;
  let previouslyFocused = null;

  function matchingSocialDestination(hostname) {
    const normalizedHost = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return socialDestinations.find(({ domain }) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`)) || null;
  }

  function socialDestinationFor(link) {
    if (!(link instanceof HTMLAnchorElement)) return null;
    if (link.hasAttribute("download")) return null;
    if (link.dataset.thirdPartySocialWarning === "off") return null;
    if (link.target.toLowerCase() !== "_blank" && link.dataset.thirdPartySocialLink !== "true") return null;

    try {
      const url = new URL(link.href, window.location.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const social = matchingSocialDestination(url.hostname);
      if (!social) return null;
      return { ...social, hostname: url.hostname.toLowerCase(), url: url.href };
    } catch {
      return null;
    }
  }

  function warningMarkup() {
    return `
      <div id="mydancrThirdPartySocialWarning" hidden>
        <div class="mydancr-third-party-social-backdrop" data-third-party-social-cancel aria-hidden="true"></div>
        <section class="mydancr-third-party-social-dialog" role="dialog" aria-modal="true" aria-labelledby="mydancrThirdPartySocialTitle" aria-describedby="mydancrThirdPartySocialDescription" tabindex="-1">
          <p class="mydancr-third-party-social-eyebrow">External social link</p>
          <div class="mydancr-third-party-social-copy">
            <h2 id="mydancrThirdPartySocialTitle">You’re leaving MyDancr</h2>
            <p id="mydancrThirdPartySocialDescription">This social link opens a third-party site. MyDancr does not control its content, privacy practices, or security.</p>
          </div>
          <div class="mydancr-third-party-social-destination">
            <span>Destination</span>
            <strong id="mydancrThirdPartySocialDomain"></strong>
          </div>
          <div class="mydancr-third-party-social-actions">
            <button class="mydancr-third-party-social-stay" type="button" data-third-party-social-cancel>Stay on MyDancr</button>
            <button class="mydancr-third-party-social-continue" type="button" data-third-party-social-continue>Continue</button>
          </div>
          <p class="mydancr-third-party-social-note">Only continue if you recognize and trust this destination.</p>
        </section>
      </div>
    `;
  }

  function warningElements() {
    return {
      root: document.getElementById("mydancrThirdPartySocialWarning"),
      dialog: document.querySelector(".mydancr-third-party-social-dialog"),
      domain: document.getElementById("mydancrThirdPartySocialDomain"),
      stay: document.querySelector(".mydancr-third-party-social-stay"),
      proceed: document.querySelector(".mydancr-third-party-social-continue"),
    };
  }

  function closeWarning({ restoreFocus = true } = {}) {
    const { root } = warningElements();
    if (root) root.hidden = true;
    document.documentElement.classList.remove("mydancr-third-party-social-warning-open");
    activeLink = null;
    activeDestination = null;
    if (restoreFocus && previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
    previouslyFocused = null;
  }

  function openWarning(link, destination) {
    const { root, domain, stay, proceed } = warningElements();
    if (!root || !domain || !stay || !proceed) return;
    activeLink = link;
    activeDestination = destination;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : link;
    domain.textContent = destination.hostname;
    proceed.textContent = `Continue to ${destination.label}`;
    proceed.setAttribute("aria-label", `Continue to ${destination.hostname}`);
    root.hidden = false;
    document.documentElement.classList.add("mydancr-third-party-social-warning-open");
    window.setTimeout(() => stay.focus({ preventScroll: true }), 0);
  }

  function replayApprovedClick() {
    const link = activeLink;
    const destination = activeDestination;
    closeWarning({ restoreFocus: false });
    if (!link || !destination) return;

    if (link.isConnected) {
      replayLinks.add(link);
      link.click();
      return;
    }

    const replacement = document.createElement("a");
    replacement.href = destination.url;
    replacement.target = "_blank";
    replacement.rel = "noopener noreferrer";
    replacement.dataset.thirdPartySocialWarning = "off";
    replacement.click();
  }

  function handleCapturedClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    const link = target instanceof Element ? target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    if (replayLinks.has(link)) {
      replayLinks.delete(link);
      return;
    }
    const destination = socialDestinationFor(link);
    if (!destination) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openWarning(link, destination);
  }

  function handleDialogKeydown(event) {
    const { root, dialog } = warningElements();
    if (!root || root.hidden || !dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeWarning();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not([disabled]), a[href]")].filter((element) => element instanceof HTMLElement && !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function initializeWarning() {
    if (!document.getElementById("mydancrThirdPartySocialWarning")) {
      document.body.insertAdjacentHTML("beforeend", warningMarkup());
    }
    const { root } = warningElements();
    if (!root) return;
    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-third-party-social-continue]")) {
        replayApprovedClick();
      } else if (target.closest("[data-third-party-social-cancel]")) {
        closeWarning();
      }
    });
    document.addEventListener("keydown", handleDialogKeydown);
  }

  document.addEventListener("click", handleCapturedClick, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWarning, { once: true });
  } else {
    initializeWarning();
  }
})();
