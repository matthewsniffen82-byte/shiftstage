// Generated from src/lib/dancr/customer-push.ts. Do not edit.
const PUSH_SCOPE = "/push/web/";
const PUSH_DEVICE_KEY = "mydancr:push-account";
const SESSION_KEY = "dancrAuthSessionV1";
let enrolling = false;
function boundedPush(operation, milliseconds = 15_000) {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Push setup took too long. Please try again.")), milliseconds);
        operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
    });
}
export function customerPushSupportMessage() {
    if (typeof window === "undefined")
        return "";
    const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (appleMobile && !standalone) {
        return "Add MyDancr to your Home Screen: in Safari, tap Share, then Add to Home Screen. Open the new MyDancr icon, sign in, and enable notifications. Requires iOS 16.4 or later.";
    }
    if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        return "Push notifications are not supported in this browser.";
    }
    if (Notification.permission === "denied")
        return "Push is blocked. Allow notifications in this browser’s site settings.";
    return "";
}
// A follow alone does not confirm delivery outside the app. Check the saved
// alert preferences and an available email or enrolled push channel first.
export async function customerWorkingNowAlertsEnabled(profile, userId) {
    if (!userId || profile?.userId !== userId)
        return false;
    const settings = profile.notificationSettings || {};
    const delivery = profile.notificationDelivery || {};
    if (settings.followAlertsEnabled === false || settings.workingNow === false)
        return false;
    if (settings.emailEnabled === true && delivery.emailAvailable === true)
        return true;
    return settings.pushEnabled === true && delivery.pushAvailable === true
        && await customerPushDeviceEnabled(userId);
}
function pushSession() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    }
    catch {
        return null;
    }
}
async function pushRequest(userId, method = "GET", body) {
    const expected = pushSession();
    if (!expected?.accessToken || expected.account?.id !== userId)
        throw new Error("Sign in again to enable notifications.");
    const response = await fetch("/api/push/subscriptions", {
        method, headers: { authorization: `Bearer ${expected.accessToken}`, "content-type": "application/json",
            ...(expected.refreshToken ? { "x-dancr-refresh-token": expected.refreshToken } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
        throw new Error(data.error || "Unable to register this device for notifications.");
    if (pushSession()?.account?.id !== userId || data.userId !== userId)
        throw new Error("Your account changed. Reopen notification settings.");
    if (data.session?.accessToken && pushSession()?.accessToken === expected.accessToken) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ ...expected, ...data.session }));
    }
    return data;
}
async function endpointHash(endpoint) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function setWorkerAccount(registration, accountId) {
    const worker = registration.active;
    if (!worker)
        throw new Error("Notification setup is still starting. Try again.");
    const channel = new MessageChannel();
    try {
        await boundedPush(new Promise((resolve, reject) => {
            channel.port1.onmessage = event => event.data?.ok === true ? resolve() : reject(new Error("Unable to save notification setup on this device."));
            worker.postMessage({ type: "MYDANCR_PUSH_ACCOUNT", accountId }, [channel.port2]);
        }));
    }
    finally {
        channel.port1.close();
        channel.port2.close();
    }
}
async function readyWorker() {
    const registration = await boundedPush(navigator.serviceWorker.register("/push/web/worker.js", { scope: PUSH_SCOPE, updateViaCache: "none" }));
    if (!registration.active) {
        const worker = registration.installing || registration.waiting;
        if (!worker)
            throw new Error("Notification setup is still starting. Try again.");
        let changed = () => { };
        try {
            await boundedPush(new Promise((resolve, reject) => {
                changed = () => { if (worker.state === "activated")
                    resolve();
                else if (worker.state === "redundant")
                    reject(new Error("Unable to start notifications. Try again.")); };
                worker.addEventListener("statechange", changed);
                changed();
            }));
        }
        finally {
            worker.removeEventListener("statechange", changed);
        }
    }
    return registration;
}
export async function customerPushDeviceEnabled(userId) {
    try {
        if (customerPushSupportMessage() || Notification.permission !== "granted" || localStorage.getItem(PUSH_DEVICE_KEY) !== userId || pushSession()?.account?.id !== userId)
            return false;
        const registration = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
        if (!registration?.scope.endsWith(PUSH_SCOPE))
            return false;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription)
            return false;
        const data = await pushRequest(userId);
        if (!data.subscriptionIds?.includes(await endpointHash(subscription.endpoint)))
            return false;
        await setWorkerAccount(registration, userId);
        return pushSession()?.account?.id === userId;
    }
    catch {
        return false;
    }
}
export async function enableCustomerPush(delivery, userId, assertCurrent) {
    const unsupported = customerPushSupportMessage();
    if (unsupported)
        throw new Error(unsupported);
    if (!delivery.pushAvailable || !delivery.pushPublicKey)
        throw new Error("Push notifications are not available yet.");
    if (enrolling)
        throw new Error("Notification setup is already in progress.");
    const current = () => { assertCurrent(); if (pushSession()?.account?.id !== userId)
        throw new Error("Your account changed. Reopen notification settings."); };
    current();
    enrolling = true;
    let subscription = null;
    let registered = false;
    try {
        // This must remain before any network/worker await, directly inside the tap.
        const permission = await Notification.requestPermission();
        current();
        if (permission !== "granted")
            throw new Error("Push stays off until you allow notifications on this device.");
        const registration = await readyWorker();
        current();
        subscription = await registration.pushManager.getSubscription();
        current();
        const key = Uint8Array.from(atob(delivery.pushPublicKey.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
        const existingKey = subscription?.options.applicationServerKey;
        const previousAccount = localStorage.getItem(PUSH_DEVICE_KEY);
        if (subscription && ((previousAccount && previousAccount !== userId) || !existingKey || new Uint8Array(existingKey).join() !== key.join())) {
            await subscription.unsubscribe();
            subscription = null;
            current();
        }
        if (!subscription)
            subscription = await boundedPush(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        current();
        const data = await pushRequest(userId, "POST", { publicKey: delivery.pushPublicKey, subscription: subscription.toJSON() });
        registered = true;
        current();
        if (data.subscriptionId !== await endpointHash(subscription.endpoint))
            throw new Error("Your notification subscription could not be confirmed.");
        await setWorkerAccount(registration, userId);
        current();
        localStorage.setItem(PUSH_DEVICE_KEY, userId);
        // Retire old provider subscriptions after successful direct enrollment.
        try {
            const legacy = await navigator.serviceWorker.getRegistration("/push/onesignal/");
            if (legacy?.scope.endsWith("/push/onesignal/")) {
                await (await legacy.pushManager.getSubscription())?.unsubscribe();
                await legacy.unregister();
            }
        }
        catch { /* Legacy cleanup cannot undo confirmed direct enrollment. */ }
    }
    catch (error) {
        if (subscription) {
            if (registered && pushSession()?.account?.id === userId)
                await pushRequest(userId, "DELETE", { endpoint: subscription.endpoint }).catch(() => { });
            await subscription.unsubscribe().catch(() => { });
        }
        if (localStorage.getItem(PUSH_DEVICE_KEY) === userId)
            localStorage.removeItem(PUSH_DEVICE_KEY);
        throw error;
    }
    finally {
        enrolling = false;
    }
}
export async function disableCustomerPush() {
    if (typeof window === "undefined")
        return;
    const userId = localStorage.getItem(PUSH_DEVICE_KEY) || pushSession()?.account?.id;
    localStorage.removeItem(PUSH_DEVICE_KEY);
    if (!("serviceWorker" in navigator))
        return;
    await Promise.allSettled([PUSH_SCOPE, "/push/onesignal/"].map(scope => boundedPush((async () => {
        const registration = await navigator.serviceWorker.getRegistration(scope);
        if (!registration?.scope.endsWith(scope) || localStorage.getItem(PUSH_DEVICE_KEY))
            return;
        if (scope === PUSH_SCOPE)
            await setWorkerAccount(registration, null).catch(() => { });
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription || localStorage.getItem(PUSH_DEVICE_KEY))
            return;
        await Promise.allSettled([
            subscription.unsubscribe(),
            ...(scope === PUSH_SCOPE && userId && pushSession()?.account?.id === userId ? [pushRequest(userId, "DELETE", { endpoint: subscription.endpoint })] : []),
        ]);
    })(), 3_000)));
}
