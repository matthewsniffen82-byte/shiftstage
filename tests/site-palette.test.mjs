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
  const paint = new Set(['background', 'background-color', 'background-image', 'color', 'color-scheme', 'border-color', 'box-shadow', 'text-shadow', 'filter', 'mix-blend-mode', 'stroke', 'outline-color', '-webkit-text-fill-color']);
  theme.walkDecls(decl => {
    const logoSurfaceReset = decl.parent.selector.includes('.home-venue-discovery-logo-shell') && (
      (decl.prop === 'border' && decl.value === '0') ||
      (['backdrop-filter', '-webkit-backdrop-filter'].includes(decl.prop) && decl.value === 'none')
    );
    assert.ok(decl.prop.startsWith('--') || paint.has(decl.prop) || logoSurfaceReset, decl.prop);
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

test('the account button wrapper stays transparent while the circle and dropdown retain their fills', () => {
  const wrapperRules = rules.filter(rule => /\.utility-menu(?=[\s,)])/.test(rule.selector));
  for (const rule of wrapperRules) {
    const backgrounds = rule.nodes.filter(decl => ['background', 'background-color', 'background-image'].includes(decl.prop));
    assert.ok(backgrounds.every(decl => ['transparent', 'none'].includes(decl.value)), 'the layout wrapper must not paint a square behind the account circle');
  }
  const dropdown = rules.find(rule => rule.selector === 'html body.dancr-button-system :where(.utility-menu-panel, .customer-quick-panel)');
  assert.ok(dropdown.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-control-secondary-background)'));
  assert.match(read('public/dancr-ui-consistency.v1.css'), /:is\(\.customer-quick-btn, #accountBtn\.account-icon-btn\)::before \{[\s\S]*?inset: 4px !important;[\s\S]*?border-radius: 50%;[\s\S]*?background: linear-gradient\(var\(--discovery-header-face\), var\(--discovery-header-face\)\) !important;/);
});

test('primary actions exclude destructive, confirmed, disabled and secondary states', () => {
  const primary = rules.find(rule => rule.selector.includes('input[type="submit"]'));
  assert.ok(primary);
  for (const state of ['.secondary', '[class*="danger"]', '[class*="delete"]', '[class*="reject"]', '[data-action-state="success"]', '.is-confirmed', ':disabled', '[aria-disabled="true"]']) {
    assert.ok(primary.selector.includes(state), state);
  }
  const controls = rules.find(rule => rule.selector.includes('.dashboard-shell .info-panel button'));
  for (const state of ['[role="switch"]', '.customer-notification-switch', '.profile-upload-preview *', '.profile-media-control', '.dancer-request-count', '.auth-help-row .forgot-password']) {
    assert.ok(controls.selector.includes(state), state);
  }
});

test('all dashboard selections and painted mobile control faces use the shared tokens', () => {
  const selected = rules.find(rule => rule.selector.includes('.dancer-dashboard-nav button[aria-current="page"]') && !rule.selector.includes(' svg'));
  for (const target of ['.customer-workspace-nav', '.venue-workspace-tabs', '.admin-workspace-nav', '.vip-dashboard-nav', '.account-auth-tabs', '.auth-entry-tab']) {
    assert.ok(selected.selector.includes(target), target);
  }
  assert.ok(selected.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-color-brand-primary)'));
  for (const [name, token] of [
    ['--discovery-control-face', '--dancr-palette-surface'],
    ['--follow-control-face', '--dancr-palette-control'],
    ['--profile-action-background', '--dancr-palette-control'],
    ['--venue-utility-face', '--dancr-palette-control'],
  ]) {
    assert.ok(rules.some(rule => rule.nodes.some(decl => decl.prop === name && decl.value === `var(${token}, var(--dancr-color-surface))`)), name);
  }
});

test('dashboard cards and controls have distinct fills without recoloring public or guest pages', () => {
  const scopes = rules.filter(rule => rule.nodes.some(decl => decl.prop === '--dancr-palette-surface' || decl.prop === '--dancr-palette-control'));
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].selector, 'html body.dancr-button-system:has(:where(.dashboard-shell, .admin-shell, .vip-dashboard-shell, .ir-staff, .agent-dashboard))');
  assert.ok(scopes[0].nodes.some(decl => decl.prop === '--dancr-palette-surface' && decl.value === 'var(--dancr-color-surface-card)'));
  assert.ok(scopes[0].nodes.some(decl => decl.prop === '--dancr-palette-control' && decl.value === 'var(--dancr-color-control-secondary)'));
  // Hidden legacy dashboard IDs exist on discovery, and guest rosters share
  // ir-shell with staff. Neither is sufficient to opt a page into these fills.
  assert.doesNotMatch(scopes[0].selector, /#(?:dancer|venue|customer|admin)Dashboard|\.ir-shell|\.ir-guest/);
  const portal = rules.find(rule => rule.selector.includes('.dancer-request-dialog'));
  assert.ok(portal.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-palette-surface, var(--dancr-color-surface))'));
});

test('Working Now uses translucent green, the floating dock keeps its own paint, and the account shortcut stays charcoal', () => {
  const working = rules.find(rule => rule.selector.includes('.dancer-directory-filter[data-dancer-directory-filter="now"][aria-selected="true"]'));
  assert.equal(working.selector, 'html body.dancr-button-system :where(.dancer-directory-filter[data-dancer-directory-filter="now"][aria-selected="true"])', 'selected Working Now stays green with zero results too');
  assert.ok(working.nodes.some(decl => decl.prop === '--dancr-color-live' && decl.value === '#4dec9d'));
  assert.ok(working.nodes.some(decl => decl.prop === '--discovery-control-face' && decl.value === 'rgba(77, 236, 157, .16)'));
  assert.ok(working.nodes.some(decl => decl.prop === '--discovery-control-edge' && decl.value === '#48755c'));
  assert.ok(working.nodes.some(decl => decl.prop === 'color' && decl.value === 'var(--dancr-color-live)'));
  const face = rules.find(rule => rule.selector === 'html body.dancr-button-system :where(.dancer-directory-filter)::before');
  assert.ok(face.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--discovery-control-face)'));
  const workingFace = rules.find(rule => rule.selector === `${working.selector}::before`);
  assert.ok(workingFace.nodes.some(decl => decl.prop === 'background' && decl.value === 'linear-gradient(var(--discovery-control-face), var(--discovery-control-face))'), 'the visible mobile face also stays green with zero results');
  // Broad tab and focus rules must also exclude the dock, so its original
  // glass face, inactive silver icons, white active icon and halo can render.
  const palette = read('public/dancr-palette.v1.css');
  assert.ok(palette.includes('.tab:not(.active):not(#discoveryTabs > *)'));
  assert.ok(palette.includes('.tab.active:not(#discoveryTabs > *)'));
  const nonNavigationPalette = palette
    .replaceAll(':not(#discoveryTabs > *)', '')
    .replaceAll(':not(:where(.global-mobile-bottom-nav *, #discoveryTabs *))', '');
  assert.doesNotMatch(nonNavigationPalette, /global-mobile-(?:bottom-nav|swipe-indicator)|#discoveryTabs|(?:mobile|home)-nav-/);
  const shortcut = rules.find(rule => rule.selector.includes('.utility-menu-dashboard'));
  assert.ok(shortcut.nodes.some(decl => decl.prop === 'background' && decl.value === 'var(--dancr-palette-control, var(--dancr-color-surface))'));
  assert.doesNotMatch(read('public/dancr-button-system.v1.css'), /#241337|#301a46|#6b4d89|#8b69ab/);
});
