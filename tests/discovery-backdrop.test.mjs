import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';
import sharp from 'sharp';

const read = name => readFile(new URL('../public/' + name, import.meta.url), 'utf8');
const tokens = await read('dancr-brand-tokens.v1.css');
const styles = postcss.parse(await read('dancr-ui-consistency.v1.css'));

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
