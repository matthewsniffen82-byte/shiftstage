import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import * as sharing from '../src/lib/dancr/profile-social-sharing.ts';

const require = createRequire(import.meta.url);
const live = readFileSync('outputs/index.html', 'utf8');
const sourceFunction = name => live.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}`))[0];

test('social destinations preserve the exact profile URL and encode names without injecting parameters', () => {
  const url = 'https://www.mydancr.com/dancers/luna?city=Las+Vegas&profile=luna#photos';
  const text = "View Zoë & Luna's profile? #dance";
  const expected = {
    x: ['x.com', '/intent/tweet', 'url'],
    facebook: ['www.facebook.com', '/sharer/sharer.php', 'u'],
    reddit: ['www.reddit.com', '/submit', 'url'],
    snapchat: ['www.snapchat.com', '/share', 'link'],
  };
  for (const [platform, [host, path, param]] of Object.entries(expected)) {
    const destination = new URL(sharing.profileSocialShareUrl(platform, url, text));
    assert.equal(destination.protocol, 'https:');
    assert.equal(destination.hostname, host);
    assert.equal(destination.pathname, path);
    assert.equal(destination.searchParams.get(param), url);
    assert.equal(destination.searchParams.has('profile'), false);
    if (platform === 'x' || platform === 'reddit') assert.equal(destination.searchParams.get(platform === 'x' ? 'text' : 'title'), text);
  }
  assert.equal(sharing.profileSocialShareUrl('instagram', url, text), 'https://www.instagram.com/');
});

test('homepage and React menus agree on all five destinations and honor an assigned profile slug', () => {
  const context = {
    URL, encodeURIComponent,
    window: { location: { origin: 'https://www.mydancr.com' } },
    discoveryMarket: () => ({ dancers: [{ name: 'Luna', slug: 'different-luna' }] }),
    isApprovedPublicProfile: () => true,
    profileShareText: () => 'A profile & schedule',
  };
  vm.runInNewContext(sourceFunction('profileShareUrl') + sourceFunction('socialShareUrl') + ';this.share=socialShareUrl;', context);
  for (const {key} of sharing.PROFILE_SHARE_PLATFORMS) {
    assert.equal(context.share(key, 'Luna', 'Las Vegas', 'luna'), sharing.profileSocialShareUrl(key, 'https://www.mydancr.com/dancers/luna', context.profileShareText()));
  }
});

test('every homepage sharing platform has a visible SVG icon', () => {
  const context = {};
  vm.runInNewContext(sourceFunction('socialIconMarkup') + ';this.icon=socialIconMarkup;', context);
  for (const {key} of sharing.PROFILE_SHARE_PLATFORMS) assert.match(context.icon(key), /<svg viewBox="0 0 24 24">/, key);
});

function componentHarness(clipboard) {
  let state = null;
  const load = path => {
    const exports = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, navigator: { clipboard }, require(name) {
      if (name === 'react') return { useState: () => [state, next => { state = next; }] };
      if (name.endsWith('/profile-social-sharing')) return sharing;
      if (name.endsWith('/SocialLinks')) return load('app/dancers/[slug]/SocialLinks.tsx');
      if (name.endsWith('.css')) return {};
      return require(name);
    } });
    return exports;
  };
  const {ProfileSocialShareActions} = load('app/components/ProfileSocialShareActions.tsx');
  const render = (url = 'https://www.mydancr.com/dancers/luna') => ProfileSocialShareActions({profileUrl:url,stageName:'Luna'});
  const prepare = () => render().props.children[0].props.children.find(node => node.type === 'button').props.onClick();
  return {render, prepare};
}

test('icons are labeled and external links retain the existing third-party warning behavior', () => {
  const {render} = componentHarness({writeText: async () => {}});
  const html = renderToStaticMarkup(render());
  for (const {label} of sharing.PROFILE_SHARE_PLATFORMS) assert.ok(html.includes(`>${label}</span>`));
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 4);
  assert.doesNotMatch(html, /data-third-party-social-warning="off"/);
  assert.equal(render(''), null);
});

test('Instagram copies the public link and provides explicit open/paste instructions', async () => {
  let copied;
  const {render, prepare} = componentHarness({writeText: async value => {copied = value;}});
  await prepare();
  assert.equal(copied, 'https://www.mydancr.com/dancers/luna');
  const html = renderToStaticMarkup(render());
  assert.match(html, /Link copied\. Open Instagram and paste/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /href="https:\/\/www.instagram.com\/" target="_blank" rel="noopener noreferrer">Open Instagram/);
  assert.doesNotMatch(renderToStaticMarkup(render('https://www.mydancr.com/dancers/stacy')), /Open Instagram<\/a>/);
});

test('denied or unavailable clipboard access keeps a selectable link and does not claim it was copied', async () => {
  for (const clipboard of [undefined, {writeText: async () => {throw new Error('denied');}}]) {
    const {render, prepare} = componentHarness(clipboard);
    await prepare();
    const html = renderToStaticMarkup(render());
    assert.match(html, /Select and copy the link below/);
    assert.match(html, /aria-label="Profile link for Instagram" readOnly="" value="https:\/\/www.mydancr.com\/dancers\/luna"/);
    assert.doesNotMatch(html, /Link copied/);
  }
});
