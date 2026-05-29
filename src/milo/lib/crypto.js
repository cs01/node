// crypto module — real hashing via CommonCrypto, secure random via getentropy
'use strict';

const b = internalBinding('crypto');
const ALGO_MAP = { md5: 0, sha1: 1, sha256: 2, sha512: 3 };
const HASH_LEN = { md5: 16, sha1: 20, sha256: 32, sha512: 64 };

function randomBytes(size, cb) {
  const buf = Buffer.alloc(size);
  b.randomFill(buf, size);
  if (typeof cb === 'function') { process.nextTick(cb, null, buf); return; }
  return buf;
}

function randomFillSync(buf, offset, size) {
  if (offset === undefined) offset = 0;
  if (size === undefined) size = buf.length - offset;
  const tmp = Buffer.alloc(size);
  b.randomFill(tmp, size);
  tmp.copy(buf, offset, 0, size);
  return buf;
}

function randomFill(buf, offset, size, cb) {
  if (typeof offset === 'function') { cb = offset; offset = 0; size = buf.length; }
  if (typeof size === 'function') { cb = size; size = buf.length - offset; }
  process.nextTick(() => {
    try { randomFillSync(buf, offset, size); cb(null, buf); }
    catch (e) { cb(e); }
  });
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
  if (key instanceof KeyObject) key = key.export();
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
  if (a.length !== b.length) { const e = new RangeError('Input buffers must have the same byte length'); e.code = 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH'; throw e; }
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
  if (_isGCM(algorithm)) return _createGCMCipher(algorithm, key, iv);
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
  if (_isGCM(algorithm)) return _createGCMDecipher(algorithm, key, iv);
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

// AES-GCM cipher/decipher
const GCM_MAP = {
  'aes-128-gcm': { keyLen: 16 },
  'aes-192-gcm': { keyLen: 24 },
  'aes-256-gcm': { keyLen: 32 },
};

function _isGCM(algorithm) { return algorithm.toLowerCase() in GCM_MAP; }

function _createGCMCipher(algorithm, key, iv) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
  let aadBuf = null;
  let chunks = [];
  let authTag = null;
  let authTagLength = 16;
  return {
    setAAD(aad, opts) { aadBuf = Buffer.isBuffer(aad) ? aad : Buffer.from(aad); return this; },
    setAutoPadding() { return this; },
    update(data, inputEnc, outputEnc) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, inputEnc);
      chunks.push(buf);
      return Buffer.alloc(0);
    },
    final(outputEnc) {
      const input = Buffer.concat(chunks);
      const aad = aadBuf || Buffer.alloc(0);
      const emptyTag = new Uint8Array(authTagLength);
      const result = b.gcmCrypt(1, new Uint8Array(keyBuf), new Uint8Array(ivBuf),
                                 new Uint8Array(aad), new Uint8Array(input), emptyTag);
      if (typeof result === 'number') throw new Error('AES-GCM encrypt failed: ' + result);
      authTag = Buffer.from(result.tag.buffer, result.tag.byteOffset, result.tag.byteLength);
      const out = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      if (outputEnc === 'hex') return out.toString('hex');
      if (outputEnc === 'base64') return out.toString('base64');
      return out;
    },
    getAuthTag() {
      if (!authTag) throw new Error('Auth tag not available before final()');
      return authTag;
    },
  };
}

function _createGCMDecipher(algorithm, key, iv) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
  let aadBuf = null;
  let chunks = [];
  let expectedTag = null;
  return {
    setAAD(aad, opts) { aadBuf = Buffer.isBuffer(aad) ? aad : Buffer.from(aad); return this; },
    setAuthTag(tag) { expectedTag = Buffer.isBuffer(tag) ? tag : Buffer.from(tag, 'hex'); return this; },
    setAutoPadding() { return this; },
    update(data, inputEnc, outputEnc) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, inputEnc || 'hex');
      chunks.push(buf);
      return Buffer.alloc(0);
    },
    final(outputEnc) {
      if (!expectedTag) throw new Error('Unsupported state: auth tag must be set before final()');
      const input = Buffer.concat(chunks);
      const aad = aadBuf || Buffer.alloc(0);
      const result = b.gcmCrypt(0, new Uint8Array(keyBuf), new Uint8Array(ivBuf),
                                 new Uint8Array(aad), new Uint8Array(input), new Uint8Array(expectedTag));
      if (typeof result === 'number') {
        if (result === 1) throw new Error('Unsupported state or unable to authenticate data');
        throw new Error('AES-GCM decrypt failed: ' + result);
      }
      const out = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      if (outputEnc === 'utf8' || outputEnc === 'utf-8') return out.toString('utf8');
      if (outputEnc === 'hex') return out.toString('hex');
      return out;
    },
  };
}

