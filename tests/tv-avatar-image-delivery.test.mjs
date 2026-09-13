import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { importMediaModule } from './helpers/server-media-module.mjs';
const { responsivePublicImage } = await importMediaModule('responsive-image.ts');

const tv = readFileSync('src/lib/dancr/tv.ts', 'utf8');
const shell = readFileSync('outputs/index.html', 'utf8');
const start = tv.indexOf('async function signPublicVideos(');
const end = tv.indexOf('\nfunction normalizedVideoPosterStoragePath', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(tv.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test('TV serializers reuse responsive avatar candidates without extra lookups or losing the primary-photo fallback', async () => {
  const paths = ['avatar.r320-480.m800x800.jpg', 'primary.r320-480.m800x1200.jpg', 'legacy.jpg'];
  const queries = [];
  const client = { from(table) {
    queries.push(table);
    const rows = table === 'dancer_photos'
      ? [{ dancer_id: 'primary', storage_path: paths[1] }]
      : [{ id: 'avatar', avatar_storage_path: paths[0] }, { id: 'legacy', avatar_storage_path: paths[2] }];
    const query = new Proxy({ then: resolve => resolve({ data: rows }) }, {
      get: (target, key) => target[key] || (() => query),
    });
    return query;
  } };
  const context = vm.createContext({ responsivePublicImage, dancerVideoDeliveryUrl: id => `/video/${id}` });
  vm.runInContext(code, context);
  const videos = await context.signPublicVideos(client, ['avatar', 'primary', 'legacy', 'missing'].map(id => ({
    id, dancer: { id }, storagePath: 'private/video.mp4',
  })));
  assert.deepEqual(queries, ['dancer_photos', 'dancer_profiles']);
  for (let index = 0; index < 3; index++) {
    const expected = responsivePublicImage(client, 'dancer-photos', paths[index]);
    assert.equal(videos[index].dancer.avatarPhotoUrl, expected.imageUrl);
    assert.equal(videos[index].dancer.avatarPhotoSrcSet, expected.imageSrcSet);
  }
  assert.match(videos[0].dancer.avatarPhotoSrcSet, /width=96 96w/);
  assert.match(videos[0].dancer.avatarPhotoSrcSet, /width=160 160w/);
  assert.equal(videos[3].dancer.avatarPhotoSrcSet, null);
  assert.ok(videos.every(video => !('storagePath' in video)));
});

test('the live TV card declares responsive candidates before assigning its fallback URL', () => {
  const factory = shell.slice(shell.indexOf('    function createHomeTvFeedCopy('), shell.indexOf('    function createHomeTvFeedActionButton('));
  const elements = [];
  const createElement = tagName => {
    const element = { tagName, style: {}, dataset: {}, children: [], writes: [],
      setAttribute() {}, addEventListener() {}, append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
    };
    for (const property of ['src', 'srcset', 'sizes', 'width', 'height']) {
      Object.defineProperty(element, property, { get: () => element[property + 'Value'], set(value) { element[property + 'Value'] = value; element.writes.push(property); } });
    }
    elements.push(element);
    return element;
  };
  const context = vm.createContext({ document: { createElement }, avatarPhotoPosition: () => '50% 50%', citySelect: { value: 'Las Vegas' } });
  vm.runInContext(factory, context);
  context.createHomeTvFeedCopy({ id: 'video', dancer: { slug: 'dancer', stageName: 'Dancer', avatarPhotoUrl: '/fallback', avatarPhotoSrcSet: '/small 96w, /medium 160w, /large 480w' } }, null);
  const image = elements.find(element => element.tagName === 'img');
  assert.equal(image.sizes, '48px');
  assert.equal(image.width, 48);
  assert.equal(image.height, 48);
  assert.equal(image.srcset, '/small 96w, /medium 160w, /large 480w');
  assert.ok(image.writes.indexOf('srcset') < image.writes.indexOf('src'));
  assert.equal(image.src, '/fallback');
  assert.equal(image.loading, 'lazy');
});
