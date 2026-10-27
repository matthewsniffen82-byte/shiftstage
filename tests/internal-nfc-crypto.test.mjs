import assert from 'node:assert/strict';
import test from 'node:test';
import { aesCmac, verifyNtag424, ntag424Programming } from '../src/lib/dancr/ntag424.ts';
import { sessions, grantInput, grantCookie, id } from './helpers/internal-nfc-fixture.mjs';

const hex = value => Buffer.from(value, 'hex');
test('AES CMAC matches NIST SP 800-38B empty, full and partial block vectors', () => {
  const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
  const messages = ['', '6bc1bee22e409f96e93d7e117393172a', '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411'];
  const expected = ['bb1d6929e95937287fa37d129b756746', '070a16b46b4d4144f79bdd9dd04a287c', 'dfa66747de9ae63030ca32611497c827'];
  messages.forEach((value, i) => assert.equal(aesCmac(key, hex(value)).toString('hex'), expected[i]));
});
const nxp = { encrypted: 'EF963FF7828658A599F3041510671E88', mac: '94EED9EE65337086', uid: '04DE5F1EACC040', metaKey: '0'.repeat(32), fileKey: '0'.repeat(32) };
test('encrypted PICC and truncated CMAC match NXP AN12196 published vector', () => {
  assert.deepEqual(verifyNtag424(nxp), { counter: 61 });
  for (const field of ['encrypted', 'mac', 'uid', 'metaKey', 'fileKey']) {
    assert.equal(verifyNtag424({ ...nxp, [field]: '1' + nxp[field].slice(1) }), null, field);
    assert.equal(verifyNtag424({ ...nxp, [field]: 'not hex' }), null, field);
  }
});
test('exact NDEF encoding and offsets address the mirrored fields in file 02', () => {
  const settings = ntag424Programming('https://www.mydancr.com', id(40));
  const bytes = hex(settings.ndefHex);
  assert.equal(bytes.readUInt16BE(0), bytes.length - 2);
  assert.equal(bytes[6], 0, 'No URI prefix compression');
  assert.equal(bytes.subarray(7).toString(), settings.url);
  assert.equal(bytes.subarray(settings.piccOffset, settings.piccOffset + 32).toString(), '0'.repeat(32));
  assert.equal(bytes.subarray(settings.macOffset, settings.macOffset + 16).toString(), '0'.repeat(16));
  assert.equal(settings.macInputOffset, settings.macOffset);
  assert.ok(bytes.length <= 256);
});
test('a grant expires at exactly one hour and cannot be moved to another table or forged', () => {
  const now = 1700000000000;
  const cookie = grantCookie(grantInput, now);
  const request = new Request('https://example.invalid', { headers: { cookie } });
  assert.equal(sessions.readInternalGrant(request, grantInput.token, now + 3599999)?.link, grantInput.link);
  assert.equal(sessions.readInternalGrant(request, grantInput.token, now + 3600000), null);
  assert.equal(sessions.readInternalGrant(request, id(99), now), null);
  const tampered = cookie.replace(/.$/, cookie.endsWith('A') ? 'B' : 'A');
  assert.equal(sessions.readInternalGrant(new Request(request.url, { headers: { cookie: tampered } }), grantInput.token, now), null);
  assert.equal(sessions.readInternalGrant(request, grantInput.token, now - 1000), null);
  const stored = sessions.internalGrantCookie(grantInput.token, 'synthetic');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=3600', 'Path=/']) assert.ok(stored.includes(flag));
});
test('provisioning keys are encrypted and authenticated to their exact tag', () => {
  const keys = { adminKey: '1'.repeat(32), metaKey: '2'.repeat(32), fileKey: '3'.repeat(32) };
  const sealed = sessions.sealInternalTagKeys(id(40), keys);
  assert.ok(!sealed.includes(keys.adminKey));
  assert.deepEqual(JSON.parse(JSON.stringify(sessions.openInternalTagKeys(id(40), sealed))), keys);
  assert.throws(() => sessions.openInternalTagKeys(id(41), sealed));
  assert.throws(() => sessions.openInternalTagKeys(id(40), 'A' + sealed.slice(1)));
});
