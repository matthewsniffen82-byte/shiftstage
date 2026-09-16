/* Contextual opt-in only. Visiting a public page never requests permission. */
(function installPushInvitations() {
  if (window.mydancrPushInvitationsInstalled) return;
  window.mydancrPushInvitationsInstalled = true;
  const script = document.currentScript;
  const deviceUrl = script?.dataset.deviceModule;
  const sessionKey = "dancrAuthSessionV1", historyPrefix = "mydancr:push-invitations:v1:";
  const moments = {
    "customer-follow": ["customer", "Keep up with your favorites", "Get notified when dancers you follow are working and when your favorite clubs post deals."],
    "customer-pickup": ["customer", "Stay updated on your pickup", "Enable notifications for venue replies and pickup status updates, even when you leave this chat."],
    "customer-pickup-phone": ["customer", "Keep up with MyDancr", "The club will contact you by phone about this pickup. Enable notifications for updates from dancers and clubs you follow."],
    "dancer-review": ["dancer", "Know when your profile is ready", "Get notified when your profile is approved or needs an update."],
    "dancer-shift": ["dancer", "Keep up with your dancer account", "Get profile updates and important account alerts while you’re away from MyDancr."],
    "venue-dashboard": ["venue", "Keep your venue up to date", "Get notified when your venue page is ready for review and when requests need your attention."],
    "venue-live": ["venue", "Your venue is live", "Enable notifications for customer pickup requests and important venue updates."],
    "venue-pickup": ["venue", "Know when customers need a ride", "Enable notifications for new pickup requests and customer messages."],
    "venue-chat": ["venue", "Don’t miss a customer’s reply", "Enable notifications when customers message you about their pickup, even when you leave this chat."],
    settings: ["", "Push notifications", "Manage notifications on this device."],
  };
  const memory = new Map();
  let devicePromise, current = null, loading = false;
  function session() {
    try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; }
  }
  function identity(value = session()) {
    return value?.accessToken && typeof value.account?.id === "string" ? `${value.account.role}:${value.account.id}` : "";
  }
  function history(id) {
    try { return JSON.parse(localStorage.getItem(historyPrefix + id) || "null") || memory.get(id) || {}; }
    catch { return memory.get(id) || {}; }
  }
  function remember(id, moment, dismissed = false) {
    const next = { ...history(id), [moment]: true, ...(dismissed ? { dismissedAt: Date.now() } : {}) };
    memory.set(id, next);
    try { localStorage.setItem(historyPrefix + id, JSON.stringify(next)); } catch { /* In-memory suppression still works. */ }
  }
  function eligible(moment, id) {
    if (moment === "settings") return true;
    const saved = history(id);
    const cooldown = /pickup|chat/.test(moment) ? 10 * 60_000 : 24 * 60 * 60_000;
    return !saved[moment] && !(saved.dismissedAt && Date.now() - saved.dismissedAt < cooldown);
  }
  function close() {
    if (!current) return;
    current.card.remove(); current = null;
  }
  function assertAccount(id) {
    if (!id || identity() !== id) throw new Error("Your account changed. Reopen notification settings to continue.");
  }
  async function request(path, id, body) {
    assertAccount(id);
    const auth = session();
    const response = await fetch(path, {
      method: body ? "PATCH" : "GET", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${auth.accessToken}`, ...(auth.refreshToken ? { "x-dancr-refresh-token": auth.refreshToken } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assertAccount(id);
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update notifications. Please try again.");
    return data;
  }
  function changed(userId, profile) {
    window.dispatchEvent(new CustomEvent("mydancr:push-changed", { detail: { userId, profile } }));
  }
  async function offer(moment) {
    const copy = moments[moment], auth = session(), id = identity(auth);
    if (!copy || !id || !["customer", "dancer", "venue"].includes(auth.account.role)
      || (copy[0] && copy[0] !== auth.account.role) || !eligible(moment, id) || loading || current || !deviceUrl) return;
    if (moment !== "settings" && window.Notification?.permission === "denied") return;
    loading = true;
    try {
      devicePromise ||= import(deviceUrl).catch(error => { devicePromise = null; throw error; });
      const device = await devicePromise;
      const enabled = await device.customerPushDeviceEnabled(auth.account.id);
      assertAccount(id);
      if (enabled && moment !== "settings") return;
      const result = await request("/api/notifications", id);
      if (result.pushUserId !== auth.account.id) return;
      const delivery = result.notificationDelivery || {};
      const support = device.customerPushSupportMessage();
      // No promotional invitation for a channel that cannot currently enroll.
      if (!delivery.pushAvailable && moment !== "settings") return;
      if (support && !/Home Screen/.test(support) && moment !== "settings") return;
      const historyMoment = support ? `${moment}:installation` : moment;
      if (moment !== "settings" && history(id)[historyMoment]) return;
      assertAccount(id);
      const card = document.createElement("section");
      card.className = "mydancr-push-invitation";
      card.setAttribute("aria-label", "Notification invitation");
      const heading = document.createElement("h2"), message = document.createElement("p");
      heading.textContent = copy[1];
      message.textContent = !delivery.pushAvailable
        ? "Push alerts are currently unavailable. " + (enabled ? "You can still turn off notifications on this device." : "Check MyDancr for new messages and updates.")
        : enabled ? "Notifications are enabled on this device." : support || copy[2];
      message.setAttribute("role", "status");
      const actions = document.createElement("div"); actions.className = "mydancr-push-invitation-actions";
      const enable = document.createElement("button"), dismiss = document.createElement("button");
      enable.type = dismiss.type = "button";
      enable.textContent = enabled ? "Disable on this device" : "Enable notifications";
      enable.disabled = !enabled && (!delivery.pushAvailable || Boolean(support));
      dismiss.textContent = moment === "settings" || enabled ? "Close" : "Not now";
      dismiss.onclick = () => { remember(id, historyMoment, true); close(); };
      enable.onclick = async () => {
        if (enable.disabled) return;
        const active = current;
        enable.disabled = dismiss.disabled = true;
        try {
          assertAccount(id);
          if (enabled) {
            await device.disableCustomerPush();
            assertAccount(id);
            message.textContent = "Notifications are off on this device.";
            changed(auth.account.id);
          } else {
            // Calls Notification.requestPermission synchronously from this tap.
            await device.enableCustomerPush(delivery, auth.account.id, () => assertAccount(id));
            let profile;
            if (auth.account.role === "customer") {
              const saved = await request("/api/customer/profile", id, { notificationSettings: { pushEnabled: true } });
              if (saved.profile?.notificationSettings?.pushEnabled !== true) throw new Error("Your notification preference was not confirmed. Please try again.");
              profile = saved.profile;
            }
            assertAccount(id);
            message.textContent = "Notifications are enabled on this device.";
            changed(auth.account.id, profile);
          }
          enable.hidden = true; dismiss.textContent = "Done";
        } catch (error) {
          if (identity() === id) {
            if (!enabled) await device.disableCustomerPush();
            message.textContent = error.message || "Unable to enable notifications. Please try again.";
            enable.disabled = Boolean(device.customerPushSupportMessage());
          } else close();
        } finally { if (current === active) dismiss.disabled = false; }
      };
      if (enabled || delivery.pushAvailable) actions.append(enable);
      actions.append(dismiss); card.append(heading, message, actions);
      document.body.append(card);
      current = { card, id };
      remember(id, historyMoment);
    } catch { /* A failed invitation must never interrupt the completed action. */ }
    finally { loading = false; }
  }
  window.addEventListener("mydancr:push-invitation", event => { void offer(event.detail?.moment); });
  const checkAccount = () => { if (current && identity() !== current.id) close(); };
  window.addEventListener("storage", checkAccount);
  window.addEventListener("focus", checkAccount);
  window.addEventListener("pageshow", checkAccount);
  // Settings buttons work in both the discovery shell and React dashboards.
  document.addEventListener("click", event => {
    if (event.target.closest?.("[data-push-settings]")) void offer("settings");
  });
  if (window.mydancrPendingPushInvitation) {
    void offer(window.mydancrPendingPushInvitation);
    delete window.mydancrPendingPushInvitation;
  }
})();
