import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const styles = postcss.parse(readFileSync(new URL('../src/live-shell/styles/override-styles-07-profile-backdrop-schedule-upcoming-profile-schedule-primary.css', import.meta.url), 'utf8'));
const shell = readFileSync(new URL('../src/live-shell/shell.html', import.meta.url), 'utf8');
const checkbox = '#authPage .customer-terms-consent input[type="checkbox"]';

function declarations(selector) {
  const values = {};
  styles.walkRules(rule => {
    if (rule.selector === selector) {
      rule.walkDecls(decl => { values[decl.prop] = decl; });
    }
  });
  return values;
}

test('guest consent uses a compact native checkbox instead of mobile text-input dimensions', () => {
  const input = declarations(checkbox);
  for (const dimension of ['width', 'height', 'min-height', 'max-height', 'max-width']) {
    assert.equal(input[dimension].value, '22px');
  }
  assert.equal(input['min-height'].important, true, 'must override the mobile 44px input minimum');
  assert.equal(input['max-width'].important, true);
  assert.equal(input.flex.value, '0 0 22px');
  assert.equal(input.padding.value, '0');
  assert.equal(input.margin.value, '0');
  assert.equal(input['box-sizing'].value, 'border-box');
  assert.equal(input.appearance.value, 'auto', 'preserve the native checked indicator');
  assert.equal(input['accent-color'].value, '#7c3aed');
  assert.equal(input.background.value, 'transparent');
  assert.equal(input.background.important, true);
  assert.equal(input['box-shadow'].value, 'none');
  assert.equal(input['box-shadow'].important, true);
});

test('the consent label stays easy to tap and centered without preselecting agreement', () => {
  const label = declarations('.customer-terms-consent');
  assert.equal(label.display.value, 'flex');
  assert.equal(label['align-items'].value, 'center');
  assert.equal(label['min-height'].value, '44px');
  assert.equal(label.gap.value, '10px');
  assert.equal(declarations('.customer-terms-consent[hidden]').display.value, 'none');
  const consent = shell.match(/<label class="customer-terms-consent"[^>]*>[\s\S]*?<\/label>/)?.[0];
  assert.ok(consent);
  assert.match(consent, /<input id="customerTermsAccepted" type="checkbox"/);
  assert.doesNotMatch(consent, /\bchecked(?:\s|=|>)/);
  assert.match(consent, /<span>I agree to the <a href="\/terms\/user\//);
});

test('touch focus loses the extra frame while keyboard focus retains a visible outline', () => {
  const touch = declarations(`${checkbox}:focus:not(:focus-visible)`);
  assert.equal(touch.outline.value, 'none');
  assert.equal(touch.outline.important, true);
  const keyboard = declarations('#authPage :is(button, a, input, select, textarea):focus-visible');
  assert.equal(keyboard.outline.value, '2px solid #c4b5fd');
  assert.equal(keyboard.outline.important, true);
  assert.equal(keyboard['outline-offset'].value, '3px');
});
