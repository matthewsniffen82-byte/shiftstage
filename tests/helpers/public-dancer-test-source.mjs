import { readFileSync } from 'node:fs';

// Source assertions follow the shared implementation used by both entry points.
// Runtime tests load each real module separately.
export const isPublicDancerSource = path => String(path).replaceAll('\\', '/').endsWith('app/dancers/[slug]/page.tsx');
export function readPublicDancerTestSource() {
  return ['app/dancers/[slug]/page.tsx', 'app/dancers/[slug]/PublicDancerProfile.tsx', 'src/lib/dancr/public-dancer-content.ts']
    .map(path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')).join('\n');
}
