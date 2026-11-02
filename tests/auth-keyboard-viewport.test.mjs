import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/live-shell/app/13-open-profile-modal.js');
const viewportSource = source.slice(source.indexOf('    let authViewportFrame'), source.indexOf('    function openAuthPage'));

function fixture({ touch = true, visualViewport = true } = {}) {
  const frames = [], timers = [], properties = new Map(), viewportEvents = {}, windowEvents = {}, authEvents = {};
  const state = { shown: true, fieldY: 700, rootScrolls: 0 };
  const viewport = { height: 350, offsetTop: 180, addEventListener: (type, fn) => { viewportEvents[type] = fn; } };
  const sheetTop = () => visualViewport ? Math.max(20, viewport.offsetTop) : 20;
  class Element {}
  const field = Object.assign(new Element(), {
    matches: () => true,
    getBoundingClientRect: () => ({ top: sheetTop() + state.fieldY - page.scrollTop, bottom: sheetTop() + state.fieldY - page.scrollTop + 44, height: 44 }),
    scrollIntoView: () => { state.rootScrolls++; },
  });
  const page = {
    scrollTop: 0,
    get clientHeight() { return visualViewport ? viewport.height + viewport.offsetTop - sheetTop() : 720; },
    classList: { contains: () => state.shown }, contains: element => element === field,
    style: { setProperty: (key, value) => properties.set(key, value) },
    getBoundingClientRect: () => ({ top: sheetTop() }),
    addEventListener: (type, fn) => { authEvents[type] = fn; },
  };
  const document = { activeElement: field };
  vm.runInNewContext(viewportSource, {
    authPage: page, document, HTMLElement: Element,
    window: {
      visualViewport: visualViewport ? viewport : undefined, innerHeight: 740,
      matchMedia: () => ({ matches: touch }),
      requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
      setTimeout: fn => timers.push(fn), addEventListener: (type, fn) => { windowEvents[type] = fn; },
    },
  });
  return { state, viewport, page, field, document, properties, frames,
    resize() { (visualViewport ? viewportEvents : windowEvents).resize(); },
    pan() { viewportEvents.scroll({ type: 'scroll' }); },
    focus() { authEvents.focusin({ target: field }); timers.splice(0).forEach(fn => fn()); },
    flush() { frames.splice(0).forEach(fn => fn()); },
  };
}

test('keyboard opening reveals a clipped field by scrolling only the login sheet', () => {
  const f = fixture();
  f.resize(); f.flush();
  assert.equal(f.properties.get('--dancr-auth-viewport-height'), '350px');
  assert.equal(f.properties.get('--dancr-auth-viewport-top'), '180px');
  assert.equal(f.page.scrollTop, 406);
  assert.equal(f.field.getBoundingClientRect().bottom, 518);
  assert.equal(f.state.rootScrolls, 0);
});

test('scrolling toward Sign in is not pulled back to the focused password field', () => {
  const f = fixture();
  f.page.scrollTop = 800;
  f.viewport.offsetTop = 210;
  f.pan(); f.pan();
  assert.equal(f.frames.length, 1);
  f.flush();
  assert.equal(f.page.scrollTop, 800);
  assert.equal(f.properties.get('--dancr-auth-viewport-top'), '210px');
  assert.equal(f.state.rootScrolls, 0);
});

test('focus and resize coalesce without losing field visibility or moving an already visible field', () => {
  const f = fixture();
  f.focus(); f.pan(); f.resize();
  assert.equal(f.frames.length, 1);
  f.flush();
  assert.equal(f.page.scrollTop, 406);
  f.focus(); f.flush();
  assert.equal(f.page.scrollTop, 406);
  f.state.fieldY = 100;
  f.focus(); f.flush();
  assert.equal(f.page.scrollTop, 88);
  assert.equal(f.state.rootScrolls, 0);
});

test('keyboard dismissal restores the full viewport and closed sheets ignore queued events', () => {
  const f = fixture();
  f.resize(); f.flush();
  f.document.activeElement = null;
  f.viewport.height = 740; f.viewport.offsetTop = 0;
  f.resize(); f.flush();
  assert.equal(f.properties.get('--dancr-auth-viewport-height'), '740px');
  assert.equal(f.properties.get('--dancr-auth-viewport-top'), '0px');
  f.resize(); f.state.shown = false; f.properties.clear(); f.flush();
  assert.equal(f.properties.size, 0);
  assert.equal(f.state.rootScrolls, 0);
});

test('window resizing works without VisualViewport and desktop focus does not force scroll', () => {
  const f = fixture({ visualViewport: false });
  f.resize(); f.flush();
  assert.equal(f.properties.get('--dancr-auth-viewport-height'), '740px');
  assert.equal(f.page.scrollTop, 36);
  const desktop = fixture({ touch: false });
  desktop.focus(); desktop.resize(); desktop.flush();
  assert.equal(desktop.page.scrollTop, 0);
});

test('keyboard geometry takes precedence over the shared important full-screen rules', () => {
  const styles = postcss.parse(read('src/live-shell/styles/override-styles-07-profile-backdrop-schedule-upcoming-profile-schedule-primary.css'));
  const theme = postcss.parse(read('public/dancr-aesthetic.v1.css'));
  let auth, shared;
  styles.walkRules(rule => { if (rule.selector === 'body.dancr-button-system #authPage.show') auth = rule; });
  theme.walkRules(rule => { if (rule.selector === 'body.dancr-button-system .page-panel.show') shared = rule; });
  assert.ok(auth); assert.ok(shared);
  assert.match(auth.parent.params, /\(max-width: 720px\), \(hover: none\) and \(pointer: coarse\)/);
  const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node]));
  const login = declarations(auth);
  for (const prop of ['top', 'bottom', 'height']) {
    assert.equal(declarations(shared)[prop].important, true);
    assert.equal(login[prop].important, true, `${prop} must beat the shared full-screen rule; the login ID gives higher specificity`);
  }
  assert.equal(login['min-height'].value, '0');
  assert.equal(login.bottom.value, 'auto');
  assert.equal(login.top.value, 'var(--dancr-auth-sheet-top)');
  assert.equal(login['--dancr-auth-sheet-top'].value, 'max(var(--mydancr-preview-banner-offset, 0px), var(--dancr-auth-viewport-top, 0px))');
  assert.equal(login.height.value, 'calc(var(--dancr-auth-viewport-height, 100dvh) + var(--dancr-auth-viewport-top, 0px) - var(--dancr-auth-sheet-top))');
});
