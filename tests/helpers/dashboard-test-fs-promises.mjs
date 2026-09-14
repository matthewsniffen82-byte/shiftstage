import fs from 'node:fs/promises';
import { isDashboardSource, readDashboardTestSource } from './dashboard-test-source.mjs';
export * from 'node:fs/promises';
export const readFile = async (path, ...options) => isDashboardSource(path) ? readDashboardTestSource() : fs.readFile(path, ...options);
