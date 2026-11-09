import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import ts from 'typescript';
import * as mediaLimits from '../src/lib/dancr/media-limits.ts';

const require = createRequire(import.meta.url);
const source = name => readFileSync(new URL(`../app/dashboard/${name}`, import.meta.url), 'utf8');
const exports = {};
const requirements = {};
vm.runInNewContext(ts.transpileModule(source('DancerMediaRequirements.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: requirements, require: name => name === '@/src/lib/dancr/media-limits' ? mediaLimits : name.endsWith('.css') ? {} : require(name) });
vm.runInNewContext(ts.transpileModule(source('DancerMediaUploadRules.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require: name => name === './DancerMediaRequirements' ? requirements : name.endsWith('.css') ? {} : require(name) });
const render = props => renderToStaticMarkup(React.createElement(exports.default, props));

for (const kind of ['photo', 'video']) test(kind + ' rules start collapsed with a reading prompt and visible limits', () => {
 const html = render({kind});
 const disclosure = html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
 assert.ok(disclosure);
 assert.doesNotMatch(disclosure[1], /\bopen\b/);
 const summary = disclosure[2].match(/^<summary>([\s\S]*?)<\/summary>/)?.[1];
 assert.ok(summary);
 assert.match(summary, kind === 'photo' ? /Photo rules/ : /Video rules/);
 assert.match(summary, /Read before submitting/);
 assert.doesNotMatch(summary, /<button|<input/);
 for (const rule of [/Only you, 18/, /backgrounds or reflections/, /Bikinis, lingerie &amp; thongs OK/, /Cover nipples\/private parts/, /No sex acts/, /No logos, watermarks, contact info/, /social.payment handles or QR codes/, /permission to share/, /No drugs, violence, threats, hate or sexual solicitation/]) assert.match(disclosure[2], rule);
 const limits = html.match(/<\/details><p>([^<]+)<\/p>/)?.[1];
 assert.ok(limits);
 assert.match(limits, kind === 'photo' ? /JPEG, PNG, WebP, HEIC\/HEIF/ : /MP4, WebM, MOV/);
 assert.match(limits, kind === 'photo' ? /25 MB\/photo/ : /1–30 sec\/video/);
 assert.match(limits, /Approval required/);
 assert.match(html, /<span[^>]*>3 photos · 1 video · Extras optional<\/span>/);
 assert.doesNotMatch(html, /Required uploads/i);
});

test('onboarding counts show remaining minimums, main-photo needs and unknown video status without implying approval', () => {
 for (const kind of ['photo', 'video']) {
  const summary = progress => render({kind, progress}).split('<details')[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(summary({photos:0,videos:0,hasMain:false}), 'Photos 0/3 · Videos 0/1 · Extras optional Your main photo counts toward the 3 photos.');
  assert.equal(summary({photos:2,videos:0,hasMain:true}), 'Photos 2/3 · Videos 0/1 · Extras optional');
  assert.equal(summary({photos:3,videos:1,hasMain:false}), 'Photos 3/3 · Videos 1/1 · Extras optional Choose one of your photos as your main photo.');
  assert.equal(summary({photos:7,videos:2,hasMain:true}), 'Photos 3/3 · Videos 1/1 · Extras optional');
  assert.equal(summary({photos:3,videos:null,hasMain:true}), 'Photos 3/3 · Videos Checking… · Extras optional');
 }
});
test('face-photo rules retain the clear face requirement', () => {
 assert.match(render({kind:'photo',facePhoto:true}), /Keep your face clearly visible/);
 assert.doesNotMatch(render({kind:'photo'}), /Keep your face clearly visible/);
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
  assert.match(footer, /Portrait crop \(9:16\) · MP4, WebM, MOV/);
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