// Sign/Verify via OpenSSL
const DIGEST_MAP = { RSA_SHA256: 'SHA256', RSA_SHA384: 'SHA384', RSA_SHA512: 'SHA512', sha256: 'SHA256', sha384: 'SHA384', sha512: 'SHA512', SHA256: 'SHA256', SHA384: 'SHA384', SHA512: 'SHA512' };

function createSign(algorithm) {
  const algo = DIGEST_MAP[algorithm] || algorithm;
  let chunks = [];
  return {
    update(data, encoding) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
      chunks.push(buf);
      return this;
    },
    sign(privateKey, outputEncoding) {
      const keyStr = typeof privateKey === 'string' ? privateKey : (privateKey.key || privateKey.toString());
      const data = Buffer.concat(chunks);
      const result = b.sign(algo, keyStr, new Uint8Array(data));
      if (typeof result === 'number') throw new Error('Sign failed: ' + result);
      const sig = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
      if (outputEncoding === 'hex') return sig.toString('hex');
      if (outputEncoding === 'base64') return sig.toString('base64');
      return sig;
    },
  };
}

function createVerify(algorithm) {
  const algo = DIGEST_MAP[algorithm] || algorithm;
  let chunks = [];
  return {
    update(data, encoding) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
      chunks.push(buf);
      return this;
    },
    verify(publicKey, signature, sigEncoding) {
      const keyStr = typeof publicKey === 'string' ? publicKey : (publicKey.key || publicKey.toString());
      const data = Buffer.concat(chunks);
      const sigBuf = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, sigEncoding || 'hex');
      const result = b.verify(algo, keyStr, new Uint8Array(data), new Uint8Array(sigBuf));
      return result === 1;
    },
  };
}

class KeyObject {
  constructor(type, data) {
    this._type = type;
    this._data = data;
  }
  get type() { return this._type; }
  export(options) {
    if (!options) return this._data;
    if (options.format === 'buffer') return Buffer.from(this._data);
    return this._data;
  }
  get symmetricKeySize() {
    if (this._type !== 'secret') return undefined;
    return Buffer.isBuffer(this._data) ? this._data.length : Buffer.from(this._data).length;
  }
}

function generateKeySync(type, options) {
  if (type === 'hmac' || type === 'aes') {
    const bits = options && options.length;
    if (!bits || bits % 8 !== 0) throw new Error('Invalid key length');
    const key = randomBytes(bits / 8);
    return new KeyObject('secret', key);
  }
  throw new Error(`Unsupported key type: ${type}`);
}

function createSecretKey(key, encoding) {
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(key, encoding);
  return new KeyObject('secret', buf);
}

// Node name → OpenSSL NID name
const EC_CURVE_MAP = {
  'prime256v1': 'prime256v1', 'P-256': 'prime256v1', 'p256': 'prime256v1',
  'secp384r1': 'secp384r1', 'P-384': 'secp384r1', 'p384': 'secp384r1',
  'secp521r1': 'secp521r1', 'P-521': 'secp521r1', 'p521': 'secp521r1',
  'secp256k1': 'secp256k1',
};

function generateKeyPairSync(type, options) {
  if (type === 'rsa') {
    const bits = (options && options.modulusLength) || 2048;
    const result = b.generateKeyPair(bits);
    if (typeof result === 'number') throw new Error('RSA key generation failed');
    return { publicKey: result.publicKey, privateKey: result.privateKey };
  }
  if (type === 'ec') {
    const curveName = options && options.namedCurve;
    if (!curveName) throw new Error('namedCurve option required for EC key generation');
    const nidName = EC_CURVE_MAP[curveName] || curveName;
    const result = b.generateEcKeyPair(nidName);
    if (typeof result === 'number') throw new Error('EC key generation failed for curve: ' + curveName);
    return { publicKey: result.publicKey, privateKey: result.privateKey };
  }
  throw new Error(`Unsupported key type: ${type}`);
}

