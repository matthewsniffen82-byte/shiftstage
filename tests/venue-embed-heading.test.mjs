import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const css = postcss.parse(read('public/venue-grid-embed.css'));

function declarations(selector) {
  const rules = [];
  css.walkRules(rule => { if (rule.selector === 'html body.venue-grid-embed ' + selector) rules.push(rule); });
  assert.equal(rules.length, 1, selector);
  return Object.fromEntries(rules[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node]));
}

test('refresh shares the Working now row, separate from venue name and credit', () => {
  const heading = declarations('.venue-embed-heading');
  assert.equal(heading['grid-template-areas'].value, '"name name" "title refresh" "credit credit"');
  assert.equal(declarations('.venue-embed-heading > div').display.value, 'contents');
  assert.equal(declarations('#venue-name')['grid-area'].value, 'name');
  assert.equal(declarations('.venue-embed-heading h1')['grid-area'].value, 'title');
  assert.equal(declarations('#venue-refresh')['grid-area'].value, 'refresh');
  assert.equal(declarations('.venue-embed-credit')['grid-area'].value, 'credit');
  assert.equal(declarations('#venue-refresh')['align-self'].value, 'center');
  assert.equal(declarations('#venue-refresh')['justify-self'].value, 'end');
});

test('heading cancels inherited mobile margins and reserves a stable refresh touch target', () => {
  const heading = declarations('.venue-embed-heading');
  assert.equal(heading.margin.value, '0');
  assert.equal(heading.margin.important, true);
  assert.equal(heading['grid-template-columns'].value, 'minmax(0, 1fr) 44px');
  const title = declarations('.venue-embed-heading h1');
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

test('heading markup preserves the live count, named refresh control and credit link', () => {
  const route = read('app/embed/venues/[slug]/route.ts');
  assert.match(route, /class="venue-embed-heading"><div><p id="venue-name">[\s\S]*?<h1 aria-live="polite">Working now <span id="venue-count" hidden><\/span><\/h1><\/div><button id="venue-refresh" type="button" aria-label="Refresh working dancers" title="Refresh">/);
  assert.match(route, /<a class="venue-embed-credit" href="https:\/\/www\.mydancr\.com"/);
});
