import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function assembleLiveShell(directory = new URL('../../src/live-shell/', import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.format, 1);
  assert.equal(manifest.template, 'shell.html');
  const template = (await readFile(new URL(manifest.template, directory), 'utf8')).replace(/\r\n?/g, '\n');
  const includes = {};
  const seen = new Set();
  for (const [name, paths] of Object.entries(manifest.includes)) {
    assert.match(name, /^[a-z][a-z-]+$/);
    assert.ok(Array.isArray(paths) && paths.length > 0);
    includes[name] = (await Promise.all(paths.map(async path => {
      assert.match(path, /^(?:app\/|styles\/)?[a-z0-9-]+\.(?:js|css)$/);
      assert.ok(!seen.has(path), 'Duplicate source fragment: ' + path);
      seen.add(path);
      return (await readFile(new URL(path, directory), 'utf8')).replace(/\r\n?/g, '\n');
    }))).join('');
    assert.equal(template.split('{{include:' + name + '}}').length, 2, 'Include must occur exactly once: ' + name);
  }
  const html = template.replace(/\{\{include:([a-z-]+)\}\}/g, (_match, name) => {
    assert.ok(Object.hasOwn(includes, name), 'Unknown include: ' + name);
    return includes[name];
  });
  assert.ok(!html.includes('{{include:'), 'Unresolved source include');
  return { html, includes, manifest };
}
