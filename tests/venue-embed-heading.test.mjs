import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const css = postcss.parse(read('public/venue-grid-embed.css') + '\n' + read('public/venue-roster-header.css'));

function declarations(selector) {
  const rules = [];
  const candidates = [
    'html body.venue-grid-embed ' + selector,
    'html body.dancr-button-system ' + selector,
    'html body.dancr-button-system .venue-embed-heading ' + selector,
  ];
  css.walkRules(rule => { if (candidates.includes(rule.selector)) rules.push(rule); });
  assert.equal(rules.length, 1, selector);
  return Object.fromEntries(rules[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node]));
}

test('the compact club identity leaves the refresh control on the Working now row', () => {
  const heading = declarations('.venue-embed-heading');
  assert.equal(declarations('.venue-embed-working')['grid-template-areas'].value, '"title refresh"');
  assert.equal(declarations('.venue-embed-identity').display.value, 'grid');
  assert.equal(declarations('.venue-embed-heading .venue-embed-logo').width.value, '56px');
  assert.equal(declarations('.venue-embed-working h2')['grid-area'].value, 'title');
  assert.equal(declarations('#venue-refresh')['grid-area'].value, 'refresh');
  assert.equal(declarations('.venue-embed-credit')['text-decoration'].value, 'none');
  assert.equal(heading.border.value, '1px solid color-mix(in srgb, var(--roster-header-accent) 30%, #292929)');
  assert.equal(heading.display.value, 'flex');
  assert.equal(heading.padding.value, '8px 12px');
  assert.equal(declarations('.venue-embed-location').display.value, 'flex');
  assert.equal(heading['border-radius'].value, '16px');
  assert.equal(heading['box-shadow'].value, 'none');
  assert.equal(declarations('#venue-refresh')['align-self'].value, 'center');
  assert.equal(declarations('#venue-refresh')['justify-self'].value, 'end');
});

test('heading cancels inherited mobile margins and reserves a stable refresh touch target', () => {
  const heading = declarations('.venue-embed-heading');
  assert.equal(heading.margin.value, '0 auto');
  assert.equal(heading.margin.important, true);
  assert.equal(declarations('.venue-embed-working')['grid-template-columns'].value, 'minmax(0, 1fr) 44px');
  const title = declarations('.venue-embed-working h2');
  assert.equal(title['min-width'].value, '0');
  assert.equal(title['flex-wrap'].value, 'wrap');
  const refresh = declarations('#venue-refresh');
  assert.equal(refresh.width.value, '44px');
  assert.equal(refresh.height.value, '44px');
  assert.equal(refresh['min-height'].value, '44px');
  assert.equal(refresh.margin.value, '0');
  assert.equal(refresh.margin.important, true);
  assert.equal(refresh.position.value, 'relative');
});

test('internal and embedded rosters use the same versioned identity header styles', () => {
  assert.match(read('app/internal/layout.tsx'), /import "@\/public\/venue-roster-header\.css"/);
  assert.match(read('app/embed/venues/[slug]/route.ts'), /<link href="\/venue-roster-header\.css" rel="stylesheet">/);
  assert.match(read('src/lib/dancr/static-asset-paths.mjs'), /"\/venue-roster-header\.css"/);
});

test('the embedded club identity includes the credit without a table badge or welcome message', () => {
  const route = read('app/embed/venues/[slug]/route.ts');
  const header = route.match(/<div id="venue-heading" class="venue-embed-heading ir-table-header" hidden>([\s\S]*?)<section id="venue-directory"/)?.[1];
  assert.ok(header);
  assert.match(header, /<img id="venue-logo"[^>]*width="56" height="56">\s*<div class="venue-embed-identity">\s*<h1 id="venue-name" class="venue-embed-name"><\/h1>/);
  assert.match(header, /class="venue-embed-location"><p id="venue-city" class="venue-embed-city" hidden><\/p><\/div>\s*<a class="venue-embed-credit" href="https:\/\/www\.mydancr\.com" target="_blank" rel="noopener noreferrer">Powered by mydancr\.com<\/a>/);
  assert.doesNotMatch(header, /ir-table-label|Welcome to the club/);
  assert.match(route, /class="venue-embed-working">\s*<h2 aria-live="polite">Working now <span id="venue-count" hidden><\/span><\/h2>\s*<button id="venue-refresh" class="mydancr-refresh-button" type="button" aria-label="Refresh working dancers" title="Refresh working dancers">/);
});
