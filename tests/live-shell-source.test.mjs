import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleLiveShell } from '../scripts/lib/live-shell-source.mjs';
import { liveShellRoute } from './helpers/live-shell-route.mjs';

test('the checked homepage artifact is assembled exactly from ordered source files', async () => {
  const { html, manifest } = await assembleLiveShell();
  assert.equal(html, (await readFile(new URL('../outputs/index.html', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n'));
  assert.ok(manifest.includes.application.length > 20);
  const template = await readFile(new URL('../src/live-shell/shell.html', import.meta.url), 'utf8');
  assert.ok(template.split('\n').length < 2200);
});
test('unsafe paths and duplicate fragments fail before assembly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dancr-shell-source-'));
  assert.equal(dirname(directory), tmpdir());
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL('../src/live-shell/', import.meta.url), directory, { recursive: true });
  const url = pathToFileURL(directory + '/');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', url), 'utf8'));
  const original = manifest.includes.application[0];
  manifest.includes.application[0] = '../outside.js';
  await writeFile(new URL('manifest.json', url), JSON.stringify(manifest));
  await assert.rejects(assembleLiveShell(url));
  manifest.includes.application[0] = original;
  manifest.includes.application.push(original);
  await writeFile(new URL('manifest.json', url), JSON.stringify(manifest));
  await assert.rejects(assembleLiveShell(url), /Duplicate source fragment/);
});
test('the real production root serves a small document with versioned cached styles', async () => {
  const { route, reads } = liveShellRoute();
  const response = await route.GET();
  const html = await response.text();
  assert.ok(Buffer.byteLength(html) < 200_000, String(Buffer.byteLength(html)));
  assert.match(html, /href="\/outputs\/live-shell\.css\?v=[a-f0-9]{16}"/);
  assert.match(html, /href="\/outputs\/live-shell-overrides\.css\?v=[a-f0-9]{16}"/);
  assert.match(html, /<script src="\/live-shell\.js\?v=[a-f0-9]{64}" defer/);
  assert.ok(!reads.some(path => path.endsWith('.css')));
});
