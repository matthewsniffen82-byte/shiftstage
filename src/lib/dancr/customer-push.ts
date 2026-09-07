export type CustomerNotificationDelivery = {
  emailAvailable?: boolean;
  pushAvailable?: boolean;
  pushAppId?: string;
  pushExternalId?: string;
};

type PushSdk = {
  init(options: Record<string, unknown>): Promise<void>;
  login(id: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: { isPushSupported(): boolean; permission: boolean; requestPermission(): Promise<void> };
  User: { PushSubscription: { id?: string; optedIn: boolean; optIn(): Promise<void>; optOut(): Promise<void>; addEventListener(event: "change", listener: () => void): void; removeEventListener(event: "change", listener: () => void): void } };
};
type PushWindow = Window & { OneSignalDeferred?: Array<(sdk: PushSdk) => void> };
let sdkPromise: Promise<PushSdk> | undefined;
let currentSdk: PushSdk | undefined;
const PUSH_SCOPE = "/push/onesignal/";
const PUSH_DEVICE_KEY = "mydancr:push-account";

function boundedPush<T>(operation: Promise<T>, milliseconds = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Push setup took too long. Please try again.")), milliseconds);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

export function customerPushSupportMessage() {
  if (typeof window === "undefined") return "";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches) {
    return "Add MyDancr to your Home Screen, then open it there to enable push.";
  }
  if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "Push notifications are not supported in this browser.";
  }
  if (Notification.permission === "denied") return "Push is blocked. Allow notifications in this browser’s site settings.";
  return "";
}

export async function customerPushDeviceEnabled(userId: string) {
  try {
    if (customerPushSupportMessage() || Notification.permission !== "granted" || localStorage.getItem(PUSH_DEVICE_KEY) !== userId) return false;
    const registration = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
    if (!registration?.scope.endsWith(PUSH_SCOPE)) return false;
    return Boolean(await registration?.pushManager.getSubscription());
  } catch { return false; }
}

function loadPushSdk(appId: string) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<PushSdk>((resolve, reject) => {
    const pushWindow = window as PushWindow;
    pushWindow.OneSignalDeferred ||= [];
    pushWindow.OneSignalDeferred.push(async sdk => {
      try {
        await sdk.init({ appId, serviceWorkerPath: "push/onesignal/OneSignalSDKWorker.js", serviceWorkerParam: { scope: PUSH_SCOPE },
          autoResubscribe: false, notifyButton: { enable: false }, welcomeNotification: { disable: true },
          promptOptions: { slidedown: { prompts: [] } },
        });
        currentSdk = sdk;
        resolve(sdk);
      } catch { reject(new Error("Unable to connect push notifications. Please try again.")); }
    });
    if (!document.getElementById("mydancr-push-sdk")) {
      const script = document.createElement("script");
      script.id = "mydancr-push-sdk";
      script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
      script.async = true;
      script.onerror = () => { script.remove(); reject(new Error("Unable to load push notifications. Please try again.")); };
      document.head.appendChild(script);
    }
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export async function enableCustomerPush(delivery: CustomerNotificationDelivery, userId: string, assertCurrent: () => void) {
  const unsupported = customerPushSupportMessage();
  if (unsupported) throw new Error(unsupported);
  if (!delivery.pushAvailable || !delivery.pushAppId || !delivery.pushExternalId) throw new Error("Push notifications are not available yet.");
  // Request permission directly from the user's tap, before loading the SDK.
  const permission = await Notification.requestPermission();
  assertCurrent();
  if (permission !== "granted") throw new Error("Push stays off until you allow notifications on this device.");
  const sdk = await boundedPush(loadPushSdk(delivery.pushAppId));
  assertCurrent();
  if (!sdk.Notifications.isPushSupported()) throw new Error("Push notifications are not supported in this browser.");
  await boundedPush(sdk.login(delivery.pushExternalId));
  assertCurrent();
  await boundedPush(sdk.User.PushSubscription.optIn());
  assertCurrent();
  const subscription = sdk.User.PushSubscription;
  if (!subscription.optedIn || !subscription.id) {
    let changed: () => void = () => {};
    try {
      await boundedPush(new Promise<void>(resolve => {
        changed = () => { if (subscription.optedIn && subscription.id) resolve(); };
        subscription.addEventListener("change", changed);
        changed();
      }));
    } finally { subscription.removeEventListener("change", changed); }
  }
  assertCurrent();
  localStorage.setItem(PUSH_DEVICE_KEY, userId);
}

export async function disableCustomerPush() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(PUSH_DEVICE_KEY); } catch { /* Storage may be blocked. */ }
  const unsubscribe = async () => {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
      if (!registration?.scope.endsWith(PUSH_SCOPE)) return;
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    }
  };
  // Native unsubscribe works after a reload without reloading the SDK. Do not
  // let a slow provider prevent the customer from leaving their account.
  await Promise.allSettled([
    boundedPush(unsubscribe(), 3_000),
    ...(currentSdk ? [boundedPush(currentSdk.User.PushSubscription.optOut().then(() => currentSdk?.logout()), 3_000)] : []),
  ]);
}
