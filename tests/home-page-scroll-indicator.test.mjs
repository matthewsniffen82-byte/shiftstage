import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const source = readFileSync(new URL("../src/live-shell/app/20-render.js", import.meta.url), "utf8");
const styles = postcss.parse(readFileSync(new URL("../src/live-shell/styles/override-styles-03-home-discovery-empty-action-is-secondary-hover-home-discovery-em.css", import.meta.url), "utf8"));
const indicatorSource = source.slice(source.indexOf("    function homeTvFeedUsesSnapViewport()"), source.indexOf("    function setupHomeTvFeedObserver()"));

function classList() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
  };
}

function harness({ tab = "dancers", mobile = true, samsung = false, scrollHeight = 3200 } = {}) {
  const root = { classList: classList(), clientHeight: 800, scrollHeight, scrollTop: 0 };
  if (samsung) root.classList.add("is-samsung-browser");
  const children = [];
  const frames = [];
  const timers = new Map();
  const observers = [];
  const context = vm.createContext({
    activeTab: tab,
    homeTvFeedSnapMedia: { matches: mobile },
    homeTvPageScrollRail: null,
    homeTvPageScrollThumb: null,
    homeTvPageScrollFrame: 0,
    homeTvPageScrollIdleTimer: 0,
    homeTvPageScrollResizeObserver: null,
    document: {
      documentElement: root,
      scrollingElement: root,
      body: { appendChild(node) { node.isConnected = true; children.push(node); } },
      createElement() {
        return {
          classList: classList(), style: {}, attributes: {}, hidden: false,
          get clientHeight() { return this.hidden ? 0 : 796; },
          setAttribute(name, value) { this.attributes[name] = value; },
          appendChild(node) { node.isConnected = true; },
        };
      },
    },
    window: {
      innerHeight: 800, ResizeObserver: true,
      requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
      setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    ResizeObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    },
  });
  vm.runInContext(indicatorSource, context);
  return { context, root, children, timers, observers, flush() { while (frames.length) frames.shift()(); } };
}

test("mobile dancers prepare one compact edge indicator without TV snapping", () => {
  const { context, root, children } = harness();
  context.syncHomeTvPageScrollIndicator();
  assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
  assert.equal(root.classList.contains("home-tv-page-snap"), false);
  assert.equal(context.homeTvPageScrollRail.hidden, false);
  assert.equal(context.homeTvPageScrollRail.attributes["aria-hidden"], "true");
  assert.equal(context.homeTvPageScrollThumb.style.height, "96px");
  assert.equal(context.homeTvPageScrollRail.classList.contains("is-scrolling"), false);
  assert.equal(context.homeTvPageScrollThumb.style.transform, "translate3d(0, 0px, 0)");
  context.syncHomeTvPageScrollIndicator();
  assert.equal(children.length, 1);
  root.scrollTop = 1200;
  context.syncHomeTvPageScrollIndicator();
  assert.equal(context.homeTvPageScrollThumb.style.transform, "translate3d(0, 350px, 0)");
  root.scrollTop = 2400;
  context.syncHomeTvPageScrollIndicator();
  assert.equal(context.homeTvPageScrollThumb.style.transform, "translate3d(0, 700px, 0)");
});

test("a short page hides the indicator and loaded results make it measurable again", () => {
  const { context, root, observers, flush } = harness({ scrollHeight: 800 });
  context.syncHomeTvPageScrollIndicator();
  assert.equal(context.homeTvPageScrollRail.hidden, true);
  root.scrollHeight = 3200;
  observers[0]();
  observers[0]();
  flush();
  assert.equal(context.homeTvPageScrollRail.hidden, false);
  assert.equal(context.homeTvPageScrollThumb.style.height, "96px");
});

test("desktop and other destinations restore native scrolling and clear activity timers", () => {
  const { context, root, timers } = harness();
  context.syncHomeTvPageScrollIndicator();
  context.markHomeTvPageScrollIndicatorActive();
  assert.equal(timers.size, 1);
  context.homeTvFeedSnapMedia.matches = false;
  context.syncHomeTvPageScrollIndicator();
  assert.equal(root.classList.contains("home-page-scroll-indicator"), false);
  assert.equal(context.homeTvPageScrollRail.hidden, true);
  assert.equal(timers.size, 0);
  context.homeTvFeedSnapMedia.matches = true;
  context.activeTab = "account";
  context.syncHomeTvPageScrollIndicator();
  assert.equal(root.classList.contains("home-page-scroll-indicator"), false);
  assert.equal(context.homeTvPageScrollRail.hidden, true);
});

test("TV keeps its existing snap behavior and shares the same indicator", () => {
  const { context, root, children, flush } = harness({ tab: "tv" });
  context.syncHomeTvPageSnapState();
  flush();
  assert.equal(root.classList.contains("home-tv-page-snap"), true);
  assert.equal(context.homeTvPageScrollRail.hidden, false);
  context.activeTab = "dancers";
  context.syncHomeTvPageSnapState();
  flush();
  assert.equal(root.classList.contains("home-tv-page-snap"), false);
  assert.equal(context.homeTvPageScrollRail.hidden, false);
  assert.equal(children.length, 1);
});

