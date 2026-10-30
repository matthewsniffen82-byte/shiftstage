(function (root) {
  "use strict";
  if (root.MydancrIdentityBadge) return;
  const explanation = "Identity and age 18+ verified through Ondato.";
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2 3 5v6c0 5.1 3.4 9.1 9 11 5.6-1.9 9-5.9 9-11V5l-9-3Z"/><path d="m7.5 12 3 3 6-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function markup(verified, profile = false) {
    if (verified !== true) return "";
    return `<button type="button" class="dancer-identity-badge${profile ? " is-profile" : ""}" data-identity-verified-badge aria-label="ID verified. Learn about verification" aria-haspopup="dialog" title="${explanation}">${icon}</button>`;
  }
  let dialog, opener;
  function show(button) {
    if (!dialog) {
      dialog = root.document.createElement("dialog");
      dialog.className = "dancer-identity-explanation";
      dialog.setAttribute("aria-labelledby", "dancer-identity-title");
      dialog.setAttribute("aria-describedby", "dancer-identity-description");
      dialog.innerHTML = `${icon}<h2 id="dancer-identity-title">ID verified</h2><p id="dancer-identity-description">${explanation}</p><form method="dialog"><button type="submit" autofocus>Got it</button></form>`;
      dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener("close", () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
      root.document.body.append(dialog);
    }
    opener = button;
    if (!dialog.open) dialog.showModal();
  }
  root.document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-identity-verified-badge]");
    if (!button) return;
    // This action explains verification; it must not open the surrounding card
    // or count as a dancer-profile navigation in delegated analytics handlers.
    event.preventDefault();
    event.stopImmediatePropagation();
    show(button);
  }, true);
  root.MydancrIdentityBadge = Object.freeze({ markup });
})(window);