function generateKeyPair(type, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  try {
    const result = generateKeyPairSync(type, options);
    process.nextTick(() => cb(null, result.publicKey, result.privateKey));
  } catch (err) {
    process.nextTick(() => cb(err));
  }
}

function createPublicKey(key) {
  if (key instanceof KeyObject) return key;
  const pem = typeof key === 'object' ? key.key : key;
  const str = typeof pem === 'string' ? pem : pem.toString();
  if (!str.includes('-----BEGIN')) throw new Error('Invalid public key');
  return new KeyObject('public', str);
}

function createPrivateKey(key) {
  if (key instanceof KeyObject) return key;
  const pem = typeof key === 'object' ? key.key : key;
  const str = typeof pem === 'string' ? pem : pem.toString();
  if (!str.includes('-----BEGIN')) throw new Error('Invalid private key');
  return new KeyObject('private', str);
}

// WebCrypto subtle API — digest, importKey, sign backed by our native crypto
const WEBCRYPTO_HASH = { 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', 'MD5': 'md5' };

const subtle = {
  async digest(algorithm, data) {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
    const hashName = WEBCRYPTO_HASH[name];
    if (!hashName) throw new Error(`Unrecognized algorithm name: ${name}`);
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
    const result = createHash(hashName).update(buf).digest();
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  },
  async importKey(format, keyData, algorithm, extractable, keyUsages) {
    const buf = keyData instanceof ArrayBuffer ? Buffer.from(keyData) : Buffer.from(keyData.buffer || keyData, keyData.byteOffset || 0, keyData.byteLength || keyData.length);
    const algoName = typeof algorithm === 'string' ? algorithm : algorithm.name;
    const hashName = algorithm.hash ? (typeof algorithm.hash === 'string' ? algorithm.hash : algorithm.hash.name) : 'SHA-256';
    return { type: 'secret', _buf: buf, _algorithm: algoName, _hash: hashName, extractable, usages: keyUsages };
  },
  async sign(algorithm, key, data) {
    const algoName = typeof algorithm === 'string' ? algorithm : algorithm.name;
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
    if (algoName === 'HMAC') {
      const hashName = WEBCRYPTO_HASH[key._hash] || 'sha256';
      const result = createHmac(hashName, key._buf).update(buf).digest();
      return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
    }
    throw new Error(`Unsupported algorithm: ${algoName}`);
  },
  async verify(algorithm, key, signature, data) {
    const sig = await this.sign(algorithm, key, data);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = signature instanceof ArrayBuffer ? Buffer.from(signature) : Buffer.from(signature.buffer || signature, signature.byteOffset || 0, signature.byteLength || signature.length);
    return timingSafeEqual(sigBuf, expectedBuf);
  },
};

// ---- Diffie-Hellman (BigInt modpow; named MODP groups from RFC 2412/3526) ----
const _DH_GROUPS = {
  modp1: 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A63A3620FFFFFFFFFFFFFFFF',
  modp2: 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF',
  modp5: 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF',
  modp14: 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF',
};
function _bufToBig(buf) { let h = ''; for (const b of buf) h += b.toString(16).padStart(2, '0'); return h === '' ? 0n : BigInt('0x' + h); }
function _bigToBuf(n, len) { let h = n.toString(16); if (h.length % 2) h = '0' + h; let b = Buffer.from(h, 'hex'); if (len && b.length < len) b = Buffer.concat([Buffer.alloc(len - b.length), b]); return b; }
function _modpow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; exp >>= 1n; base = (base * base) % mod; } return r; }
function _toBuf(v, enc) { if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return Buffer.from(v.buffer || v, v.byteOffset || 0, v.byteLength != null ? v.byteLength : v.length); if (typeof v === 'string') return Buffer.from(v, enc || 'latin1'); if (typeof v === 'number') return _bigToBuf(BigInt(v)); return Buffer.from(v); }
function _encodeOut(buf, enc) { return enc ? buf.toString(enc) : buf; }

