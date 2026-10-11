import { compileVip, venues, dancers } from './vip-dashboard-fixture.mjs';
import * as helpers from '../../src/lib/dancr/vip-dashboard.ts';
import * as types from '../../src/lib/dancr/vip-types.ts';

// Isolated component events with in-memory state; no server or browser journey.
export function plannerHarness(options = {}) {
  const slots = [], focused = [];
  let cursor = 0, effects = [], tree;
  const props = { venue: venues[0], dancers, draft: helpers.emptyVipDraft(), busy: false, favoritePending: [],
    onChange: next => { props.draft = next; }, onSubmit: async () => {}, onFavorite: async () => {}, ...options };
  const Component = compileVip('app/vip/VipPlan.tsx', {
    react: {
      useState(initial) { const index = cursor++; slots[index] ||= { value: initial }; return [slots[index].value, next => { slots[index].value = next; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useEffect(effect, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) { slots[index] = deps; effects.push(effect); } },
    }, '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': helpers,
  }).default;
  const nodes = (node = tree) => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : [];
  function render() {
    cursor = 0; effects = []; tree = Component(props);
    for (const node of nodes()) if (node.props.ref) node.props.ref.current = { focus: () => focused.push(node.props.id) };
    effects.forEach(effect => effect()); return tree;
  }
  function button(label) { return nodes().find(node => node.type === 'button' && [node.props.children].flat().includes(label)); }
  function select(id, checked = true) { const card = nodes().find(node => node.type === 'article' && node.key === id); nodes(card).find(node => node.props?.type === 'checkbox').props.onChange({ target: { checked } }); render(); }
  render();
  return { props, render, nodes, button, select, focused, tree: () => tree,
    filter(label) { button(label).props.onClick(); render(); },
    search(value) { nodes().find(node => node.props?.type === 'search').props.onChange({ target: { value } }); render(); },
    details() { nodes().find(node => node.type === 'button' && node.props['aria-controls'] === 'vip-visit-details').props.onClick(); render(); },
    back() { nodes().find(node => node.type === 'button' && node.props['aria-controls'] === 'vip-choose-dancers').props.onClick(); render(); },
  };
}
