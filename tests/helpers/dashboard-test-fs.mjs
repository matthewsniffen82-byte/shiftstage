import fs from 'node:fs';
import { isDashboardSource, readDashboardTestSource } from './dashboard-test-source.mjs';
import { isPublicDancerSource, readPublicDancerTestSource } from './public-dancer-test-source.mjs';
export * from 'node:fs';
export const readFileSync = (path, ...options) => isDashboardSource(path) ? readDashboardTestSource() : isPublicDancerSource(path) ? readPublicDancerTestSource() : fs.readFileSync(path, ...options);
const dashboardTestFs = { ...fs, readFileSync };
export default dashboardTestFs;
