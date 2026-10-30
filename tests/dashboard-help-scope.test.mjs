import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/components/dashboard-help-scope.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function fixture() {
  let current, nextId = 0;
  const contexts = [];
  const hooks = {
    createContext(value) { const context = { value, Provider: 'Provider' }; contexts.push(context); return context; },
    useContext(context) { return context.value; },
    useId() { const slot = current.index++; return current.slots[slot] ||= `scope-${++nextId}`; },
    useState(value) { const instance = current, slot = instance.index++; if (!(slot in instance.slots)) instance.slots[slot] = value; return [instance.slots[slot], next => { instance.slots[slot] = typeof next === 'function' ? next(instance.slots[slot]) : next; }]; },
    useCallback(fn) { const slot = current.index++; return current.slots[slot] ||= fn; },
    useEffect(effect, deps) {
      const instance = current, slot = instance.index++, previous = instance.slots[slot];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        instance.effects.push(() => { previous?.cleanup?.(); instance.slots[slot] = { deps, cleanup: effect() }; });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === 'react' ? hooks : require(name) });
  function mount(fn) {
    const instance = { slots: [], index: 0, effects: [] };
    return {
      render(props) { current = instance; instance.index = 0; const result = fn(props); for (const effect of instance.effects.splice(0)) effect(); return result; },
      unmount() { for (const slot of instance.slots) slot?.cleanup?.(); },
    };
  }
  const provider = mount(exports.DashboardHelpProvider);
  function sync() { contexts[0].value = provider.render({ children: null }).props.value; }
  sync();
  return {
    area: () => mount(exports.DashboardHelpArea),
    scope: () => mount(({ context, active = true }) => exports.useDashboardHelpArea(context, active)),
    parent(value = { active: true, path: [] }) { contexts[1].value = value; },
    current(fallback = 'support-only') { sync(); return exports.useDashboardHelpContext(fallback); },
  };
}

test('nested visible scope wins, hidden retained content cannot override it, and cleanup restores the parent', () => {
  const f = fixture(), root = f.scope(), area = f.area(), media = f.scope(), hidden = f.scope();
  const childArea = area.render({ context: 'venue-roster', active: true, children: null });
  f.parent(childArea.props.value);
  media.render({ context: 'venue-media' });
  f.parent();
  root.render({ context: 'venue-roster' }); // Parent effects can run after child effects.
  assert.equal(f.current(), 'venue-media');
  f.parent({ active: false, path: ['hidden'] });
  hidden.render({ context: 'venue-contacts', active: true });
  assert.equal(f.current(), 'venue-media');
  f.parent();
  const hiddenArea = area.render({ context: 'venue-roster', active: false, children: null });
  f.parent(hiddenArea.props.value);
  media.render({ context: 'venue-media' });
  assert.equal(f.current(), 'venue-roster');
  root.unmount();
  assert.equal(f.current(), 'support-only');
});

test('changing the selected tab or onboarding step replaces its topics without retaining a stale context', () => {
  const f = fixture(), step = f.scope();
  for (const context of ['setup-details', 'setup-media', 'setup-agreement', 'setup-age', 'setup-club', 'dancer-overview', 'dancer-results']) {
    step.render({ context });
    assert.equal(f.current(), context);
  }
  step.render({ context: 'dancer-results', active: false });
  assert.equal(f.current('dancer-overview'), 'dancer-overview');
});

test('opening setup account settings overrides an open media editor and closing restores media help', () => {
  const f = fixture(), step = f.area(), editor = f.scope(), settings = f.area();
  f.parent(step.render({ context: 'setup-details', active: true, children: null }).props.value);
  editor.render({ context: 'setup-media' });
  assert.equal(f.current(), 'setup-media');
  f.parent();
  settings.render({ context: 'setup-account', active: true, children: null });
  assert.equal(f.current(), 'setup-account');
  settings.render({ context: 'setup-account', active: false, children: null });
  assert.equal(f.current(), 'setup-media');
});

test('the most recently opened peer section wins and closing it restores the previous area', () => {
  const f = fixture(), page = f.scope(), settings = f.scope();
  page.render({ context: 'admin-home' });
  settings.render({ context: 'admin-account' });
  assert.equal(f.current(), 'admin-account');
  page.render({ context: 'admin-media' });
  assert.equal(f.current(), 'admin-media');
  page.unmount();
  assert.equal(f.current(), 'admin-account');
  settings.unmount();
  assert.equal(f.current(), 'support-only');
});
