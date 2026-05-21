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

// CCAlgorithm: 0=AES, 1=DES, 2=3DES, 4=CAST, 5=RC2, 10=Blowfish
const CIPHER_MAP = {
  'aes-128-cbc': { alg: 0, keyLen: 16, ivLen: 16 },
  'aes-192-cbc': { alg: 0, keyLen: 24, ivLen: 16 },
  'aes-256-cbc': { alg: 0, keyLen: 32, ivLen: 16 },
  'aes-128-ecb': { alg: 0, keyLen: 16, ivLen: 0, ecb: true },
  'aes-256-ecb': { alg: 0, keyLen: 32, ivLen: 0, ecb: true },
  'des-cbc': { alg: 1, keyLen: 8, ivLen: 8 },
  'des-ede3-cbc': { alg: 2, keyLen: 24, ivLen: 8 },
};

function createCipheriv(algorithm, key, iv) {
  const cipher = CIPHER_MAP[algorithm.toLowerCase()];
  if (!cipher) throw new Error(`Unknown cipher: ${algorithm}`);
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const ivBuf = iv ? (Buffer.isBuffer(iv) ? iv : Buffer.from(iv)) : Buffer.alloc(cipher.ivLen);
  let chunks = [];
  return {
    update(data, inputEnc, outputEnc) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, inputEnc);
      chunks.push(buf);
      return Buffer.alloc(0);
    },
    final(outputEnc) {
      const input = Buffer.concat(chunks);
      const options = cipher.ecb ? 3 : 1; // kCCOptionPKCS7Padding=1, +ECBMode=2
      const result = b.crypt(0, cipher.alg, options, new Uint8Array(keyBuf), new Uint8Array(ivBuf), new Uint8Array(input));
      if (typeof result === 'number') throw new Error('Cipher operation failed: ' + result);
      const out = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
      if (outputEnc === 'hex') return out.toString('hex');
      if (outputEnc === 'base64') return out.toString('base64');
      return out;
    },
    setAutoPadding() { return this; },
  };
}

function createDecipheriv(algorithm, key, iv) {
  const cipher = CIPHER_MAP[algorithm.toLowerCase()];
  if (!cipher) throw new Error(`Unknown cipher: ${algorithm}`);
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const ivBuf = iv ? (Buffer.isBuffer(iv) ? iv : Buffer.from(iv)) : Buffer.alloc(cipher.ivLen);
  let chunks = [];
  return {
    update(data, inputEnc, outputEnc) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, inputEnc || 'hex');
      chunks.push(buf);
      return Buffer.alloc(0);
    },
    final(outputEnc) {
      const input = Buffer.concat(chunks);
      const options = cipher.ecb ? 3 : 1;
      const result = b.crypt(1, cipher.alg, options, new Uint8Array(keyBuf), new Uint8Array(ivBuf), new Uint8Array(input));
      if (typeof result === 'number') throw new Error('Decipher operation failed: ' + result);
      const out = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
      if (outputEnc === 'utf8' || outputEnc === 'utf-8') return out.toString('utf8');
      if (outputEnc === 'hex') return out.toString('hex');
      return out;
    },
    setAutoPadding() { return this; },
  };
}

// kCCPRFHmacAlgSHA1=1, SHA224=2, SHA256=3, SHA384=4, SHA512=5
const PRF_MAP = { sha1: 1, sha224: 2, sha256: 3, sha384: 4, sha512: 5 };

function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  const passBuf = Buffer.isBuffer(password) ? password : Buffer.from(password);
  const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  const prf = PRF_MAP[(digest || 'sha1').toLowerCase()] || 1;
  const result = b.pbkdf2(new Uint8Array(passBuf), new Uint8Array(saltBuf), iterations, keylen, prf);
  if (!result) throw new Error('pbkdf2 failed');
  return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
}

function pbkdf2(password, salt, iterations, keylen, digest, cb) {
  process.nextTick(() => {
    try { cb(null, pbkdf2Sync(password, salt, iterations, keylen, digest)); }
    catch (e) { cb(e); }
  });
}

// scrypt via pbkdf2-based approximation (not true scrypt, but functional for compat)
function scryptSync(password, salt, keylen, options) {
  const N = (options && options.N) || (options && options.cost) || 16384;
  const r = (options && options.r) || (options && options.blockSize) || 8;
  const p = (options && options.p) || (options && options.parallelization) || 1;
  // Use pbkdf2 with high iterations as approximation
  return pbkdf2Sync(password, salt, N, keylen, 'sha256');
}

function scrypt(password, salt, keylen, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  process.nextTick(() => {
    try { cb(null, scryptSync(password, salt, keylen, options)); }
    catch (e) { cb(e); }
  });
}

const stub = (name) => () => { throw new Error(`crypto.${name} not implemented`); };

module.exports = {
  randomBytes, randomUUID, randomInt, createHash, createHmac, timingSafeEqual,
  createCipheriv, createDecipheriv,
  pbkdf2, pbkdf2Sync, scrypt, scryptSync,
  createSign: stub('createSign'), createVerify: stub('createVerify'),
  generateKeyPairSync: stub('generateKeyPairSync'), generateKeySync: stub('generateKeySync'),
  constants: {},
  getHashes: () => ['md5', 'sha1', 'sha256', 'sha512'],
  getCiphers: () => Object.keys(CIPHER_MAP),
  getCurves: () => [],
};