test("Samsung shares one fading indicator across dancers, clubs and TV", () => {
  const { context, root, children, timers, flush } = harness({ samsung: true });
  context.queueHomeTvPageScrollIndicatorSync();
  flush();
  assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
  assert.equal(children.length, 1);
  context.markHomeTvPageScrollIndicatorActive();
  assert.equal(timers.size, 1);
  assert.equal(context.homeTvPageScrollRail.classList.contains("is-scrolling"), true);
  [...timers.values()][0]();
  assert.equal(context.homeTvPageScrollRail.classList.contains("is-scrolling"), false);
  context.activeTab = "venues";
  context.syncHomeTvPageSnapState();
  flush();
  assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
  assert.equal(root.classList.contains("home-tv-page-snap"), false);
  assert.equal(children.length, 1);
  context.activeTab = "tv";
  context.syncHomeTvPageSnapState();
  flush();
  assert.equal(root.classList.contains("home-tv-page-snap"), true);
  assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
  assert.equal(children.length, 1);
  context.homeTvFeedSnapMedia.matches = false;
  context.syncHomeTvPageSnapState();
  flush();
  context.homeTvFeedSnapMedia.matches = true;
  context.syncHomeTvPageSnapState();
  flush();
  assert.equal(children.length, 1);
  assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
});

test("late Samsung detection keeps the same indicator without a duplicate", () => {
  const { context, root, timers } = harness();
  context.syncHomeTvPageScrollIndicator();
  context.markHomeTvPageScrollIndicatorActive();
  root.classList.add("is-samsung-browser");
  context.syncHomeTvPageScrollIndicator();
  assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
  assert.equal(context.homeTvPageScrollRail.hidden, false);
  assert.equal(context.homeTvPageScrollRail.classList.contains("is-scrolling"), true);
  assert.equal(timers.size, 1);
});

test("club thumb stays compact on short pages and retains a visible minimum on long pages", () => {
  for (const [scrollHeight, expected] of [[1000, "96px"], [32000, "48px"]]) {
    const { context, root } = harness({ tab: "venues", scrollHeight });
    context.syncHomeTvPageScrollIndicator();
    assert.equal(root.classList.contains("home-page-scroll-indicator"), true);
    assert.equal(context.homeTvPageScrollThumb.style.height, expected);
    root.scrollTop = scrollHeight - 800;
    context.syncHomeTvPageScrollIndicator();
    assert.equal(context.homeTvPageScrollThumb.style.transform, `translate3d(0, ${796 - parseInt(expected)}px, 0)`);
  }
});

test("scroll activity restarts the idle timer so continuous scrolling remains visible", () => {
  const { context, timers } = harness({ tab: "venues" });
  context.syncHomeTvPageScrollIndicator();
  context.markHomeTvPageScrollIndicatorActive();
  context.markHomeTvPageScrollIndicatorActive();
  assert.equal(timers.size, 1);
  assert.equal(context.homeTvPageScrollRail.classList.contains("is-scrolling"), true);
  [...timers.values()][0]();
  assert.equal(context.homeTvPageScrollRail.classList.contains("is-scrolling"), false);
});

test("indicator styles stay at the mobile viewport edge without changing content geometry", () => {
  const rules = [];
  styles.walkRules((rule) => {
    if (/home-page-scroll-indicator|home-tv-page-scroll-rail|is-samsung-browser/.test(rule.selector)) rules.push(rule);
  });
  const rail = rules.find((rule) => rule.selector === ".home-tv-page-scroll-rail");
  const declarations = Object.fromEntries(rail.nodes.map(({ prop, value }) => [prop, value]));
  assert.equal(rail.parent.params, "(max-width: 720px)");
  assert.equal(declarations.position, "fixed");
  assert.equal(declarations.right, "1px");
  assert.equal(declarations.width, "2px");
  assert.equal(declarations["pointer-events"], "none");
  assert.equal(declarations.opacity, "0");
  assert.equal(declarations.transition, "opacity .2s ease");
  const activeRail = rules.find((rule) => rule.selector === ".home-tv-page-scroll-rail.is-scrolling");
  assert.equal(activeRail.nodes.find(({ prop }) => prop === "opacity").value, ".6");
  const nativeScroll = rules.find((rule) => rule.selectors.includes("html.home-page-scroll-indicator"));
  assert.deepEqual(nativeScroll.nodes.map(({ prop, value, important }) => [prop, value, important]), [["scrollbar-width", "none", true], ["scrollbar-color", "transparent transparent", true]]);
  const nativeFallback = rules.find((rule) => rule.selectors.includes("html.home-page-scroll-indicator::-webkit-scrollbar"));
  assert.deepEqual(nativeFallback.nodes.map(({ prop, value, important }) => [prop, value, important]), [["width", "0", true], ["height", "0", true], ["display", "none", true]]);
  assert.equal(rules.some((rule) => rule.selector.includes("html.is-samsung-browser")), false, "Native hiding must depend on the replacement, not the user agent.");
  assert.ok(rules.some((rule) => rule.selector.includes(".overlay-open") && rule.nodes.some(({ prop, value }) => prop === "display" && value === "none")));
  assert.match(source, /function render\(\) \{[^]*?queueHomeTvPageScrollIndicatorSync\(\);/);
});

test("TV snapping does not hide the native scrollbar without a custom replacement", () => {
  styles.walkRules((rule) => {
    if (!/html\.home-tv-page-snap/.test(rule.selector)) return;
    assert.equal(rule.nodes.some(({ prop }) => prop?.startsWith("scrollbar-")), false);
    assert.doesNotMatch(rule.selector, /::-webkit-scrollbar/);
  });
});
