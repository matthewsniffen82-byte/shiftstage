import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bootstrap = await readFile(new URL("../src/live-shell/install-bootstrap.js", import.meta.url), "utf8");
const application = await readFile(new URL("../src/live-shell/app/27-home-screen-install.js", import.meta.url), "utf8");

function fixture({ ua = "Android Chrome", platform = "Linux", touchPoints = 1, standalone = false, appleStandalone = false } = {}) {
  class Element extends EventTarget {
    hidden = false;
    disabled = false;
    open = false;
    textContent = "";
    children = [];
    focused = false;
    replaceChildren(...children) { this.children = children; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event("close")); }
    focus() { this.focused = true; }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const window = new EventTarget();
  const media = new EventTarget();
  media.matches = standalone;
  window.matchMedia = () => media;
  let menuClosed = 0;
  const context = vm.createContext({
    Event, window,
    navigator: { userAgent: ua, platform, maxTouchPoints: touchPoints, standalone: appleStandalone },
    document: { getElementById: element, createElement: () => new Element() },
    guestMenuBtn: element("guestMenuBtn"), accountBtn: element("accountBtn"),
    closeUtilityMenu: () => { menuClosed++; },
  });
  vm.runInContext(bootstrap, context);
  return {
    window, media, element,
    start: () => vm.runInContext(application, context),
    click: async () => {
      element("homeScreenInstallBtn").dispatchEvent(new Event("click"));
      await new Promise(resolve => setImmediate(resolve));
    },
    instructions: () => element("homeScreenInstallSteps").children.map(item => item.textContent).join(" "),
    get menuClosed() { return menuClosed; },
  };
}

function nativePrompt(f, outcome = "dismissed", failure = false) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  let calls = 0;
  event.prompt = async () => {
    calls++;
    if (failure) throw new Error("Browser prompt unavailable");
  };
  event.userChoice = Promise.resolve({ outcome });
  f.window.dispatchEvent(event);
  return { event, get calls() { return calls; } };
}

test("an Android prompt captured before the app loads is only opened by the user's click", async () => {
  const f = fixture();
  const native = nativePrompt(f);
  assert.equal(native.event.defaultPrevented, true);
  f.start();
  assert.equal(native.calls, 0);
  assert.equal(f.element("homeScreenInstallBtn").hidden, false);
  await f.click();
  assert.equal(native.calls, 1);
  assert.equal(f.menuClosed, 1);
  assert.equal(f.element("homeScreenInstallDialog").open, false);
  assert.equal(f.element("homeScreenInstallBtn").disabled, false);
  // Dismissal must not reuse the one-shot event or claim installation succeeded.
  await f.click();
  assert.equal(native.calls, 1);
  assert.match(f.instructions(), /Add to Home screen or Install app/);
});

test("a failed native prompt falls back to instructions and can accept a fresh event later", async () => {
  const f = fixture();
  f.start();
  nativePrompt(f, "dismissed", true);
  await f.click();
  assert.equal(f.element("homeScreenInstallDialog").open, true);
  assert.equal(f.element("homeScreenInstallBtn").disabled, false);
  f.element("homeScreenInstallDone").dispatchEvent(new Event("click"));
  const retry = nativePrompt(f, "accepted");
  await f.click();
  assert.equal(retry.calls, 1);
  assert.equal(f.element("homeScreenInstallBtn").hidden, true);
});

test("iPhone and desktop-mode iPad get the Safari steps without requiring a native prompt", async () => {
  for (const options of [
    { ua: "iPhone Safari" },
    { ua: "iPhone CriOS" },
    { ua: "Macintosh Safari", platform: "MacIntel", touchPoints: 5 },
  ]) {
    const f = fixture(options);
    f.start();
    assert.equal(f.element("homeScreenInstallBtn").hidden, false);
    await f.click();
    assert.equal(f.element("homeScreenInstallDialog").open, true);
    assert.match(f.instructions(), /Safari.*Share.*Add to Home Screen.*Open as Web App.*Add/);
    f.element("homeScreenInstallDone").dispatchEvent(new Event("click"));
    assert.equal(f.element("homeScreenInstallDialog").open, false);
    assert.equal(f.element("guestMenuBtn").focused, true);
  }
});

test("Samsung Internet receives its own menu steps", async () => {
  const f = fixture({ ua: "Android SamsungBrowser/29.0 Chrome" });
  f.start();
  await f.click();
  assert.match(f.instructions(), /Samsung Internet menu.*Add page to, then Home screen/);
  f.element("guestMenuBtn").hidden = true;
  f.element("homeScreenInstallClose").dispatchEvent(new Event("click"));
  assert.equal(f.element("accountBtn").focused, true);
});

test("standalone launches hide the action on Android and iPhone", () => {
  for (const options of [{ standalone: true }, { ua: "iPhone Safari", appleStandalone: true }]) {
    const f = fixture(options);
    f.start();
    assert.equal(f.element("homeScreenInstallBtn").hidden, true);
  }
});

test("installation and display-mode changes hide the action and dismiss instructions", async () => {
  for (const installed of [true, false]) {
    const f = fixture();
    f.start();
    await f.click();
    if (installed) f.window.dispatchEvent(new Event("appinstalled"));
    else {
      f.media.matches = true;
      f.media.dispatchEvent(new Event("change"));
    }
    assert.equal(f.element("homeScreenInstallBtn").hidden, true);
    assert.equal(f.element("homeScreenInstallDialog").open, false);
  }
});

test("desktop browsers only show the action when a native install prompt is available", () => {
  const f = fixture({ ua: "Windows Chrome", platform: "Win32", touchPoints: 0 });
  f.start();
  assert.equal(f.element("homeScreenInstallBtn").hidden, true);
  nativePrompt(f);
  assert.equal(f.element("homeScreenInstallBtn").hidden, false);
});
