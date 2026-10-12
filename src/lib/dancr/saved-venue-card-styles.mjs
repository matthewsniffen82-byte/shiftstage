import postcss from 'postcss';

// The legacy discovery feed and React dashboard share the same card selectors.
// Re-scope those rules without copying or redesigning their declarations.
const cardClass = /\.(?:home-venue-discovery[\w-]*|home-discovery-feed[\w-]*|home-dancer-grid-action-rail|venue-card-(?:primary|secondary|favorite|page|deals|directions)[\w-]*|venue-lineup[\w-]*|feed-card-action|action-icon|venue)(?=[\s.:\[>+~#]|$)/;

export function savedVenueCardStyles(sources) {
  const result = postcss.root();
  for (const source of sources) {
    const root = postcss.parse(source);
    root.walkComments(comment => comment.remove());
    root.walkRules(rule => {
      if (rule.selectors.some(selector => selector === ':root' || selector === '#results')) {
        rule.selector = '#customer-dashboard [data-venue-scroll-feed]';
        rule.nodes.filter(node => node.type !== 'decl' || !node.prop.startsWith('--')).forEach(node => node.remove());
        if (!rule.nodes.length) rule.remove();
        return;
      }
      const selectors = rule.selectors.flatMap(selector => {
        if (!cardClass.test(selector) || /venue-profile|venue-card-grid|home-dancer-discovery|home-dancer-grid-slide/.test(selector)) return [];
        const results = selector.indexOf('#results');
        if (results < 0 && selector.match(cardClass)?.index !== 0) return [];
        // Ancestor layout rules belong to the homepage, not the saved workspace.
        if (results >= 0 && selector.slice(0, results).includes(':has(')) return [];
        const pseudo = selector.match(/::[\w-]+(?:\([^)]*\))?$/)?.[0] || '';
        const original = pseudo ? selector.slice(0, -pseudo.length) : selector;
        const saved = original
          .replace(/(?:>\s*)?\.app\s+main\.stack(?:\s*>\s*section\.stack)?\s*(?:>\s*)?/g, ' ')
          .replaceAll('#results', '[data-venue-scroll-feed]');
        // :where keeps the original specificity, including mobile/Android
        // overrides and nested :is selectors. The outer scope isolates Saved.
        return [`#customer-dashboard :is(${original}, :where(${saved}))${pseudo}`];
      });
      if (selectors.length) rule.selectors = selectors;
      else rule.remove();
    });
    root.walkAtRules(rule => {
      if (!['media', 'supports', 'layer'].includes(rule.name) || !rule.nodes?.length) rule.remove();
    });
    result.append(root.nodes);
  }
  return result.toString();
}