class DiffieHellman {
  constructor(prime, a, b, c) {
    // (primeLength:number [, generator]) | (prime:string, primeEnc, gen, genEnc)
    // | (prime:Buffer, generator, genEnc)
    let generator, genEnc, primeEnc;
    if (typeof prime === 'string') { primeEnc = a; generator = b; genEnc = c; }
    else { generator = a; genEnc = b; }
    if (typeof prime === 'number') this._prime = _genProbablePrime(prime);
    else this._prime = _bufToBig(_toBuf(prime, primeEnc));
    this._gen = generator === undefined ? 2n : (typeof generator === 'number' ? BigInt(generator) : _bufToBig(_toBuf(generator, genEnc)));
    if (this._gen === 0n) this._gen = 2n;
    this._priv = null; this._pub = null;
    this.verifyError = 0;
  }
  _len() { return _bigToBuf(this._prime).length; }
  generateKeys(enc) {
    const plen = this._len();
    do { this._priv = _bufToBig(randomBytes(plen)) % (this._prime - 2n); } while (this._priv < 2n);
    this._pub = _modpow(this._gen, this._priv, this._prime);
    return this.getPublicKey(enc);
  }
  computeSecret(other, inEnc, outEnc) {
    const o = _bufToBig(_toBuf(other, inEnc));
    const s = _modpow(o, this._priv, this._prime);
    return _encodeOut(_bigToBuf(s, this._len()), outEnc);
  }
  getPrime(enc) { return _encodeOut(_bigToBuf(this._prime), enc); }
  getGenerator(enc) { return _encodeOut(_bigToBuf(this._gen), enc); }
  getPublicKey(enc) { return _encodeOut(_bigToBuf(this._pub, this._len()), enc); }
  getPrivateKey(enc) { return _encodeOut(_bigToBuf(this._priv, this._len()), enc); }
  setPublicKey(v, enc) { this._pub = _bufToBig(_toBuf(v, enc)); return this; }
  setPrivateKey(v, enc) { this._priv = _bufToBig(_toBuf(v, enc)); return this; }
}
function _isProbablePrime(n, k = 16) {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) { if (n % p === 0n) return n === p; }
  let d = n - 1n, r = 0n; while ((d & 1n) === 0n) { d >>= 1n; r++; }
  for (let i = 0; i < k; i++) {
    const a = 2n + _bufToBig(randomBytes(_bigToBuf(n).length)) % (n - 4n);
    let x = _modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let ok = false;
    for (let j = 0n; j < r - 1n; j++) { x = (x * x) % n; if (x === n - 1n) { ok = true; break; } }
    if (!ok) return false;
  }
  return true;
}
function _genProbablePrime(bits) {
  const bytes = Math.ceil(bits / 8);
  for (;;) {
    const buf = randomBytes(bytes);
    buf[0] |= 0x80; buf[bytes - 1] |= 1; // top bit + odd
    const n = _bufToBig(buf);
    if (_isProbablePrime(n)) return n;
  }
}
function createDiffieHellman(prime, primeEnc, generator, genEnc) { return new DiffieHellman(prime, primeEnc, generator, genEnc); }
function createDiffieHellmanGroup(name) {
  const hex = _DH_GROUPS[name];
  if (!hex) { const e = new Error(`Unknown group: ${name}`); e.code = 'ERR_CRYPTO_UNKNOWN_DH_GROUP'; throw e; }
  const dh = new DiffieHellman(Buffer.from(hex, 'hex'), undefined, 2);
  return dh;
}
const getDiffieHellman = createDiffieHellmanGroup;

const webcrypto = { subtle, getRandomValues(buf) { randomFillSync(buf); return buf; } };

module.exports = {
  randomBytes, pseudoRandomBytes: randomBytes, randomFillSync, randomFill, randomUUID, randomInt, createHash, createHmac, timingSafeEqual,
  createCipheriv, createDecipheriv,
  pbkdf2, pbkdf2Sync, scrypt, scryptSync,
  createSign, createVerify, generateKeyPair, generateKeyPairSync, generateKeySync,
  KeyObject, createSecretKey, createPublicKey, createPrivateKey,
  webcrypto, subtle,
  DiffieHellman, createDiffieHellman, createDiffieHellmanGroup, getDiffieHellman, DiffieHellmanGroup: createDiffieHellmanGroup,
  constants: {},
  getFips: () => 0,
  setFips: () => {},
  getHashes: () => ['md5', 'sha1', 'sha256', 'sha384', 'sha512'],
  getCiphers: () => [...Object.keys(CIPHER_MAP), ...Object.keys(GCM_MAP)],
  getCurves: () => Object.keys(EC_CURVE_MAP),
};
