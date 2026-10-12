import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const styles = postcss.parse(readFileSync(new URL('../public/dancr-auth.v1.css', import.meta.url), 'utf8'));
const surfaces = [
  { group: '#authPage .auth-entry-tabs', button: '#authPage .auth-entry-tab' },
  { group: '.account-shell .account-panel .account-auth-tabs', button: '.account-shell .account-panel .account-auth-tabs button' },
];

function declarations(selector) {
  const values = {};
  styles.walkRules(rule => {
    if (rule.selectors.includes(`body.dancr-button-system ${selector}`)) {
      assert.equal(rule.parent.type, 'root', 'auth tabs must not depend on browser-specific media queries');
      rule.walkDecls(decl => { values[decl.prop] = decl; });
    }
  });
  return values;
}

for (const { group, button } of surfaces) {
  test(`${group} keeps both modes equally sized without an enclosing box`, () => {
    const frame = declarations(group);
    assert.equal(frame['grid-template-columns'].value, 'repeat(2, minmax(0, 1fr))');
    assert.equal(frame.border.value, '0');
    assert.equal(frame.border.important, true);
    assert.equal(frame.padding.value, '0');
    assert.equal(frame['border-radius'].value, '0');
    assert.equal(frame.background.value, 'transparent');
    assert.equal(frame['box-shadow'].value, 'none');
    const control = declarations(button);
    assert.equal(control.border.value, '1px solid #6b5c78');
    assert.equal(control.border.important, true);
    assert.equal(control.background.value, 'linear-gradient(#1a1620, #1a1620)');
    assert.equal(control.background.important, true);
    assert.equal(control['min-height'].value, '44px');
    assert.equal(control['min-width'].value, '0');
    assert.equal(control['white-space'].value, 'normal');
    assert.equal(control['overflow-wrap'].value, 'anywhere');
    assert.equal(control.appearance.value, 'none');
    assert.equal(control['-webkit-appearance'].value, 'none');
    assert.equal(control['backdrop-filter'].value, 'none');
    assert.equal(control['-webkit-backdrop-filter'].value, 'none');
  });

  test(`${button} preserves the original selected purple fill and geometry`, () => {
    const active = declarations(`${button}.active`);
    assert.equal(active.background.value, 'linear-gradient(#160e24, #160e24)');
    assert.equal(active['border-color'].value, '#745696');
    assert.equal(active.color.value, '#fff');
    assert.equal(active['box-shadow'].value, 'none');
    assert.equal(active['font-weight'], undefined);
    for (const prop of ['width', 'height', 'padding', 'border-width']) assert.equal(active[prop], undefined);
    const focus = declarations(`${button}:focus-visible`);
    assert.equal(focus.outline.value, '2px solid #c4b5fd');
    assert.equal(focus.outline.important, true);
  });
}

test('the shared treatment targets sign-in modes without restyling account types', () => {
  const account = readFileSync(new URL('../app/account/AccountClient.tsx', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../src/live-shell/shell.html', import.meta.url), 'utf8');
  assert.match(account, /className="segmented account-auth-tabs" aria-label="Auth mode"/);
  assert.match(account, /className="segmented" aria-label="Account type"/);
  assert.match(shell, /class="auth-entry-tab active" id="authSignInTab"[^>]*role="tab" aria-selected="true"/);
  assert.match(shell, /class="auth-entry-tab" id="authCreateTab"[^>]*role="tab" aria-selected="false"/);
});
