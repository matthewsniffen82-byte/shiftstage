import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import { staticAssetPaths } from '../src/lib/dancr/static-asset-paths.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const theme = postcss.parse(read('public/dancr-palette.v1.css'));
const rules = [];
theme.walkRules(rule => rules.push(rule));

test('both rendering systems load the palette and cache its exact version', () => {
  assert.match(read('app/layout.tsx'), /import "\.\.\/public\/dancr-palette\.v1\.css";/);
  for (const file of ['src/live-shell/shell.html', 'outputs/index.html']) {
    const source = read(file);
    assert.ok(source.indexOf('/dancr-brand-tokens.v1.css') < source.indexOf('/dancr-palette.v1.css'));
    assert.match(source, /<link href="\/dancr-palette\.v1\.css" rel="stylesheet">/);
  }
  assert.ok(staticAssetPaths.includes('/dancr-palette.v1.css'));
  assert.match(read('public/dancr-brand-tokens.v1.css'), /@layer dancr-palette, dancr-follow-controls;/);
});

test('every palette selector excludes actual Internal and embedded contexts', () => {
  assert.ok(rules.length > 20);
  for (const rule of rules) {
    assert.match(rule.selector, /^html:not\(\.internal-profile-embed\) body\.dancr-button-system:not\(\.venue-grid-embed\)/);
    assert.ok(rule.selector.includes(':not(:where(.ir-shell, .ir-shell *, .venue-embed-profile-page, .venue-embed-profile-page *))') ||
      rule.selector.includes(':not(:has(.ir-shell, .venue-embed-profile-page))'), rule.selector);
    assert.doesNotMatch(rule.selector, /data-venue-brand/, 'public venue affiliation is not a branded experience');
  }
});

test('the site palette changes paint without changing layout, media, or hero artwork', () => {
  const paint = new Set(['background', 'background-color', 'background-image', 'color', 'border-color', 'box-shadow', 'text-shadow', 'filter', 'stroke', 'outline-color']);
  theme.walkDecls(decl => {
    assert.ok(decl.prop.startsWith('--') || paint.has(decl.prop), decl.prop);
    assert.equal(decl.important, true);
  });
  for (const rule of rules) {
    assert.doesNotMatch(rule.selector, /\.hero|(?<![-.\w])(?:img|video)(?![-\w])/);
  }
  const source = read('src/live-shell/shell.html');
  assert.match(source, /dancr-hero-480-10b0c648e5b6\.webp/);
  assert.match(source, /dancr-hero-1280-70c171eee35b\.webp/);
});

test('primary actions exclude destructive, confirmed, disabled and secondary states', () => {
  const primary = rules.find(rule => rule.selector.includes('input[type="submit"]'));
  assert.ok(primary);
  for (const state of ['.secondary', '[class*="danger"]', '[class*="delete"]', '[class*="reject"]', '[data-action-state="success"]', '.is-confirmed', ':disabled', '[aria-disabled="true"]']) {
    assert.ok(primary.selector.includes(state), state);
  }
  const controls = rules.find(rule => rule.selector.includes('.dashboard-shell .info-panel button'));
  for (const state of ['[role="switch"]', '.customer-notification-switch', '.profile-upload-preview *', '.profile-media-control']) {
    assert.ok(controls.selector.includes(state), state);
  }
});

test('all dashboard selections and painted mobile control faces use the shared tokens', () => {
  const selected = rules.find(rule => rule.selector.includes('.dancer-dashboard-nav button[aria-current="page"]') && !rule.selector.includes(' svg'));
  for (const target of ['.customer-workspace-nav', '.venue-workspace-tabs', '.admin-workspace-nav', '.vip-dashboard-nav', '.account-auth-tabs', '.auth-entry-tab']) {
    assert.ok(selected.selector.includes(target), target);
  }
  assert.ok(selected.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-color-brand-primary)'));
  for (const name of ['--discovery-control-face', '--follow-control-face', '--profile-action-background', '--venue-utility-face']) {
    assert.ok(rules.some(rule => rule.nodes.some(decl => decl.prop === name && decl.value === 'var(--dancr-color-surface)')), name);
  }
});
