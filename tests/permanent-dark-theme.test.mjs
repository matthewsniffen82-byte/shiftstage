import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postcss from 'postcss';
import { externalizeLiveShellStyles } from '../src/lib/dancr/live-shell-styles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sources = globSync(['app/**/*.{css,tsx,ts}', 'src/**/*.{css,js,mjs,ts,html}', 'public/*.{css,js,html}'], { cwd: root });

test('public, customer, dancer, club, VIP and admin sources cannot opt into a system or light theme', () => {
  for (const file of sources) {
    const source = read(file.replaceAll('\\', '/'));
    assert.doesNotMatch(source, /prefers-color-scheme|\bnext-themes\b|\bThemeProvider\b/, file);
    assert.doesNotMatch(source, /color-scheme\s*:[^;}\n]*\blight\b/, file);
  }
});

test('the root and browser-native controls use the authored scheme without disabling forced colors', () => {
  const tokens = postcss.parse(read('public/dancr-brand-tokens.v1.css'));
  const schemes = [];
  tokens.walkDecls('color-scheme', declaration => schemes.push(declaration));
  const scheme = schemes.find(declaration => declaration.parent.selectors.includes(':root'));
  assert.equal(scheme?.value, 'only dark');
  assert.equal(scheme?.important, true);
  assert.equal(scheme?.parent.parent.params, 'dancr-palette');
  for (const control of ['button', 'input', 'select', 'textarea', 'option', 'optgroup', 'dialog']) {
    assert.ok(scheme.parent.selector.includes(control), control);
  }
  for (const file of sources.filter(file => file.endsWith('.css'))) {
    const css = postcss.parse(read(file.replaceAll('\\', '/')));
    css.walkDecls('forced-color-adjust', declaration => assert.notEqual(declaration.value, 'none', file));
  }
});

test('the production homepage keeps critical dark paint inline before blocking assets', () => {
  const html = externalizeLiveShellStyles(read('outputs/index.html'));
  const critical = html.match(/<style id="mydancr-dark-canvas">([\s\S]*?)<\/style>/);
  assert.ok(critical, 'CSS externalization must retain first-paint styling');
  assert.ok(html.indexOf('<meta name="color-scheme" content="dark">') < critical.index);
  assert.ok(critical.index < html.indexOf('<script'));
  assert.ok(critical.index < html.indexOf('<link'));
  const css = postcss.parse(critical[1]);
  const values = Object.fromEntries(css.first.nodes.map(node => [node.prop, node.value]));
  assert.equal(values['color-scheme'], 'only dark');
  assert.equal(values['background-color'], 'var(--dancr-color-background, #0b0b0b)');
  assert.equal(values.color, 'var(--dancr-color-text-primary, #f5f3f7)');
  for (const file of ['app/layout.tsx', 'app/global-error.tsx']) {
    assert.match(read(file), /<html[^>]*style=\{\{ colorScheme: "only dark", backgroundColor:/, file);
    assert.match(read(file), /<meta name="color-scheme" content="dark"/, file);
  }
});

test('standalone documents declare dark mode before styles, scripts or redirects', () => {
  for (const file of [
    'app/auth/callback/route.ts', 'app/auth/vip-setup/route.ts',
    'src/lib/security/site-lock-page.ts', 'app/api/public/maps/embed/route.ts',
    'app/embed/venues/[slug]/route.ts', 'public/index.html', 'public/outputs/index.html',
  ]) {
    const source = read(file);
    const meta = source.indexOf('<meta name="color-scheme" content="dark">');
    assert.ok(meta >= 0, file);
    const firstAsset = source.search(/<style\b|<script\b|<link\b|<meta http-equiv="refresh"/);
    assert.ok(firstAsset > meta, file);
    if (file.includes('/embed/venues/')) {
      assert.match(source, /\/dancr-brand-tokens\.v1\.css/, 'CSP-protected embed uses the shared root stylesheet');
    } else {
      assert.match(source, /color-scheme:\s*only dark/, file);
    }
  }
});

test('QR quiet zones keep their explicit white surface and foreground contrast remains readable', () => {
  const css = postcss.parse(read('public/dancr-ui-consistency.v1.css'));
  let qr;
  css.walkRules(rule => { if (rule.selector === 'body.dancr-button-system #profileQrOverlay .profile-qr-frame') qr = rule; });
  assert.ok(qr.nodes.some(node => node.prop === 'background' && node.value === '#fff linear-gradient(#fff,#fff)' && node.important));
  const tokens = {};
  postcss.parse(read('public/dancr-brand-tokens.v1.css')).walkDecls(declaration => { tokens[declaration.prop] = declaration.value; });
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const text of ['--dancr-color-text-primary', '--dancr-color-text-muted']) {
    for (const background of ['--dancr-color-background', '--dancr-color-surface']) {
      assert.ok((luminance(tokens[text]) + 0.05) / (luminance(tokens[background]) + 0.05) >= 4.5, `${text} on ${background}`);
    }
  }
});
