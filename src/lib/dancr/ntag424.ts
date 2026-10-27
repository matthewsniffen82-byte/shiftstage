import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

// AES SDM, encrypted UID + read counter, CMACInputOffset == CMACOffset.
// NXP AN12196 §3.4.2 and §3.4.4.2.1; CMAC follows NIST SP 800-38B.
function aesBlock(key: Buffer, block: Buffer) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}
function doubled(block: Buffer) {
  const out = Buffer.alloc(16);
  for (let i = 15, carry = 0; i >= 0; i--) { out[i] = (block[i] << 1) | carry; carry = block[i] >>> 7; }
  if (block[0] & 128) out[15] ^= 0x87;
  return out;
}
const xor = (a: Buffer, b: Buffer) => Buffer.from(a.map((value, i) => value ^ b[i]));
export function aesCmac(key: Buffer, message: Buffer) {
  if (key.length !== 16) throw new Error("Invalid AES key length.");
  const k1 = doubled(aesBlock(key, Buffer.alloc(16))), k2 = doubled(k1);
  const count = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;
  const last = Buffer.alloc(16);
  message.copy(last, 0, (count - 1) * 16);
  if (!complete) last[message.length % 16] = 128;
  let state = Buffer.alloc(16);
  for (let i = 0; i < count - 1; i++) state = aesBlock(key, xor(state, message.subarray(i * 16, i * 16 + 16)));
  return aesBlock(key, xor(state, xor(last, complete ? k1 : k2)));
}
export function verifyNtag424(input: { encrypted: string; mac: string; uid: string; metaKey: string; fileKey: string }) {
  if (!/^[\da-f]{32}$/i.test(input.encrypted) || !/^[\da-f]{16}$/i.test(input.mac)
    || !/^[\da-f]{14}$/i.test(input.uid) || !/^[\da-f]{32}$/i.test(input.metaKey) || !/^[\da-f]{32}$/i.test(input.fileKey)) return null;
  const cipher = createDecipheriv("aes-128-cbc", Buffer.from(input.metaKey, "hex"), Buffer.alloc(16));
  cipher.setAutoPadding(false);
  const plain = Buffer.concat([cipher.update(Buffer.from(input.encrypted, "hex")), cipher.final()]);
  if (plain[0] !== 0xc7 || !timingSafeEqual(plain.subarray(1, 8), Buffer.from(input.uid, "hex"))) return null;
  const vector = Buffer.concat([Buffer.from("3cc300010080", "hex"), plain.subarray(1, 11)]);
  const sessionKey = aesCmac(Buffer.from(input.fileKey, "hex"), vector);
  const full = aesCmac(sessionKey, Buffer.alloc(0));
  const truncated = Buffer.from(full.filter((_, i) => i % 2 === 1));
  if (!timingSafeEqual(truncated, Buffer.from(input.mac, "hex"))) return null;
  const counter = plain.readUIntLE(8, 3);
  return counter > 0 ? { counter } : null;
}

export function ntag424Programming(origin: string, id: string) {
  const url = `${origin}/internal/tap/${id}?e=${"0".repeat(32)}&c=${"0".repeat(16)}`;
  // Exact uncompressed URI record (identifier code 00), including the two-byte NLEN.
  // Tools that compress https:// must recalculate offsets; use these NDEF bytes as-is.
  const uri = Buffer.from(url, "utf8");
  if (uri.length > 240) throw new Error("NFC programming URL is too long.");
  const record = Buffer.concat([Buffer.from([0xd1, 1, uri.length + 1, 0x55, 0]), uri]);
  const length = Buffer.alloc(2); length.writeUInt16BE(record.length);
  const piccOffset = 7 + uri.indexOf("?e=") + 3;
  const macOffset = 7 + uri.indexOf("&c=") + 3;
  return { url, ndefHex: Buffer.concat([length, record]).toString("hex").toUpperCase(),
    fileNumber: 2, fileOption: "40", accessRights: "00E0", sdmOptions: "C1", sdmAccessRights: "F012",
    piccOffset, macInputOffset: macOffset, macOffset,
    metaReadKeyNumber: 1, fileReadKeyNumber: 2, changeKeyNumber: 0 };
}
