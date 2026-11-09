import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';
import sharp from 'sharp';

const read = name => readFile(new URL('../public/' + name, import.meta.url), 'utf8');
const tokens = await read('dancr-brand-tokens.v1.css');
const styles = postcss.parse(await read('dancr-ui-consistency.v1.css'));

test('Android guest header actions have transparent faces and retain a visible keyboard focus ring', () => {
  const guest = 'html.is-android header .utility-menu > :is(#accountBtn:not(.account-icon-btn), #guestMenuBtn)';
  const paint = {};
  styles.walkRules(rule => {
    if (rule.parent.params !== 'dancr-palette.android-discovery') return;
    for (const selector of rule.selectors.filter(selector => selector.startsWith(guest))) {
      paint[selector] = Object.fromEntries(rule.nodes.filter(decl => decl.important).map(decl => [decl.prop, decl.value]));
    }
  });
  assert.equal(paint[guest].background, 'transparent');
  assert.equal(paint[guest]['border-color'], 'transparent');
  assert.equal(paint[guest]['box-shadow'], 'none');
  assert.equal(paint[guest + '::before'].content, 'none');
  assert.equal(paint[guest + '::after'].content, 'none');
  assert.ok(paint[guest + ':focus-visible'].outline.includes('solid'));
});

test('Samsung discovery swatches match the page and selected Working Now colors', async () => {
  for (const [selector, token, alpha] of [
    ['html.is-samsung-browser:has(#discoveryTabs)', '--dancr-color-background', 255],
    ['html.is-samsung-browser #results .dancer-directory-filter[data-dancer-directory-filter="now"][aria-selected="true"]::before', '--dancr-color-live', Math.round(255 * 0.16)],
  ]) {
    let image;
    styles.walkRules(rule => {
      if (rule.selectors.includes(selector)) rule.walkDecls('background-image', decl => { image = decl.value; });
    });
    const png = image?.match(/^url\("data:image\/png;base64,([^"]+)"\)$/);
    assert.ok(png, selector);
    const { data, info } = await sharp(Buffer.from(png[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = tokens.match(new RegExp(token + ': #(\\w{6});'))[1];
    assert.deepEqual([info.width, info.height], [1, 1]);
    assert.equal(data.subarray(0, 3).toString('hex'), expected);
    assert.equal(data[3], alpha);
  }
});
