import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import { dashboardStyleFiles, dashboardStyleBlocks } from './helpers/dashboard-palette-styles.mjs';

const files = ['app/dashboard', 'app/admin', 'app/vip'].flatMap(dashboardStyleFiles)
  .filter(file => !file.endsWith('saved-venue-cards.generated.css'));
files.push('app/internal/internal-dashboard.css', 'app/components/dashboard-header.css', 'app/components/dashboard-menu.css');
const palette = new Set(['109,40,255', '20,20,27', '48,48,56', '11,11,11', '53,49,63', '91,85,104', '170,166,181', '245,243,247']);
const colors = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|rgba?\([^()]+\)/gi;
function obsoletePlum(color) {
  let rgb;
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length < 5) hex = [...hex].map(c => c + c).join('');
    rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  } else rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!rgb?.every(Number.isFinite) || palette.has(rgb.join(','))) return false;
  const [r, g, b] = rgb;
  // Existing neutral black/gray aliases are allowed; the regression is a plum cast.
  if (r === g) return false;
  const hi = Math.max(...rgb), lo = Math.min(...rgb), delta = hi - lo;
  if (!delta || delta / hi < .08) return false;
  const hue = (hi === r ? ((g - b) / delta + 6) % 6 : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  return hue >= 240 && hue <= 320;
}

test('nested dashboard fills, borders and shadows cannot restore the old plum palette', () => {
  const failures = [];
  let declarations = 0;
  for (const file of files) for (const block of dashboardStyleBlocks(file)) {
    postcss.parse(block.text, { from: file }).walkDecls(decl => {
      if (!/^(?:background(?:-color|-image)?|border(?:-[a-z]+)*|outline(?:-color)?|box-shadow|text-shadow|--[\w-]*(?:background|bg|face|surface|border|edge|line|panel|card|gradient|accent-soft|accent-border))$/.test(decl.prop)) return;
      if (/mydancr-live-logo/.test(decl.parent.selector || '')) return;
      declarations++;
      for (const match of decl.value.matchAll(colors)) if (obsoletePlum(match[0])) {
        failures.push(`${file}: ${decl.parent.selector} ${decl.prop}: ${match[0]}`);
      }
    });
  }
  assert.ok(declarations > 3000, 'scan actual dashboard and inline component styles');
  assert.deepEqual(failures, [], failures.join('\n'));
});
