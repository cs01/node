// crypto module — real hashing via CommonCrypto, secure random via getentropy
'use strict';

const b = internalBinding('crypto');
const ALGO_MAP = { md5: 0, sha1: 1, sha256: 2, sha512: 3 };
const HASH_LEN = { md5: 16, sha1: 20, sha256: 32, sha512: 64 };

function randomBytes(size) {
  const buf = Buffer.alloc(size);
  b.randomFill(buf, size);
  return buf;
}

function randomUUID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = (start, end) => [...bytes.slice(start, end)].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h(0,4)}-${h(4,6)}-${h(6,8)}-${h(8,10)}-${h(10,16)}`;
}

function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  const range = max - min;
  const bytes = randomBytes(4);
  const val = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | ((bytes[3] & 0x7f) << 24)) >>> 0;
  return min + (val % range);
}

function createHash(algorithm) {
  const algo = ALGO_MAP[algorithm.toLowerCase()];
  if (algo === undefined) throw new Error(`Digest method not supported: ${algorithm}`);
  let chunks = [];
  let totalLen = 0;
  return {
    update(input, encoding) {
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, encoding);
      chunks.push(buf);
      totalLen += buf.length;
      return this;
    },
    digest(encoding) {
      const data = Buffer.concat(chunks, totalLen);
      const result = b.hash(algo, data, data.length);
      if (encoding === 'hex') return Buffer.from(result).toString('hex');
      if (encoding === 'base64') return Buffer.from(result).toString('base64');
      return Buffer.from(result);
    },
  };
}

function createHmac(algorithm, key) {
  // HMAC: hash(key XOR opad || hash(key XOR ipad || message))
  const hashLen = HASH_LEN[algorithm.toLowerCase()] || 32;
  const blockSize = algorithm.toLowerCase().includes('512') ? 128 : 64;
  let keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  if (keyBuf.length > blockSize) keyBuf = createHash(algorithm).update(keyBuf).digest();
  if (keyBuf.length < blockSize) { const padded = Buffer.alloc(blockSize); keyBuf.copy(padded); keyBuf = padded; }

  const ipad = Buffer.alloc(blockSize);
  const opad = Buffer.alloc(blockSize);
  for (let i = 0; i < blockSize; i++) { ipad[i] = keyBuf[i] ^ 0x36; opad[i] = keyBuf[i] ^ 0x5c; }

  const inner = createHash(algorithm).update(ipad);
  return {
    update(data, encoding) { inner.update(data, encoding); return this; },
    digest(encoding) {
      const innerHash = inner.digest();
      return createHash(algorithm).update(opad).update(innerHash).digest(encoding);
    },
  };
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

const stub = (name) => () => { throw new Error(`crypto.${name} not implemented`); };

module.exports = {
  randomBytes, randomUUID, randomInt, createHash, createHmac, timingSafeEqual,
  createCipheriv: stub('createCipheriv'), createDecipheriv: stub('createDecipheriv'),
  createSign: stub('createSign'), createVerify: stub('createVerify'),
  generateKeyPairSync: stub('generateKeyPairSync'), generateKeySync: stub('generateKeySync'),
  pbkdf2: stub('pbkdf2'), pbkdf2Sync: stub('pbkdf2Sync'),
  scrypt: stub('scrypt'), scryptSync: stub('scryptSync'),
  constants: {},
  getHashes: () => ['md5', 'sha1', 'sha256', 'sha512'],
  getCiphers: () => [],
  getCurves: () => [],
};
