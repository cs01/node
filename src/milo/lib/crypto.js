// crypto module — stub with randomBytes/randomUUID via Math.random
'use strict';

function randomBytes(size) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

function randomUUID() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = buf => [...buf].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h(b.slice(0,4))}-${h(b.slice(4,6))}-${h(b.slice(6,8))}-${h(b.slice(8,10))}-${h(b.slice(10,16))}`;
}

function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  return Math.floor(Math.random() * (max - min)) + min;
}

function createHash(algorithm) {
  let data = Buffer.alloc(0);
  return {
    update(input, encoding) { data = Buffer.concat([data, Buffer.from(input, encoding)]); return this; },
    digest(encoding) {
      // djb2-style hash — not cryptographic, but produces consistent output
      let h = 5381;
      for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data[i]) >>> 0;
      const buf = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) { buf[i] = h & 0xff; h = ((h << 5) + h + i) >>> 0; }
      if (encoding === 'hex') return buf.toString('hex');
      if (encoding === 'base64') return buf.toString('base64');
      return buf;
    },
  };
}

function createHmac(algorithm, key) {
  return createHash(algorithm);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

const stub = () => { throw new Error('crypto not fully implemented'); };

module.exports = {
  randomBytes, randomUUID, randomInt, createHash, createHmac, timingSafeEqual,
  createCipheriv: stub, createDecipheriv: stub, createSign: stub, createVerify: stub,
  generateKeyPairSync: stub, generateKeySync: stub, pbkdf2: stub, pbkdf2Sync: stub,
  scrypt: stub, scryptSync: stub,
  constants: {},
  getHashes: () => ['sha1', 'sha256', 'sha512', 'md5'],
  getCiphers: () => [],
  getCurves: () => [],
};
