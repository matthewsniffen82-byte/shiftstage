import fs from 'node:fs/promises';
import { isDashboardSource, readDashboardTestSource } from './dashboard-test-source.mjs';
import { isPublicDancerSource, readPublicDancerTestSource } from './public-dancer-test-source.mjs';
export * from 'node:fs/promises';
export const readFile = async (path, ...options) => isDashboardSource(path) ? readDashboardTestSource() : isPublicDancerSource(path) ? readPublicDancerTestSource() : fs.readFile(path, ...options);
