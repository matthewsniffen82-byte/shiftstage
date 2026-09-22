import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bootstrap = await readFile(new URL("../src/live-shell/install-bootstrap.js", import.meta.url), "utf8");

function fixture(ua = "Android Chrome") {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  };
  const window = new EventTarget();
  vm.runInNewContext(bootstrap, {
    window,
    navigator: { userAgent: ua },
    document: {
      getElementById: element,
      querySelectorAll: () => [element("mobile-web-app-capable"), element("apple-mobile-web-app-capable")],
    },
  });
  return { window, element };
}

test("automatic browser install prompts remain suppressed", () => {
  for (const ua of ["Android Chrome", "Android SamsungBrowser/29.0 Chrome", "Windows Chrome"]) {
    const f = fixture(ua);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    let calls = 0;
    event.prompt = () => { calls++; };
    f.window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(calls, 0);
  }
});

test("Samsung Internet retains its browser shortcut metadata including in desktop mode", () => {
  for (const ua of ["Android SamsungBrowser/29.0 Chrome", "X11 Linux x86_64 SamsungBrowser/29.0 Chrome"]) {
    const f = fixture(ua);
    assert.equal(f.element("homeScreenManifest").href, "/manifest-shortcut.webmanifest");
    assert.equal(f.element("mobile-web-app-capable").content, "no");
    assert.equal(f.element("apple-mobile-web-app-capable").content, "no");
  }
});

test("only Samsung uses browser mode while other phones retain their standalone app manifest", async () => {
  const original = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const shortcut = JSON.parse(await readFile(new URL("../public/manifest-shortcut.webmanifest", import.meta.url), "utf8"));
  assert.deepEqual(shortcut, { ...original, display: "browser", display_override: ["browser"] });
  for (const ua of ["Android Chrome", "iPhone Safari"]) {
    const f = fixture(ua);
    assert.equal(f.element("homeScreenManifest").href, "/manifest.webmanifest");
    assert.notEqual(f.element("mobile-web-app-capable").content, "no");
  }
});
