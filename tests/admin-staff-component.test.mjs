import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import postcss from 'postcss';
import { STAFF_WORKSPACES } from '../src/lib/dancr/admin-workspace-policy.ts';

const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const text = node => typeof node === 'string' ? node : [node?.props?.children].flat(Infinity).map(child => typeof child === 'object' ? text(child) : String(child ?? '')).join('');
const settle = () => new Promise(resolve => setImmediate(resolve));
function mount(component = 'AdminStaffCreate') {
  const slots = [], pending = [], added = [], saved = []; let cursor = 0, tree;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
  };
  const jsx = (type, props) => ({ type, props });
  const deps = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/src/lib/dancr/admin-workspace-policy': { STAFF_WORKSPACES }, './AdminStaffSetup.module.css': { default: { form: 'form' } },
    './admin-session': { requestAdminJson: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/admin/AdminStaffSetup.tsx','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Error, require(name) { assert.ok(name in deps,name); return deps[name]; } });
  function render() { cursor = 0; tree = exports[component]({ id: 'staff-id', onAdded: person => added.push(person), onSaved: message => saved.push(message) }); }
  render();
  return { pending, added, saved, all: () => nodes(tree), text: () => text(tree),
    input(id,value) { nodes(tree).find(node => node.props?.id === id).props.onChange({ target: { value } }); render(); },
    submit() { const node = nodes(tree).find(node => node.type === 'form'); node.props.onSubmit({ preventDefault() {} }); render(); },
    click() { nodes(tree).find(node => node.type === 'button').props.onClick(); render(); },
    async finish(data) { pending.at(-1).resolve(data); await settle(); render(); },
    async fail() { pending.at(-1).reject(new Error('Please try again.')); await settle(); render(); },
  };
}
test('add staff defaults to reviewer, sends the chosen scope once and shows the returned account', async () => {
  const f = mount(); assert.equal(f.all().find(n => n.props?.id === 'admin-staff-role').props.value,'reviewer');
  assert.equal(f.all().filter(n => n.type === 'option').length,Object.keys(STAFF_WORKSPACES).length);
  f.input('admin-staff-name','Sam'); f.input('admin-staff-email','sam@example.invalid'); f.input('admin-staff-role','support');
  f.submit(); f.submit(); assert.equal(f.pending.length,1);
  assert.deepEqual(JSON.parse(f.pending[0].options.body),{ action:'add',displayName:'Sam',email:'sam@example.invalid',role:'support' });
  assert.ok(f.all().filter(n => ['input','select','button'].includes(n.type)).every(n => n.props.disabled));
  const staff = { id:'new-staff' }; await f.finish({ staff,message:'Staff added. Email sent.' });
  assert.deepEqual(f.added,[staff]); assert.deepEqual(f.saved,['Staff added. Email sent.']);
  assert.equal(f.all().find(n => n.props?.id === 'admin-staff-email').props.value,''); assert.match(f.text(),/Staff added/);
});
test('delivery warnings retain the saved staff, while request failures keep the form retryable', async () => {
  const f = mount(); f.input('admin-staff-name','Sam'); f.input('admin-staff-email','sam@example.invalid'); f.submit();
  await f.fail(); assert.match(f.text(),/Please try again/); assert.equal(f.all().find(n => n.props?.id === 'admin-staff-email').props.value,'sam@example.invalid'); assert.equal(f.added.length,0);
  f.submit(); await f.finish({ staff:{id:'new'},deliveryWarning:'Staff saved, email could not be sent.' });
  assert.equal(f.added.length,1); assert.equal(f.saved.length,0); assert.match(f.text(),/email could not be sent/);
});
test('resending setup never changes a role and duplicate clicks are blocked', async () => {
  const f = mount('AdminStaffSetupEmail'); f.click(); f.click(); assert.equal(f.pending.length,1);
  assert.deepEqual(JSON.parse(f.pending[0].options.body),{action:'resend',id:'staff-id'});
  await f.fail(); assert.match(f.text(),/Please try again/); f.click(); await f.finish({message:'Setup email sent.'});
  assert.deepEqual(f.saved,['Setup email sent.']); assert.doesNotMatch(f.text(),/Please try again/);
});
test('staff form stylesheet parses and stacks fields on small screens', () => {
  const css=postcss.parse(readFileSync('app/admin/AdminStaffSetup.module.css','utf8'));
  const mobile=css.nodes.find(node => node.type==='atrule' && node.name==='media');
  assert.match(mobile.params,/600px/); assert.ok(mobile.nodes[0].nodes.some(node => node.prop==='grid-template-columns' && node.value==='minmax(0, 1fr)'));
});
