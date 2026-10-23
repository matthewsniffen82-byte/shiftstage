import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = name => readFileSync(new URL(`../app/dashboard/${name}`, import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source('DancerMediaUploadRules.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require: name => name.endsWith('.css') ? {} : require(name) });
const render = props => renderToStaticMarkup(React.createElement(exports.default, props));

for (const kind of ['photo', 'video']) {
  test(`${kind} rules show every rule immediately without a disclosure`, () => {
    const html = render({ kind });
    const heading = html.match(/<div class="dancer-media-upload-rules-heading">(.*?)<\/div>/s)[1];
    assert.match(heading, new RegExp(kind === 'photo' ? 'Photo rules' : 'Video rules'));
    assert.match(heading, /Bikinis, lingerie, thongs, and cleavage are allowed\./);
    assert.match(heading, /Nipples, genitals, and anus must stay covered\. No sexual activity\./);
    assert.doesNotMatch(html, /No nudity/);
    assert.doesNotMatch(html, /<details|<summary|\bhidden\b|<input|<button/);
    for (const rule of [/Only you \(18\+\) may appear/, /backgrounds and reflections/, /No other people or minors/, /Bikinis, opaque lingerie, thongs, and cleavage are allowed/, /nipples, areolas, genitals, and anus are covered/, /Exposed buttocks from a thong are allowed\./, /No sex acts or masturbation/, /No visible brands, logos, or watermarks/, /clothing, accessories, and in the background/, /phone numbers, emails, social or payment handles, or QR codes/, /No sexual solicitation/, /drug use or sales/, /graphic violence/, /weapon threats/, /self-harm/, /hate, harassment, threats/, /coercion, nonconsensual content/, /deceptive impersonation/, /Uploads are reviewed before they appear publicly/]) {
      assert.match(html, rule);
    }
    if (kind === 'photo') {
      assert.match(html, /photos of yourself that you own or have permission to publish/);
      assert.match(html, /JPEG, PNG, WebP, HEIC, or HEIF\. Up to 25 MB per photo/);
      assert.doesNotMatch(html, /including music/);
    } else {
      assert.match(html, /permission to publish all visuals and audio, including music/);
      assert.doesNotMatch(html, /JPEG|HEIC/);
    }
  });
}

test('face-photo rules retain the clear face requirement', () => {
  assert.match(render({ kind: 'photo', facePhoto: true }), /Your face must be clearly visible/);
  assert.doesNotMatch(render({ kind: 'photo' }), /Your face must be clearly visible/);
});

test('every dancer upload entry includes rules for its own media type', () => {
  for (const panel of ['DancerPhotoPanel.tsx', 'DancerMainPhotoPanel.tsx']) {
    assert.match(source(panel), /<DancerMediaUploadRules kind="photo" \/>/);
  }
  // Avatars now crop an approved main photo rather than accepting another upload.
  assert.doesNotMatch(source('DancerAvatarPanel.tsx'), /type="file"/);
  assert.match(source('DancerTvStudio.tsx'), /<DancerMediaUploadRules kind="video" \/>/);
});

function rule(css, suffix) {
  let match;
  postcss.parse(css).walkRules(item => { if (item.selector.endsWith(suffix)) match = item; });
  assert.ok(match, suffix);
  return Object.fromEntries(match.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
}

test('video upload styling keeps unboxed permission rows and shared button fills in both editors', () => {
  for (const file of ['dancer-profile-workspace.css', 'dancer-profile-builder-polish.css']) {
    const css = source(file);
    const consent = rule(css, '.tv-check');
    assert.equal(consent.border, '0');
    assert.equal(consent.background, 'transparent');
    assert.equal(consent.padding, '2px 0');
    assert.equal(consent.color, '#e8e5ef');
    assert.equal(consent['min-height'], '44px');
    const action = rule(css, '.tv-upload-form .tv-video-source-action');
    assert.equal(action['min-height'], '44px');
    assert.equal(action['white-space'], 'normal');
    assert.equal(action.background, 'linear-gradient(var(--dancr-color-control-secondary),var(--dancr-color-control-secondary))');
    const primary = rule(css, '.tv-video-source-action.tv-video-source-library[aria-disabled="false"]:not(:disabled)');
    assert.equal(primary.background, 'linear-gradient(var(--dancr-color-control-secondary),var(--dancr-color-control-secondary))');
    assert.equal(primary.color, '#fff');
  }
});

test('video footer is compact and retains actual format, orientation, duration and size limits', () => {
  const studio = source('DancerTvStudio.tsx');
  const footer = studio.match(/<small className="tv-upload-requirements">([\s\S]*?)<\/small>/)[1];
  assert.match(footer, /Vertical or square · MP4, WebM, MOV/);
  assert.match(footer, /1–\{VIDEO_UPLOAD_MAX_SECONDS\} sec/);
  assert.match(footer, /\{VIDEO_UPLOAD_MAX_BYTES \/ \(1024 \* 1024\)\} MB max/);
  assert.doesNotMatch(footer, /<br|Select multiple/);
  assert.doesNotMatch(studio, /Add videos now or later\./);
  postcss.parse(source('dancer-media-upload-rules.css'));
});

test('permission, footer and enabled button colors have readable text contrast', () => {
  const luminance = hex => {
    const rgb = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  for (const [foreground, background] of [['e8e5ef', '0b0b10'], ['c1bdcc', '0b0b10'], ['bdb7c8', '121016'], ['ffffff', '6d28d9']]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${foreground} on ${background}`);
  }
});
