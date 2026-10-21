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
  for (const file of ['src/live-shell/shell.html', 'outputs/index.html', 'app/embed/venues/[slug]/route.ts']) {
    const source = read(file);
    assert.ok(source.indexOf('/dancr-brand-tokens.v1.css') < source.indexOf('/dancr-palette.v1.css'));
    assert.match(source, /<link href="\/dancr-palette\.v1\.css" rel="stylesheet">/);
  }
  assert.ok(staticAssetPaths.includes('/dancr-palette.v1.css'));
  assert.match(read('public/dancr-brand-tokens.v1.css'), /@layer dancr-palette, dancr-follow-controls;/);
});

test('the shared palette reaches public, Internal and embedded contexts', () => {
  assert.ok(rules.length > 20);
  for (const rule of rules) {
    assert.match(rule.selector, /^html body\.dancr-button-system/);
    assert.doesNotMatch(rule.selector, /html:not\(\.internal-profile-embed\)|body[^\n]*:not\(\.venue-grid-embed\)|:not\(:where\(\.ir-shell/);
  }
  const source = read('public/dancr-palette.v1.css');
  for (const context of ['.internal-page-surface', '.ir-shell', '.venue-embed-profile-page', '.venue-grid-embed']) assert.ok(source.includes(context), context);
  assert.match(source, /@media screen\s*\{\s*@layer dancr-palette/, 'printed guides and QR codes retain their print palette');
});

test('the site palette changes paint without changing layout, media, or hero artwork', () => {
  const paint = new Set(['background', 'background-color', 'background-image', 'color', 'border-color', 'box-shadow', 'text-shadow', 'filter', 'stroke', 'outline-color', '-webkit-text-fill-color']);
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

test('legacy club themes and saved preferences cannot inject a different palette', () => {
  assert.doesNotMatch(read('public/venue-brand-themes.css'), /#[0-9a-f]{3,8}\b|--dancr-color-/i);
  assert.doesNotMatch(read('app/internal/InternalRoster.tsx'), /venueGuestTheme|data-venue-guest-color/);
  assert.doesNotMatch(read('src/live-shell/app/internal-profile-bridge.js'), /setProperty\("--venue-guest/);
  assert.doesNotMatch(read('app/embed/venues/[slug]/dancers/[dancerSlug]/EmbeddedDancerProfile.tsx'), /style=\{\{ "--embed-accent": accent/);
  assert.doesNotMatch(read('app/admin/AdminVenueColors.tsx'), /type="color"|Save guest colors|\/api\/admin\/venues\/colors/);
  assert.match(read('app/admin/AdminVenueColors.tsx'), /Copy link/);
  assert.match(read('app/admin/AdminVenueColors.tsx'), /Copy code/);
});

test('select styling removes old gradients and preserves custom dropdown arrows', () => {
  const select = rules.find(rule => rule.selector.includes(':where(select)'));
  assert.ok(select);
  assert.ok(!select.nodes.some(decl => ['background', 'background-image'].includes(decl.prop)));
  const arrow = rules.find(rule => rule.selector.includes('.ir-staff select:not([multiple])'));
  assert.ok(arrow.nodes.some(decl => decl.prop === 'background-image' && decl.value.startsWith('url(')));
  assert.doesNotMatch(arrow.toString(), /linear-gradient/);
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

test('Working Now keeps its green face while navigation uses one violet and the account shortcut stays charcoal', () => {
  const working = rules.find(rule => rule.selector.includes('.dancer-directory-filter[data-dancer-directory-filter="now"][aria-selected="true"]'));
  assert.ok(working.selector.includes(':not(.is-empty)'));
  assert.ok(working.nodes.some(decl => decl.prop === '--discovery-control-face' && decl.value === 'var(--dancr-color-live-surface-emphasis)'));
  const face = rules.find(rule => rule.selector === 'html body.dancr-button-system :where(.dancer-directory-filter)::before');
  assert.ok(face.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--discovery-control-face)'));
  const dock = rules.find(rule => rule.selector.includes('.global-mobile-bottom-nav a.active, #discoveryTabs > button.active'));
  assert.ok(dock.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-color-brand-primary)'));
  const shortcut = rules.find(rule => rule.selector.includes('.utility-menu-dashboard'));
  assert.ok(shortcut.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-color-surface)'));
  assert.doesNotMatch(read('public/dancr-button-system.v1.css'), /#241337|#301a46|#6b4d89|#8b69ab/);
});
