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
    dancerAvatarPath: id === 'avatar' ? paths[0] : id === 'legacy' ? paths[2] : null,
  })));
  assert.deepEqual(queries, ['dancer_photos'], 'reuse the avatar from the original eligible-profile join');
  for (let index = 0; index < 3; index++) {
    const expected = responsivePublicImage(client, 'dancer-photos', paths[index]);
    assert.equal(videos[index].dancer.avatarPhotoUrl, expected.imageUrl);
    assert.equal(videos[index].dancer.avatarPhotoSrcSet, expected.imageSrcSet);
  }
  assert.match(videos[0].dancer.avatarPhotoSrcSet, /width=96 96w/);
  assert.match(videos[0].dancer.avatarPhotoSrcSet, /width=160 160w/);
  assert.equal(videos[3].dancer.avatarPhotoSrcSet, null);
  assert.ok(videos.every(video => !('storagePath' in video)));
  assert.ok(videos.every(video => !('dancerAvatarPath' in video)));
});

function renderTvAvatar(dancer) {
  const factory = shell.slice(shell.indexOf('    function createHomeTvFeedCopy('), shell.indexOf('    function createHomeTvFeedActionButton('));
  const elements = [];
  const createElement = tagName => {
    const element = { tagName, style: {}, dataset: {}, children: [], writes: [], handlers: {}, removed: false,
      setAttribute() {}, addEventListener(name, handler) { this.handlers[name] = handler; },
      removeAttribute(name) { this[name] = ''; }, remove() { this.removed = true; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
    };
    for (const property of ['src', 'srcset', 'sizes', 'width', 'height']) {
      Object.defineProperty(element, property, { get: () => element[property + 'Value'], set(value) { element[property + 'Value'] = value; element.writes.push(property); } });
    }
    elements.push(element);
    return element;
  };
  const context = vm.createContext({ document: { createElement }, avatarPhotoPosition: (x = 50, y = 50) => `${x}% ${y}%`, citySelect: { value: 'Las Vegas' } });
  vm.runInContext(factory, context);
  context.createHomeTvFeedCopy({ id: 'video', dancer: { slug: 'dancer', stageName: 'Dancer', ...dancer } }, null);
  return elements.find(element => element.tagName === 'img');
}

test('the live TV card declares responsive candidates before assigning its fallback URL', () => {
  const image = renderTvAvatar({ avatarPhotoUrl: '/fallback', avatarPhotoSrcSet: '/small 96w, /medium 160w, /large 480w' });
  assert.equal(image.sizes, '48px');
  assert.equal(image.width, 48);
  assert.equal(image.height, 48);
  assert.equal(image.srcset, '/small 96w, /medium 160w, /large 480w');
  assert.ok(image.writes.indexOf('srcset') < image.writes.indexOf('src'));
  assert.equal(image.src, '/fallback');
  assert.equal(image.loading, 'lazy');
});

test('a failed TV avatar thumbnail retries the stored avatar before the approved primary photo', () => {
  const image = renderTvAvatar({ avatarPhotoUrl: '/avatar', avatarPhotoSrcSet: '/thumbnail 96w',
    avatarPhotoFocalX: 40, avatarPhotoFocalY: 30, primaryPhotoUrl: '/primary', primaryPhotoFocalX: 25, primaryPhotoFocalY: 10 });
  image.handlers.error();
  assert.equal(image.srcset, '');
  assert.equal(image.src, '/avatar');
  assert.equal(image.style.objectPosition, '40% 30%');
  assert.equal(image.removed, false);
  image.handlers.error();
  assert.equal(image.src, '/primary');
  assert.equal(image.style.objectPosition, '25% 10%');
  assert.equal(image.removed, false);
  image.handlers.error();
  assert.equal(image.removed, true, 'show initials only after all supplied photo URLs fail');
});

test('TV avatar retries are bounded when the avatar and primary photo are the same', () => {
  const image = renderTvAvatar({ avatarPhotoUrl: '/primary', primaryPhotoUrl: '/primary' });
  image.handlers.error();
  assert.equal(image.removed, false);
  image.handlers.error();
  assert.equal(image.removed, true);
  assert.equal(image.writes.filter(property => property === 'src').length, 2);
});

test('TV cards use the supplied primary photo or initials when no avatar exists', () => {
  assert.equal(renderTvAvatar({ primaryPhotoUrl: '/primary' }).src, '/primary');
  assert.equal(renderTvAvatar({}), undefined);
});
