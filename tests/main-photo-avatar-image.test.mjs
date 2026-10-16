import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';
import * as core from '../src/lib/dancr/avatar-face-core.ts';
import { detector, avatarSample } from './helpers/avatar-face-runtime.mjs';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/main-photo-avatar-image.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, { exports, Buffer, require: name => ({ 'server-only': {}, sharp, './avatar-face-core': core, './avatar-face-detector': detector })[name] });
const { cropMainPhotoAvatar } = exports;

test('automatic avatars are square for portrait, landscape and square approved photos', async () => {
  for (const [width, height] of [[900,1200],[1200,900],[300,300]]) {
    const source = await sharp({ create: { width, height, channels: 3, background: '#aa7755' } }).jpeg().toBuffer();
    const result = await sharp(await cropMainPhotoAvatar(source)).metadata();
    assert.equal(result.width, Math.min(width,height,640)); assert.equal(result.height,result.width);
  }
});
test('automatic crop uses the local face detector on an actual photo', async () => {
  const sample = await avatarSample();
  const result = await cropMainPhotoAvatar(sample.buffer);
  assert.ok(await detector.locateAvatarFace(result));
});
test('manual crop honors position and zoom from the approved source without replacing bytes', async () => {
  const top = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const source = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#0000ff' } }).composite([{ input: top, top: 0, left: 0 }]).png().toBuffer();
  const output = await cropMainPhotoAvatar(source,{ x:0,y:.5,width:1,height:.5 });
  const stats = await sharp(output).stats(); assert.ok(stats.channels[2].mean > 240); assert.ok(stats.channels[0].mean < 10);
});
test('out-of-bounds, non-square, excessive zoom and nonnumeric crops fail closed', async () => {
  const source = await sharp({ create: { width:300,height:600,channels:3,background:'#fff' } }).png().toBuffer();
  for (const crop of [{x:-1,y:0,width:1,height:.5},{x:0,y:.9,width:1,height:.5},{x:0,y:0,width:1,height:1},{x:0,y:0,width:.01,height:.005},{x:0,y:0,width:'1',height:.5},{x:0,y:0,width:NaN,height:.5},{}]) {
    await assert.rejects(cropMainPhotoAvatar(source,crop),/INVALID_AVATAR_CROP/);
  }
});
