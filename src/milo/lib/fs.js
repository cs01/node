// fs module — sync wrappers over internalBinding('fs')
'use strict';

const b = internalBinding('fs');

function _ERR_INVALID_ARG_TYPE(name, expected, actual) {
  let actualStr;
  if (actual == null) actualStr = String(actual);
  else if (typeof actual === 'function') actualStr = 'function ' + (actual.name || '');
  else if (typeof actual === 'object') actualStr = 'an instance of ' + (actual.constructor && actual.constructor.name || 'Object');
  else {
    let inspected = String(actual);
    if (typeof actual === 'string') inspected = "'" + actual + "'";
    if (inspected.length > 28) inspected = inspected.slice(0, 25) + '...';
    actualStr = 'type ' + typeof actual + ' (' + inspected + ')';
  }
  const e = new TypeError(`The "${name}" argument must be of type ${expected}. Received ${actualStr}`);
  e.code = 'ERR_INVALID_ARG_TYPE';
  return e;
}

const _validEncodings = new Set(['ascii', 'utf8', 'utf-8', 'utf16le', 'utf-16le', 'ucs2', 'ucs-2', 'base64', 'base64url', 'latin1', 'binary', 'hex', 'buffer', null, undefined]);
function _assertEncoding(encoding) {
  if (encoding != null && !_validEncodings.has(encoding)) {
    const e = new TypeError("The \"encoding\" argument must be one of type string or null. Received '" + encoding + "'");
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
}
function _getEncoding(opts) {
  const enc = typeof opts === 'string' ? opts : (opts && opts.encoding);
  _assertEncoding(enc);
  return enc || null;
}

function _validatePath(p, name) {
  if (typeof p !== 'string' && !Buffer.isBuffer(p)) {
    if (p instanceof URL) {
      if (p.protocol !== 'file:') {
        const err = new TypeError('The URL must be of scheme file');
        err.code = 'ERR_INVALID_URL_SCHEME'; throw err;
      }
      if (p.hostname) {
        const err = new TypeError('File URL host must be "localhost" or empty on darwin');
        err.code = 'ERR_INVALID_FILE_URL_HOST'; throw err;
      }
      const pathname = p.pathname;
      if (/%2[fF]/.test(p.href)) {
        const err = new TypeError('File URL path must not include encoded / characters');
        err.code = 'ERR_INVALID_FILE_URL_PATH'; throw err;
      }
      if (pathname.indexOf('\0') !== -1 || pathname.indexOf('%00') !== -1) {
        const err = new TypeError(`The "${name || 'path'}" argument must be of type string without null bytes. Received ${JSON.stringify(pathname)}`);
        err.code = 'ERR_INVALID_ARG_VALUE';
        throw err;
      }
      return;
    }
    throw _ERR_INVALID_ARG_TYPE(name || 'path', 'string or an instance of Buffer or URL', p);
  }
  if (typeof p === 'string' && p.indexOf('\0') !== -1) {
    const err = new TypeError('The "path" argument must be of type string without null bytes. Received ' + JSON.stringify(p));
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
  }
}

function _validateCallback(cb, name) {
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE(name || 'callback', 'function', cb);
}

function _validateFd(fd) {
  if (typeof fd !== 'number') throw _ERR_INVALID_ARG_TYPE('fd', 'number', fd);
  if (!Number.isInteger(fd)) {
    const e = new RangeError(`The value of "fd" is out of range. It must be an integer. Received ${fd}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  if (fd < 0 || fd > 2147483647) {
    const e = new RangeError(`The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received ${fd}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
}
function _validateMode(mode, name) {
  if (typeof mode === 'string') {
    if (!/^[0-7]+$/.test(mode)) { const e = new TypeError(`The "${name || 'mode'}" argument must be a 32-bit unsigned integer or an octal string. Received '${mode}'`); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; }
    return parseInt(mode, 8);
  }
  if (typeof mode !== 'number') throw _ERR_INVALID_ARG_TYPE(name || 'mode', 'number', mode);
  if (!Number.isInteger(mode)) {
    const e = new RangeError(`The value of "${name || 'mode'}" is out of range. It must be an integer. Received ${mode}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  if (mode < 0 || mode > 0xFFFFFFFF) {
    const e = new RangeError(`The value of "${name || 'mode'}" is out of range. It must be >= 0 && <= 4294967295. Received ${mode}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  return mode;
}

// convert URL/Buffer/string to string path
function _toPath(p) {
  if (p instanceof URL) {
    if (p.protocol !== 'file:') {
      const err = new TypeError('The URL must be of scheme file');
      err.code = 'ERR_INVALID_URL_SCHEME';
      throw err;
    }
    return decodeURIComponent(p.pathname);
  }
  return String(p);
}

function readFileSync(path, opts) {
  const encoding = _getEncoding(opts);
  if (typeof path === 'number') {
    const chunks = [];
    const buf = Buffer.alloc(8192);
    let n;
    // copy each chunk — buf.slice() is a view into the reused buffer, so pushing
    // views and concat'ing later aliases every chunk to the final read's bytes.
    while ((n = readSync(path, buf, 0, 8192, null)) > 0) chunks.push(Buffer.from(buf.subarray(0, n)));
    const result = Buffer.concat(chunks);
    return encoding ? result.toString(encoding) : result;
  }
  _validatePath(path, 'path');
  const p = _toPath(path);
  const flag = (opts && typeof opts === 'object') ? (opts.flag || 'r') : 'r';
  if (flag.indexOf('x') !== -1) {
    if (existsSync(p)) throw _fsError('EEXIST', 'open', p, 'file already exists');
  }
  if (flag.indexOf('a') !== -1 || flag.indexOf('w') !== -1) {
    if (!existsSync(p)) { writeFileSync(path, ''); }
  }
  // Non-regular files (pipes/fifos/char devices/sockets, e.g. /dev/stdin) report
  // size 0 to stat, so native b.readFile reads nothing useful — loop-read via fd until EOF.
  {
    let st = null;
    try { st = statSync(p); } catch {}
    if (st && ((st.isFIFO && st.isFIFO()) || (st.isCharacterDevice && st.isCharacterDevice()) || (st.isSocket && st.isSocket()))) {
      const fd = openSync(p, flag);
      try { return readFileSync(fd, opts); } finally { closeSync(fd); }
    }
  }
  // Guard before reading the whole file into memory: Node caps single reads at
  // kIoMaxLength (2**31-1). Without this a multi-GB file would OOM the process.
  {
    let st = null;
    try { st = statSync(p); } catch {}
    if (st && st.size > 2147483647) {
      const e = new RangeError(`File size (${st.size}) is greater than 2 GiB`);
      e.code = 'ERR_FS_FILE_TOO_LARGE'; throw e;
    }
  }
  // Read via fd to preserve raw bytes — b.readFile returns a V8 string, which
  // mangles any non-UTF8 byte into U+FFFD (corrupts all binary files).
  const fd = openSync(p, flag);
  try { return readFileSync(fd, opts); } finally { closeSync(fd); }
}

function _fsError(code, syscall, path, msg, dest) {
  const pathStr = path != null ? ` '${path}'` : '';
  const destStr = dest != null ? ` -> '${dest}'` : '';
  const e = new Error(`${code}: ${msg}, ${syscall}${pathStr}${destStr}`);
  e.code = code; e.syscall = syscall;
  if (path != null) e.path = String(path);
  if (dest != null) e.dest = String(dest);
  return e;
}

function _validateWriteData(data) {
  if (typeof data !== 'string' && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data) && !(data instanceof DataView)) {
    throw _ERR_INVALID_ARG_TYPE('data', 'string, Buffer, TypedArray, or DataView', data);
  }
}

function writeFileSync(path, data, options) {
  if (typeof options === 'string') options = { encoding: options };
  const opts = options || {};
  _assertEncoding(opts.encoding);
  _validateWriteData(data);
  if (typeof path === 'number') {
    const buf = typeof data === 'string' ? Buffer.from(data, opts.encoding || 'utf8') : Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (buf.length > 0) _fdWriteChecked(path, buf, buf.length, 'write');
    return;
  }
  _validatePath(path, 'path');
  const p = _toPath(path);
  const flag = opts.flag || 'w';
  const mode = opts.mode != null ? (typeof opts.mode === 'string' ? parseInt(opts.mode, 8) : opts.mode) : 0o666;
  const fd = b.open(p, stringToFlags(flag), mode);
  if (fd < 0) throw _fsError('ENOENT', 'open', p);
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, opts.encoding || 'utf8') : Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (buf.length > 0) _fdWriteChecked(fd, buf, buf.length, 'write');
  } finally {
    b.close(fd);
  }
}

function appendFileSync(path, data, options) {
  if (typeof options === 'string') options = { encoding: options };
  const opts = options || {};
  _assertEncoding(opts.encoding);
  // validate data BEFORE opening — an invalid type must throw without creating the file.
  _validateWriteData(data);
  // an fd path skips _validatePath (path is a number); only validate real paths.
  if (typeof path !== 'number') _validatePath(path, 'path');
  if (typeof path === 'number') {
    const buf = typeof data === 'string' ? Buffer.from(data, opts.encoding || 'utf8') : data;
    if (buf.length > 0) _fdWriteChecked(path, buf, buf.length, 'write');
    return;
  }
  const p = _toPath(path);
  const mode = opts.mode != null ? (typeof opts.mode === 'string' ? parseInt(opts.mode, 8) : opts.mode) : 0o666;
  const fd = b.open(p, stringToFlags('a'), mode);
  if (fd < 0) throw _fsError('ENOENT', 'open', p);
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, opts.encoding || 'utf8') : Buffer.from(data);
    if (buf.length > 0) _fdWriteChecked(fd, buf, buf.length, 'write');
  } finally {
    b.close(fd);
  }
}

function Stats(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs) {
  if (!new.target) {
    process.emitWarning('fs.Stats constructor is deprecated.', 'DeprecationWarning', 'DEP0180');
    return new Stats(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs);
  }
  this.dev = dev || 0; this.mode = mode || 0; this.nlink = nlink || 0;
  this.uid = uid || 0; this.gid = gid || 0; this.rdev = rdev || 0;
  this.blksize = blksize || 4096; this.ino = ino || 0; this.size = size || 0;
  this.blocks = blocks || 0;
  this.atimeMs = atimeMs || 0; this.mtimeMs = mtimeMs || 0;
  this.ctimeMs = ctimeMs || 0; this.birthtimeMs = birthtimeMs || 0;
  this.atime = new Date(this.atimeMs); this.mtime = new Date(this.mtimeMs);
  this.ctime = new Date(this.ctimeMs); this.birthtime = new Date(this.birthtimeMs);
}
Stats.prototype.isFile = function() { return (this.mode & 0o170000) === 0o100000; };
Stats.prototype.isDirectory = function() { return (this.mode & 0o170000) === 0o040000; };
Stats.prototype.isSymbolicLink = function() { return (this.mode & 0o170000) === 0o120000; };
Stats.prototype.isBlockDevice = function() { return (this.mode & 0o170000) === 0o060000; };
Stats.prototype.isCharacterDevice = function() { return (this.mode & 0o170000) === 0o020000; };
Stats.prototype.isFIFO = function() { return (this.mode & 0o170000) === 0o010000; };
Stats.prototype.isSocket = function() { return (this.mode & 0o170000) === 0o140000; };

function _wrapStats(s, bigint) {
  if (bigint) return _wrapStatsBigInt(s);
  const st = new Stats(
    s.dev, s.mode, s.nlink, s.uid, s.gid, 0, s.blksize,
    s.ino, s.size, s.blocks, s.atimeMs, s.mtimeMs, s.ctimeMs, s.birthtimeMs
  );
  // Preserve binding-level type flags for modes not detected from mode bits
  if (s.isFile && !st.isFile()) st.isFile = () => true;
  if (s.isDirectory && !st.isDirectory()) st.isDirectory = () => true;
  if (s.isSymbolicLink && !st.isSymbolicLink()) st.isSymbolicLink = () => true;
  return st;
}

// BigIntStats: every numeric field is a BigInt, plus *Ns nanosecond fields.
// is* methods must use a Number copy of mode — BigInt & Number throws.
function _wrapStatsBigInt(s) {
  const bi = (v) => BigInt(Math.floor(Number(v) || 0));
  const st = Object.create(Stats.prototype);
  st.dev = bi(s.dev); st.mode = bi(s.mode); st.nlink = bi(s.nlink);
  st.uid = bi(s.uid); st.gid = bi(s.gid); st.rdev = bi(0);
  st.blksize = bi(s.blksize || 4096); st.ino = bi(s.ino); st.size = bi(s.size); st.blocks = bi(s.blocks);
  st.atimeMs = bi(s.atimeMs); st.mtimeMs = bi(s.mtimeMs); st.ctimeMs = bi(s.ctimeMs); st.birthtimeMs = bi(s.birthtimeMs);
  st.atimeNs = st.atimeMs * 1000000n; st.mtimeNs = st.mtimeMs * 1000000n;
  st.ctimeNs = st.ctimeMs * 1000000n; st.birthtimeNs = st.birthtimeMs * 1000000n;
  st.atime = new Date(Number(s.atimeMs) || 0); st.mtime = new Date(Number(s.mtimeMs) || 0);
  st.ctime = new Date(Number(s.ctimeMs) || 0); st.birthtime = new Date(Number(s.birthtimeMs) || 0);
  const m = Number(s.mode) || 0;
  st.isFile = () => s.isFile ? true : (m & 0o170000) === 0o100000;
  st.isDirectory = () => s.isDirectory ? true : (m & 0o170000) === 0o040000;
  st.isSymbolicLink = () => s.isSymbolicLink ? true : (m & 0o170000) === 0o120000;
  st.isBlockDevice = () => (m & 0o170000) === 0o060000;
  st.isCharacterDevice = () => (m & 0o170000) === 0o020000;
  st.isFIFO = () => (m & 0o170000) === 0o010000;
  st.isSocket = () => (m & 0o170000) === 0o140000;
  return st;
}

function statSync(path, options) {
  _validatePath(path, 'path');
  const p = _toPath(path);
  if (p.length > 1024) throw _fsError('ENAMETOOLONG', 'stat', p, 'name too long');
  const s = b.stat(p);
  if (s === -1) {
    if (options && options.throwIfNoEntry === false) return undefined;
    throw _fsError('ENOENT', 'stat', p, 'no such file or directory');
  }
  return _wrapStats(s, options && options.bigint);
}

let _existsSyncDepWarn = true;
function existsSync(path) {
  if (typeof path !== 'string' && !Buffer.isBuffer(path) && !(path instanceof URL)) {
    if (_existsSyncDepWarn) {
      process.emitWarning('Passing invalid argument types to fs.existsSync is deprecated', 'DeprecationWarning', 'DEP0187');
      _existsSyncDepWarn = false;
    }
    return false;
  }
  if (typeof path === 'string' && path.indexOf('\0') !== -1) return false;
  try { return !!b.exists(_toPath(path)); } catch { return false; }
}

function mkdirSync(path, opts) {
  _validatePath(path, 'path');
  if (opts && typeof opts === 'object' && opts.recursive !== undefined && typeof opts.recursive !== 'boolean') {
    throw _ERR_INVALID_ARG_TYPE('options.recursive', 'boolean', opts.recursive);
  }
  const sp = _toPath(path);
  let mode;
  if (typeof opts === 'number') mode = opts;
  else if (typeof opts === 'string') mode = parseInt(opts, 8);
  else mode = (opts && opts.mode != null) ? opts.mode : 0o777;
  if (typeof mode === 'string') mode = parseInt(mode, 8);
  mode = mode & 0o7777;
  if (opts && opts.recursive) {
    const parts = sp.split('/');
    let cur = parts[0] === '' ? '/' : '';
    let firstCreated;
    for (const p of parts) {
      if (!p) { if (!cur) cur = '/'; continue; }
      cur = cur ? cur + '/' + p : p;
      const r = b.mkdir(cur, mode);
      if (r === 0) {
        if (!firstCreated) firstCreated = cur;
      } else {
        // mkdir failed — check why
        try {
          const st = statSync(cur);
          if (!st.isDirectory()) {
            // Exists but not a directory
            throw _fsError('ENOTDIR', 'mkdir', cur, 'not a directory');
          }
        } catch(e) {
          if (e.code === 'ENOTDIR') throw e;
          throw _fsError('EACCES', 'mkdir', cur, 'permission denied');
        }
      }
    }
    // Check final path — if it exists but isn't a directory, error
    try {
      const st = statSync(sp);
      if (!st.isDirectory()) throw _fsError('EEXIST', 'mkdir', sp, 'file already exists');
    } catch(e) {
      if (e.code) throw e;
    }
    return firstCreated || undefined;
  }
  const r = b.mkdir(sp, mode);
  if (r !== 0) {
    if (existsSync(sp)) throw _fsError('EEXIST', 'mkdir', sp, 'file already exists');
    // Check if parent isn't a dir
    const parent = sp.substring(0, sp.lastIndexOf('/'));
    if (parent && existsSync(parent)) {
      try { const st = statSync(parent); if (!st.isDirectory()) throw _fsError('ENOTDIR', 'mkdir', sp, 'not a directory'); } catch(e) { if (e.code) throw e; }
    }
    throw _fsError('ENOENT', 'mkdir', sp, 'no such file or directory');
  }
}

function unlinkSync(path) {
  _validatePath(path, 'path');
  const sp = _toPath(path);
  const r = b.unlink(sp);
  if (r !== 0 && r !== undefined) throw _fsError('EACCES', 'unlink', sp, 'permission denied');
}
function rmdirSync(path) { _validatePath(path, 'path'); b.rmdir(_toPath(path)); }
function renameSync(old, n) { _validatePath(old, 'oldPath'); _validatePath(n, 'newPath'); b.rename(_toPath(old), _toPath(n)); }
function readdirSync(path, opts) {
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(path, 'path');
  const sp = _toPath(path);
  const result = b.readdir(sp);
  if (!result || !Array.isArray(result)) {
    const s = b.stat(sp);
    if (s && s !== -1 && !s.isDirectory) {
      throw _fsError('ENOTDIR', 'scandir', sp, 'not a directory');
    }
    throw _fsError('ENOENT', 'scandir', sp, 'no such file or directory');
  }
  const entries = result.sort();
  const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
  const asBuffer = encoding === 'buffer';
  if (opts && opts.withFileTypes) {
    return entries.map(name => new Dirent(asBuffer ? Buffer.from(name) : name, sp));
  }
  if (asBuffer) return entries.map(name => Buffer.from(name));
  // non-utf8 encodings (hex/base64/latin1/...) re-encode each name from its utf8 bytes.
  if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
    return entries.map(name => Buffer.from(name, 'utf8').toString(encoding));
  }
  return entries;
}
function realpathSync(path, opts) {
  const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
  _assertEncoding(encoding);
  _validatePath(path, 'path');
  const resolved = b.realpath(_toPath(path));
  return _encodePathResult(resolved, encoding);
}
// Apply a path-result encoding: 'buffer' -> Buffer, other non-utf8 -> re-encoded string.
function _encodePathResult(str, encoding) {
  if (!encoding || encoding === 'utf8' || encoding === 'utf-8') return str;
  if (encoding === 'buffer') return Buffer.from(str, 'utf8');
  return Buffer.from(str, 'utf8').toString(encoding);
}
function chmodSync(path, mode) { _validatePath(path, 'path'); mode = _validateMode(mode, 'mode'); b.chmod(_toPath(path), mode); }
function lchmodSync(path, mode) { _validatePath(path, 'path'); mode = _validateMode(mode, 'mode'); b.lchmod ? b.lchmod(_toPath(path), mode) : b.chmod(_toPath(path), mode); }
function statfsSync(path, opts) {
  _validatePath(path, 'path');
  const r = b.statvfs(_toPath(path));
  if (r === -1) throw _fsError('EIO', 'statfs', _toPath(path));
  // r = [f_bsize, f_frsize, f_blocks, f_bfree, f_bavail, f_files, f_ffree]
  const bigint = !!(opts && opts.bigint);
  const v = bigint ? (x) => BigInt(Math.floor(Number(x) || 0)) : (x) => x;
  return { type: v(0), bsize: v(r[0]), frsize: v(r[1]), blocks: v(r[2]), bfree: v(r[3]), bavail: v(r[4]), files: v(r[5]), ffree: v(r[6]) };
}
function statfs(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path'); _validateCb(cb);
  _async(statfsSync, [path, opts], (err, res) => cb(err, res));
}
function lchmod(path, mode, cb) { _validatePath(path, 'path'); mode = _validateMode(mode, 'mode'); _validateCb(cb); _async(lchmodSync, [path, mode], (err) => cb(err)); }
function _validateSymlinkType(type) {
  if (type != null && type !== 'dir' && type !== 'file' && type !== 'junction')
    throw _ERR_INVALID_ARG_VALUE('type', type);
}
function symlinkSync(target, path, type) { _validatePath(target, 'target'); _validatePath(path, 'path'); _validateSymlinkType(type); b.symlink(_toPath(target), _toPath(path)); }
function lstatSync(path, options) {
  _validatePath(path, 'path');
  const sp = _toPath(path);
  if (sp.length > 1024) throw _fsError('ENAMETOOLONG', 'lstat', sp, 'name too long');
  const result = b.lstat(sp);
  if (typeof result === 'number') {
    if (options && options.throwIfNoEntry === false) return undefined;
    throw _fsError('ENOENT', 'lstat', sp, 'no such file or directory');
  }
  return _wrapStats(result, options && options.bigint);
}
function readlinkSync(path, opts) {
  const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
  _assertEncoding(encoding);
  _validatePath(path, 'path');
  const sp = _toPath(path);
  const target = b.readlink ? b.readlink(sp) : sp;
  return _encodePathResult(target, encoding);
}
// POSIX open flags
const O_RDONLY = 0, O_WRONLY = 1, O_RDWR = 2, O_CREAT = 0x200, O_TRUNC = 0x400, O_APPEND = 0x8, O_EXCL = 0x800, O_SYNC = 0x80;
const FLAG_MAP = {
  'r': O_RDONLY, 'r+': O_RDWR,
  'rs+': O_RDWR | O_SYNC, 'sr+': O_RDWR | O_SYNC,
  'w': O_WRONLY | O_CREAT | O_TRUNC, 'w+': O_RDWR | O_CREAT | O_TRUNC,
  'a': O_WRONLY | O_CREAT | O_APPEND, 'a+': O_RDWR | O_CREAT | O_APPEND,
  'wx': O_WRONLY | O_CREAT | O_TRUNC | O_EXCL, 'xw': O_WRONLY | O_CREAT | O_TRUNC | O_EXCL,
  'wx+': O_RDWR | O_CREAT | O_TRUNC | O_EXCL, 'xw+': O_RDWR | O_CREAT | O_TRUNC | O_EXCL,
  'ax': O_WRONLY | O_CREAT | O_APPEND | O_EXCL, 'xa': O_WRONLY | O_CREAT | O_APPEND | O_EXCL,
  'as': O_WRONLY | O_CREAT | O_APPEND | O_SYNC, 'sa': O_WRONLY | O_CREAT | O_APPEND | O_SYNC,
  'ax+': O_RDWR | O_CREAT | O_APPEND | O_EXCL, 'xa+': O_RDWR | O_CREAT | O_APPEND | O_EXCL,
  'as+': O_RDWR | O_CREAT | O_APPEND | O_SYNC, 'sa+': O_RDWR | O_CREAT | O_APPEND | O_SYNC,
};

function stringToFlags(flags) {
  if (typeof flags === 'number') return flags;
  if (typeof flags !== 'string') {
    const e = new TypeError(`The "flags" argument must be of type number. Received type ${typeof flags} (${String(flags)})`);
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
  const f = FLAG_MAP[flags];
  if (f !== undefined) return f;
  const e = new TypeError(`The argument 'flags' is invalid. Received '${flags}'`);
  e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
}

function openSync(path, flags, mode) {
  _validatePath(path, 'path');
  // mode accepts a uint32 or octal string (e.g. '10644'); _validateMode parses it.
  // Mask to permission bits before the syscall — native b.open mishandles modes
  // above 0o7777 (the high mask bits like 0o10000 must be ignored, not honored).
  mode = mode == null ? 0o666 : (_validateMode(mode, 'mode') & 0o7777);
  const sp = _toPath(path);
  const f = typeof flags === 'string' ? (FLAG_MAP[flags] ?? 0) : (flags || 0);
  const fd = b.open(sp, f, mode);
  if (fd < 0) {
    if ((f & O_EXCL) && b.exists(sp)) throw _fsError('EEXIST', 'open', sp, 'file already exists');
    throw _fsError('ENOENT', 'open', sp, 'no such file or directory');
  }
  return fd;
}

function closeSync(fd) { _validateFd(fd); b.close(fd); }

function fstatSync(fd, options) {
  _validateFd(fd);
  const result = b.fstat(fd);
  if (typeof result === 'number') throw _fsError('EBADF', 'fstat', null, 'bad file descriptor');
  return _wrapStats(result, options && options.bigint);
}

function _bufferArgError(buffer) {
  let recv;
  if (buffer === null) recv = 'null';
  else if (typeof buffer === 'object') recv = 'an instance of ' + (buffer.constructor && buffer.constructor.name ? buffer.constructor.name : 'Object');
  else recv = 'type ' + typeof buffer + ' (' + buffer + ')';
  const e = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + recv);
  e.code = 'ERR_INVALID_ARG_TYPE'; return e;
}

function _readEmptyBufErr(buffer) {
  const e = new TypeError(`The argument 'buffer' is empty and cannot be written. Received ${require('util').inspect(buffer)}`);
  e.code = 'ERR_INVALID_ARG_VALUE'; return e;
}
function readSync(fd, buffer, offset, length, position) {
  _validateFd(fd);
  if (!Buffer.isBuffer(buffer) && !ArrayBuffer.isView(buffer)) {
    throw _bufferArgError(buffer);
  }
  // Reading >0 bytes into an empty buffer is the error; a 0-length read into an
  // empty buffer is a valid no-op (FileHandle.read(emptyBuf) returns bytesRead:0).
  // Length resolves below, so defer to _readEmptyBufErr after it's known.
  if (arguments.length <= 3) {
    // options form: readSync(fd, buffer[, options]). 3rd arg is always options,
    // and must be a plain-ish object — String objects count (read .length), but
    // primitives, arrays and functions are rejected. See test-fs-readSync-optional-params.
    const options = offset;
    if (options != null && (typeof options !== 'object' || Array.isArray(options))) {
      throw _ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    ({ offset = 0, length = buffer.byteLength - offset, position = null } = options || {});
  }
  if (offset == null) offset = 0;
  if (!Number.isInteger(offset)) { const e = new RangeError('The value of "offset" is out of range. It must be an integer. Received ' + offset); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (offset < 0) { const e = new RangeError('The value of "offset" is out of range. It must be >= 0. Received ' + offset); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  length = length != null ? length : buffer.length - offset;
  if (!Number.isInteger(length)) { const e = new RangeError('The value of "length" is out of range. It must be an integer. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (length < 0) { const e = new RangeError('The value of "length" is out of range. It must be >= 0. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  // reading >0 bytes into an empty buffer errors; a 0-length read is a valid no-op.
  if (buffer.byteLength === 0 && length > 0) throw _readEmptyBufErr(buffer);
  if (length > buffer.length - offset) { const e = new RangeError('The value of "length" is out of range. It must be <= ' + (buffer.length - offset) + '. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (position != null) {
    if (typeof position === 'bigint') {
      if (position < 0n || position >= 2n ** 63n) { const e = new RangeError('The value of "position" is out of range. It must be >= 0n && < 2n ** 63n. Received ' + position + 'n'); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    } else if (typeof position !== 'number') {
      throw _ERR_INVALID_ARG_TYPE('position', 'integer or null', position);
    } else if (!Number.isInteger(position)) {
      const e = new RangeError('The value of "position" is out of range. It must be an integer. Received ' + position); e.code = 'ERR_OUT_OF_RANGE'; throw e;
    } else if (position >= 2 ** 53) {
      const e = new RangeError('The value of "position" is out of range. It must be >= 0 && < 2 ** 53. Received ' + position); e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    b.fdSeek(fd, Number(position), 0);
  }
  const result = b.fdRead(fd, length);
  if (typeof result === 'number') return 0;
  const bytes = new Uint8Array(result.buffer || result);
  for (let i = 0; i < bytes.length; i++) buffer[offset + i] = bytes[i];
  return bytes.length;
}

function writeSync(fd, data, offset, length, position) {
  const wasString = typeof data === 'string';
  if (wasString) { data = Buffer.from(data); }
  else if (!Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) {
    throw _ERR_INVALID_ARG_TYPE('buffer', ['string', 'Buffer', 'TypedArray', 'DataView'], data);
  }
  if (wasString) {
    // string form: writeSync(fd, str, position, encoding) — offset/length not used as bounds
    offset = offset || 0;
    length = length != null ? length : data.length - offset;
  } else {
    const bl = data.byteLength;
    if (offset == null) offset = 0;
    else {
      if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
      if (!Number.isInteger(offset)) throw _ERR_OUT_OF_RANGE('offset', 'an integer', offset);
      if (offset < 0 || offset > bl) throw _ERR_OUT_OF_RANGE('offset', `>= 0 && <= ${bl}`, offset);
    }
    if (length == null) length = bl - offset;
    else {
      if (typeof length !== 'number') throw _ERR_INVALID_ARG_TYPE('length', 'number', length);
      if (!Number.isInteger(length)) throw _ERR_OUT_OF_RANGE('length', 'an integer', length);
      if (length < 0 || length > bl - offset) throw _ERR_OUT_OF_RANGE('length', `>= 0 && <= ${bl - offset}`, length);
    }
  }
  if (length === 0) return 0;
  if (position != null) b.fdSeek(fd, position, 0);
  // DataView has no subarray/slice; build a byte view over its backing buffer.
  const slice = (typeof data.subarray === 'function')
    ? data.subarray(offset, offset + length)
    : new Uint8Array(data.buffer, data.byteOffset + offset, length);
  return _fdWriteChecked(fd, slice, slice.length, 'write');
}

function writevSync(fd, buffers, position) {
  _validateFd(fd);
  if (!Array.isArray(buffers)) throw _ERR_INVALID_ARG_TYPE('buffers', 'ArrayBufferView[]', buffers);
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    if (!ArrayBuffer.isView(buf)) {
      throw _ERR_INVALID_ARG_TYPE('buffers[' + i + ']', 'Buffer or TypedArray', buf);
    }
  }
  if (position != null && position !== -1) b.fdSeek(fd, position, 0);
  let total = 0;
  for (const buf of buffers) {
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    if (data.length === 0) continue;
    total += _fdWriteChecked(fd, data, data.length, 'writev');
  }
  return total;
}

function writev(fd, buffers, position, cb) {
  if (typeof position === 'function') { cb = position; position = null; }
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE('cb', 'function', cb);
  _validateFd(fd);
  if (!Array.isArray(buffers)) throw _ERR_INVALID_ARG_TYPE('buffers', 'ArrayBufferView[]', buffers);
  for (let i = 0; i < buffers.length; i++) {
    if (!ArrayBuffer.isView(buffers[i])) throw _ERR_INVALID_ARG_TYPE('buffers[' + i + ']', 'Buffer or TypedArray', buffers[i]);
  }
  try {
    if (position != null && position !== -1) b.fdSeek(fd, position, 0);
    let total = 0;
    for (const buf of buffers) {
      const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
      if (data.length === 0) continue;
      total += _fdWriteChecked(fd, data, data.length, 'writev');
    }
    process.nextTick(cb, null, total, buffers);
  } catch (e) {
    process.nextTick(cb, e);
  }
}

function readv(fd, buffers, position, cb) {
  if (typeof position === 'function') { cb = position; position = null; }
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE('cb', 'function', cb);
  _validateFd(fd);
  if (!Array.isArray(buffers)) throw _ERR_INVALID_ARG_TYPE('buffers', 'ArrayBufferView[]', buffers);
  for (let i = 0; i < buffers.length; i++) {
    if (!ArrayBuffer.isView(buffers[i])) throw _ERR_INVALID_ARG_TYPE('buffers[' + i + ']', 'Buffer or TypedArray', buffers[i]);
  }
  try {
    if (position != null && position !== -1) b.fdSeek(fd, position, 0);
    let total = 0;
    for (const buf of buffers) {
      const result = b.fdRead(fd, buf.byteLength);
      if (typeof result === 'number' || !result) break;
      const bytes = new Uint8Array(result.buffer || result);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i];
      total += bytes.length;
      if (bytes.length < buf.byteLength) break;
    }
    process.nextTick(cb, null, total, buffers);
  } catch (e) {
    process.nextTick(cb, e);
  }
}

function readvSync(fd, buffers, position) {
  _validateFd(fd);
  if (!Array.isArray(buffers)) throw _ERR_INVALID_ARG_TYPE('buffers', 'ArrayBufferView[]', buffers);
  for (let i = 0; i < buffers.length; i++) {
    if (!ArrayBuffer.isView(buffers[i])) throw _ERR_INVALID_ARG_TYPE('buffers[' + i + ']', 'Buffer or TypedArray', buffers[i]);
  }
  if (position != null && position !== -1) b.fdSeek(fd, position, 0);
  let total = 0;
  for (const buf of buffers) {
    const result = b.fdRead(fd, buf.byteLength);
    if (typeof result === 'number' || !result) break;
    const bytes = new Uint8Array(result.buffer || result);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i];
    total += bytes.length;
    if (bytes.length < buf.byteLength) break;
  }
  return total;
}

function rmSync(path, opts) {
  _validatePath(path, 'path');
  const p = _toPath(path);
  let s;
  try {
    s = lstatSync(p);
  } catch (e) {
    // lstat failed — could be ENOENT or EACCES (binding doesn't distinguish errno)
    if (opts && opts.force) {
      // only suppress genuine ENOENT; check parent readdir to distinguish
      const lastSlash = p.lastIndexOf('/');
      if (lastSlash > 0) {
        const parentDir = p.substring(0, lastSlash);
        const childName = p.substring(lastSlash + 1);
        try {
          const entries = readdirSync(parentDir);
          if (entries.includes(childName)) {
            // file is listed but lstat failed — permission issue, not ENOENT
            e.code = 'EACCES'; e.syscall = 'lstat';
            throw e;
          }
        } catch (pe) {
          if (pe === e) throw e;
          // can't read parent — genuinely gone
        }
      }
      return;
    }
    e.syscall = 'lstat';
    throw e;
  }
  if (s.isDirectory()) {
    if (opts && opts.recursive) {
      const entries = readdirSync(p);
      for (const entry of entries) rmSync(p + '/' + entry, opts);
      rmdirSync(p);
    } else {
      // removing a directory without recursive is an error
      const e = new Error(`Path is a directory: rm returned EISDIR (is a directory) '${p}'`);
      e.code = 'ERR_FS_EISDIR';
      e.syscall = 'rm';
      e.path = p;
      throw e;
    }
  } else {
    unlinkSync(p);
  }
}

// Templates ending in X aren't portable (the X isn't substituted like mkdtemp(3)).
// Node warns once. emitWarning dedups by message, matching common.expectWarning.
let _mkdtempXWarned = false;
function _warnMkdtempX(prefix) {
  if (!_mkdtempXWarned && typeof prefix === 'string' && prefix.endsWith('X')) {
    _mkdtempXWarned = true;
    process.emitWarning('mkdtemp() templates ending with X are not portable. For details see: https://nodejs.org/api/fs.html');
  }
}
function mkdtempSync(prefix, opts) {
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  // prefix accepts a Uint8Array (e.g. TextEncoder output), not just string/Buffer/URL.
  if (ArrayBuffer.isView(prefix) && !Buffer.isBuffer(prefix)) prefix = Buffer.from(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  _validatePath(prefix, 'prefix');
  prefix = _toPath(prefix);
  _warnMkdtempX(prefix);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const dir = prefix + suffix;
  mkdirSync(dir);
  return dir;
}

function mkdtemp(prefix, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  if (ArrayBuffer.isView(prefix) && !Buffer.isBuffer(prefix)) prefix = Buffer.from(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  _validatePath(prefix, 'prefix');
  _validateCb(cb);
  _async(mkdtempSync, [prefix, opts], cb);
}

// mode must be an integer in [F_OK..R_OK|W_OK|X_OK]; non-numbers (incl. objects
// with Symbol.toPrimitive — node checks typeof before coercion) throw arg-type.
function _validateAccessMode(mode) {
  if (mode === undefined) return;
  if (typeof mode !== 'number') throw _ERR_INVALID_ARG_TYPE('mode', 'number', mode);
  if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw _ERR_OUT_OF_RANGE('mode', '>= 0 && <= 7', mode);
}
// macOS errno → node error code (the subset access(2) can return)
const _ERRNO_CODES = { 1: 'EPERM', 2: 'ENOENT', 9: 'EBADF', 13: 'EACCES', 20: 'ENOTDIR', 27: 'EFBIG', 28: 'ENOSPC', 30: 'EROFS', 32: 'EPIPE', 62: 'ELOOP', 63: 'ENAMETOOLONG', 69: 'EDQUOT' };
const _ERRNO_MSG = { EPERM: 'operation not permitted', ENOENT: 'no such file or directory', EBADF: 'bad file descriptor', EACCES: 'permission denied', ENOTDIR: 'not a directory', EFBIG: 'file too large', ENOSPC: 'no space left on device', EROFS: 'read-only file system', EPIPE: 'broken pipe', ELOOP: 'too many symbolic links', ENAMETOOLONG: 'name too long', EDQUOT: 'disk quota exceeded' };
// b.fdWrite returns bytes written, or a negative errno on failure. Loop over short
// writes (the kernel may accept fewer bytes, e.g. under RLIMIT_FSIZE the next write
// then fails EFBIG) and throw the mapped fs error. Returns total bytes written.
function _fdWriteChecked(fd, buf, len, syscall) {
  let written = 0;
  while (written < len) {
    const chunk = written === 0 ? buf : buf.subarray(written);
    const n = b.fdWrite(fd, chunk, len - written);
    if (n < 0) {
      const code = _ERRNO_CODES[-n] || 'EIO';
      throw _fsError(code, syscall || 'write', null, _ERRNO_MSG[code] || 'i/o error');
    }
    if (n === 0) break; // no progress and no error — avoid infinite loop
    written += n;
  }
  return written;
}
// errno (positive, from a native binding) -> fs Error, or null on success.
function _errnoErr(errno, syscall, path) {
  if (!errno || errno === 0) return null;
  const code = _ERRNO_CODES[errno] || 'EACCES';
  return _fsError(code, syscall, path, _ERRNO_MSG[code] || 'permission denied');
}
function accessSync(path, mode) {
  _validatePath(path, 'path');
  _validateAccessMode(mode);
  const sp = _toPath(path);
  const errno = b.access(sp, mode === undefined ? 0 : mode);
  if (errno !== 0) {
    const code = _ERRNO_CODES[errno] || 'EACCES';
    throw _fsError(code, 'access', sp, _ERRNO_MSG[code] || 'permission denied');
  }
}

// copyfile mode flags: EXCL(1)|FICLONE(2)|FICLONE_FORCE(4) — max 7. Validated
// synchronously by both sync and async forms (Node throws before any async work).
function _validateCopyMode(mode) {
  if (mode != null && typeof mode !== 'number') throw _ERR_INVALID_ARG_TYPE('mode', 'integer', mode);
  if (mode != null && (!Number.isInteger(mode) || mode < 0 || mode > 7)) throw _ERR_OUT_OF_RANGE('mode', '>= 0 && <= 7', mode);
}
function copyFileSync(src, dest, mode) {
  _validatePath(src, 'src');
  _validatePath(dest, 'dest');
  _validateCopyMode(mode);
  const COPYFILE_EXCL = 1;
  if ((mode & COPYFILE_EXCL) && existsSync(dest)) {
    throw _fsError('EEXIST', 'copyfile', _toPath(src), 'file already exists', _toPath(dest));
  }
  const data = readFileSync(src);
  writeFileSync(dest, data);
}

function _validateStreamFdPath(path, options) {
  if (options.fd == null) { _validatePath(path, 'path'); }
  else if (typeof options.fd !== 'number' && !(options.fd && typeof options.fd === 'object' && typeof options.fd.fd === 'number')) {
    throw _ERR_INVALID_ARG_TYPE('options.fd', ['number', 'FileHandle'], options.fd);
  }
}
function _validateStreamStartEnd(start, end) {
  // start/end must be numbers; NaN or negative -> RangeError. end may be Infinity
  // (its default), so don't require an integer there. See read-stream-throw-type-error.
  if (start !== undefined && typeof start !== 'number') throw _ERR_INVALID_ARG_TYPE('start', 'number', start);
  if (end !== undefined && typeof end !== 'number') throw _ERR_INVALID_ARG_TYPE('end', 'number', end);
  if (start !== undefined && (!Number.isInteger(start) || start < 0 || start > Number.MAX_SAFE_INTEGER)) throw _ERR_OUT_OF_RANGE('start', '>= 0 && <= 2 ** 53 - 1', start);
  // end may be Infinity (its default); only reject NaN, negative, fractional, or unsafe-finite.
  if (end !== undefined && end !== Infinity && (!Number.isInteger(end) || end < 0 || end > Number.MAX_SAFE_INTEGER)) throw _ERR_OUT_OF_RANGE('end', '>= 0 && <= 2 ** 53 - 1', end);
  if (start !== undefined && end !== undefined && start > end) throw _ERR_OUT_OF_RANGE('start', `<= "end" (here: ${end})`, start);
}
function _normalizeStreamOpts(opts) {
  if (opts !== undefined && opts !== null && typeof opts !== 'string' && typeof opts !== 'object') {
    const e = new TypeError(`The "options" argument must be of type string or an instance of Object. Received type ${typeof opts}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (typeof opts === 'string') opts = { encoding: opts };
  return opts || {};
}
function _streamFd(v) { return (v != null && typeof v === 'object' && v.fd != null) ? v.fd : v; }

let _ReadStream, _WriteStream;
function _initStreamClasses() {
  if (_ReadStream) return;
  const { Readable, Writable } = require('stream');

  // fs streams open asynchronously (via the injectable opts.fs, default to the
  // public fs fns so they're patchable) and emit 'open'/'ready'; _read/_write
  // queue behind 'open' since milo's stream base has no _construct hook.
  class ReadStream extends Readable {
    constructor(path, options) {
      options = _normalizeStreamOpts(options);
      _assertEncoding(options.encoding);
      // autoClose:false also disables auto-destroy — after 'end' the stream stays
      // open (not closed, not destroyed) so the fd can be reused. See read-stream.js.
      const autoClose = options.autoClose !== undefined ? options.autoClose : true;
      super({ highWaterMark: options.highWaterMark || 65536, encoding: options.encoding, autoDestroy: autoClose });
      this.fs = options.fs || module.exports;
      this.path = path == null ? undefined : path;
      this.flags = options.flags || 'r';
      this.mode = options.mode != null ? options.mode : 0o666;
      _validateStreamFdPath(path, options);
      _validateStreamStartEnd(options.start, options.end);
      this.start = options.start;
      this.end = options.end == null ? Infinity : options.end;
      this.pos = this.start != null ? this.start : undefined;
      this.bytesRead = 0;
      this.closed = false;
      this.autoClose = autoClose;
      this._ownFd = options.fd == null;
      this.fd = options.fd != null ? _streamFd(options.fd) : null;
      if (globalThis.__ref) globalThis.__ref();
      this.once('close', () => { this.closed = true; });
      this._opening = this.fd == null;
      if (this.fd != null) process.nextTick(() => { this.emit('open', this.fd); this.emit('ready'); });
      else this.fs.open(this.path, this.flags, this.mode, (er, fd) => {
        this._opening = false;
        if (er) { if (this.autoClose) this.destroy(er); else this.emit('error', er); return; }
        this.fd = fd; this.emit('open', fd); this.emit('ready');
      });
    }
    _read(n) {
      if (this.fd == null) { this.once('open', () => this._read(n)); return; }
      // `end` is an inclusive absolute byte offset. Track how many bytes remain
      // by comparing against bytesRead — works even for non-seekable fds where
      // pos stays null (position-less reads). See read-stream.js {end:1}.
      let toRead = n;
      if (this.end !== Infinity) {
        // total bytes to deliver = end - start + 1 (inclusive); subtract what we
        // already read. start defaults to 0 when unset.
        const remaining = (this.end - (this.start || 0) + 1) - this.bytesRead;
        toRead = Math.min(n, remaining);
      }
      if (toRead <= 0) { this.push(null); return; }
      const buf = Buffer.alloc(toRead);
      this.fs.read(this.fd, buf, 0, toRead, this.pos == null ? null : this.pos, (er, bytesRead) => {
        if (er) { this.destroy(er); return; }
        if (bytesRead > 0) {
          this.bytesRead += bytesRead;
          if (this.pos != null) this.pos += bytesRead;
          this.push(bytesRead < toRead ? buf.subarray(0, bytesRead) : buf);
        } else { this.push(null); }
      });
    }
    _destroy(err, cb) {
      // destroy mid-open: wait for the fd, then close it (don't leak it).
      if (this.fd == null && this._opening) { this.once('open', () => this._closeFd(err, cb)); return; }
      this._closeFd(err, cb);
    }
    _closeFd(err, cb) {
      const fd = this.fd;
      this.fd = null;
      // Unref the loop the moment we initiate close, not inside the close cb:
      // a user may monkeypatch fs.close to a fn that drops the callback (see
      // test-fs-write-stream), which would otherwise leave _activeRefs pinned
      // and hang the process.
      if (!this._unrefed) { this._unrefed = true; if (globalThis.__unref) globalThis.__unref(); }
      if (fd != null && (this._ownFd || this.autoClose)) {
        this.fs.close(fd, (er) => { cb(er || err); });
      } else { cb(err); }
    }
    close(cb) { if (cb) { if (this.closed || this.destroyed) process.nextTick(cb); else this.once('close', cb); } this.destroy(); }
    get pending() { return this.fd == null; }
  }

  class WriteStream extends Writable {
    constructor(path, options) {
      options = _normalizeStreamOpts(options);
      _assertEncoding(options.encoding);
      // autoClose:false also disables auto-destroy — after 'finish' the stream stays
      // open (not closed) so the fd can be reused. See write-stream-autoclose-option.
      const autoClose = options.autoClose !== undefined ? options.autoClose : true;
      super({ highWaterMark: options.highWaterMark, autoDestroy: autoClose });
      this.fs = options.fs || module.exports;
      this.path = path == null ? undefined : path;
      this.flags = options.flags || 'w';
      this.mode = options.mode != null ? options.mode : 0o666;
      _validateStreamFdPath(path, options);
      _validateStreamStartEnd(options.start, undefined);
      this.start = options.start;
      this.pos = this.start;
      this.bytesWritten = 0;
      this.closed = false;
      this.autoClose = autoClose;
      this._ownFd = options.fd == null;
      this.fd = options.fd != null ? _streamFd(options.fd) : null;
      if (globalThis.__ref) globalThis.__ref();
      this.once('close', () => { this.closed = true; });
      this._opening = this.fd == null;
      if (this.fd != null) process.nextTick(() => { this.emit('open', this.fd); this.emit('ready'); });
      else this.fs.open(this.path, this.flags, this.mode, (er, fd) => {
        this._opening = false;
        if (er) { if (this.autoClose) this.destroy(er); else this.emit('error', er); return; }
        this.fd = fd; this.emit('open', fd); this.emit('ready');
      });
    }
    _write(chunk, enc, cb) {
      if (this.fd == null) { this.once('open', () => this._write(chunk, enc, cb)); return; }
      if (typeof chunk === 'string') chunk = Buffer.from(chunk, enc);
      this.fs.write(this.fd, chunk, 0, chunk.length, this.pos == null ? null : this.pos, (er, bytes) => {
        if (er) { cb(er); return; }
        this.bytesWritten += bytes;
        if (this.pos != null) this.pos += bytes;
        cb();
      });
    }
    _writev(chunks, cb) {
      if (this.fd == null) { this.once('open', () => this._writev(chunks, cb)); return; }
      const buffers = chunks.map((c) => typeof c.chunk === 'string' ? Buffer.from(c.chunk, c.encoding) : c.chunk);
      if (typeof this.fs.writev !== 'function') {
        // no injected writev — write each buffer sequentially via _write
        let i = 0;
        const next = (er) => {
          if (er) return cb(er);
          if (i >= buffers.length) return cb();
          this._write(buffers[i++], null, next);
        };
        next();
        return;
      }
      this.fs.writev(this.fd, buffers, this.pos == null ? null : this.pos, (er, bytes) => {
        if (er) { cb(er); return; }
        this.bytesWritten += bytes;
        if (this.pos != null) this.pos += bytes;
        cb();
      });
    }
    _destroy(err, cb) {
      // destroy mid-open: wait for the fd, then close it (don't leak it).
      if (this.fd == null && this._opening) { this.once('open', () => this._closeFd(err, cb)); return; }
      this._closeFd(err, cb);
    }
    _closeFd(err, cb) {
      const fd = this.fd;
      this.fd = null;
      if (!this._unrefed) { this._unrefed = true; if (globalThis.__unref) globalThis.__unref(); }
      if (fd != null && (this._ownFd || this.autoClose)) {
        this.fs.close(fd, (er) => { cb(er || err); });
      } else { cb(err); }
    }
    close(cb) { if (cb) { if (this.closed || this.destroyed) process.nextTick(cb); else this.once('close', cb); } this.destroy(); }
    get pending() { return this.fd == null; }
  }

  _ReadStream = ReadStream;
  _WriteStream = WriteStream;
  // expose the class prototypes on the public constructor functions so both
  // `new fs.ReadStream()` and legacy `fs.ReadStream()` (no new) yield real
  // instances, and `x instanceof fs.ReadStream` holds.
  ReadStreamCtor.prototype = ReadStream.prototype;
  WriteStreamCtor.prototype = WriteStream.prototype;
  // Node exposes autoClose as a prototype getter that throws ERR_INVALID_THIS when
  // accessed off the bare prototype (no instance). Instances set an own `autoClose`
  // field which shadows this getter, so normal access still works.
  for (const Cls of [ReadStream, WriteStream]) {
    Object.defineProperty(Cls.prototype, 'autoClose', {
      configurable: true,
      get() { const e = new TypeError('Value of "this" must be of type WriteStream'); e.code = 'ERR_INVALID_THIS'; throw e; },
      set(v) { Object.defineProperty(this, 'autoClose', { value: v, writable: true, enumerable: true, configurable: true }); },
    });
  }
}

function createReadStream(path, opts) { _initStreamClasses(); return new _ReadStream(path, opts); }
function createWriteStream(path, opts) { _initStreamClasses(); return new _WriteStream(path, opts); }
function ReadStreamCtor(path, opts) { _initStreamClasses(); return new _ReadStream(path, opts); }
function WriteStreamCtor(path, opts) { _initStreamClasses(); return new _WriteStream(path, opts); }

// Async callback wrappers — run sync on next tick to match Node.js API shape
function _validateCb(cb) {
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE('callback', 'function', cb);
}
function _async(syncFn, args, cb) {
  _validateCb(cb);
  process.nextTick(() => { try { const r = syncFn(...args); cb(null, r); } catch (e) { cb(e); } });
}

function _validateAbortSignal(signal) {
  if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean'))
    throw _ERR_INVALID_ARG_TYPE('options.signal', 'AbortSignal', signal);
}
function _abortErr(signal) {
  if (signal && signal.reason) return signal.reason;
  const e = new Error('The operation was aborted'); e.name = 'AbortError'; e.code = 'ABORT_ERR'; return e;
}
// Run a sync fs op under an AbortSignal. The read/write is deferred via
// setImmediate so an abort scheduled on a microtask/nextTick wins the race
// (matches Node, whose real async op hasn't completed yet at that point).
function _asyncSignal(signal, syncFn, args, cb) {
  let done = false;
  const onAbort = () => { if (done) return; done = true; cb(_abortErr(signal)); };
  signal.addEventListener('abort', onAbort, { once: true });
  setImmediate(() => {
    if (done) return;
    try { const r = syncFn(...args); if (done) return; done = true; signal.removeEventListener('abort', onAbort); cb(null, r); }
    catch (e) { if (done) return; done = true; signal.removeEventListener('abort', onAbort); cb(e); }
  });
}

function readFile(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  if (typeof path === 'number') {
    process.nextTick(() => {
      try {
        const chunks = [];
        const buf = Buffer.alloc(8192);
        let n;
        while ((n = readSync(path, buf, 0, 8192, null)) > 0) chunks.push(Buffer.from(buf.subarray(0, n)));
        const result = Buffer.concat(chunks);
        const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
        cb(null, encoding ? result.toString(encoding) : result);
      } catch (e) { cb(e); }
    });
    return;
  }
  _validatePath(path, 'path');
  const signal = (opts && typeof opts === 'object') ? opts.signal : undefined;
  _validateAbortSignal(signal);
  _validateCb(cb);
  if (signal) {
    if (signal.aborted) { process.nextTick(cb, _abortErr(signal)); return; }
    _asyncSignal(signal, readFileSync, [path, opts], cb); return;
  }
  _async(readFileSync, [path, opts], cb);
}

function writeFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  if (typeof path === 'number') {
    // fd mode
    _validateCb(cb);
    const sig = (opts && typeof opts === 'object') ? opts.signal : undefined;
    _validateAbortSignal(sig);
    if (sig && sig.aborted) { process.nextTick(cb, _abortErr(sig)); return; }
    const writeFd = () => { try { writeSync(path, typeof data === 'string' ? data : data.toString()); cb(null); } catch (e) { cb(e); } };
    if (sig) { _asyncSignal(sig, () => writeSync(path, typeof data === 'string' ? data : data.toString()), [], (err) => cb(err)); return; }
    process.nextTick(writeFd);
    return;
  }
  _validatePath(path, 'path');
  _validateCb(cb);
  const signal = (opts && typeof opts === 'object') ? opts.signal : undefined;
  _validateAbortSignal(signal);
  if (signal) {
    if (signal.aborted) { process.nextTick(cb, _abortErr(signal)); return; }
    _asyncSignal(signal, writeFileSync, [path, data, opts], (err) => cb(err)); return;
  }
  _async(writeFileSync, [path, data, opts], (err) => cb(err));
}

function stat(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _async(statSync, [path, opts], cb);
}

function lstat(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _async(lstatSync, [path], cb);
}

function mkdir(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _async(mkdirSync, [path, opts], cb);
}

function readdir(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(path, 'path');
  _async(readdirSync, [path, opts], cb);
}

function unlink(path, cb) { _validatePath(path, 'path'); _validateCb(cb); _async(unlinkSync, [path], (err) => cb(err)); }
function rmdir(path, cb) { _validatePath(path, 'path'); _validateCb(cb); _async(rmdirSync, [path], (err) => cb(err)); }
function rename(oldPath, newPath, cb) { _validatePath(oldPath, 'oldPath'); _validatePath(newPath, 'newPath'); _validateCb(cb); _async(renameSync, [oldPath, newPath], (err) => cb(err)); }
function chmod(path, mode, cb) { _validatePath(path, 'path'); _validateCb(cb); _async(chmodSync, [path, mode], (err) => cb(err)); }
function access(path, mode, cb) {
  if (typeof mode === 'function') { cb = mode; mode = undefined; }
  _validatePath(path, 'path');
  _validateAccessMode(mode);
  _validateCb(cb); _async(accessSync, [path, mode], (err) => cb(err));
}
function rm(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _validateCb(cb); _async(rmSync, [path, opts], (err) => cb(err));
}
function copyFile(src, dest, flags, cb) {
  if (typeof flags === 'function') { cb = flags; flags = 0; }
  _validatePath(src, 'src');
  _validatePath(dest, 'dest');
  _validateCopyMode(flags);
  _validateCb(cb); _async(copyFileSync, [src, dest, flags], (err) => cb(err));
}
function realpath(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(path, 'path');
  _async(realpathSync, [path, opts], cb);
}
realpath.native = realpath;
realpathSync.native = realpathSync;
function appendFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validateWriteData(data);
  if (typeof path !== 'number') _validatePath(path, 'path');
  _validateCb(cb); _async(appendFileSync, [path, data, opts], (err) => cb(err));
}
function exists(path, cb) {
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE('cb', 'function', cb);
  process.nextTick(() => { try { cb(existsSync(path)); } catch { cb(false); } });
}
exists[Symbol.for('nodejs.util.promisify.custom')] = function(path) {
  return new Promise((resolve) => exists(path, resolve));
};

function linkSync(existingPath, newPath) {
  _validatePath(existingPath, 'existingPath');
  _validatePath(newPath, 'newPath');
  const ep = _toPath(existingPath), np = _toPath(newPath);
  const r = b.link(ep, np);
  if (r !== 0) throw _fsError('ENOENT', 'link', ep, 'no such file or directory');
}
function link(existingPath, newPath, cb) { _validatePath(existingPath, 'existingPath'); _validatePath(newPath, 'newPath'); _async(linkSync, [existingPath, newPath], (err) => cb(err)); }

function fsyncSync(fd) { _validateFd(fd); b.fsync(fd); }
function fdatasyncSync(fd) { _validateFd(fd); b.fdatasync(fd); }
function _validateLen(len) {
  if (len !== undefined && typeof len !== 'number') {
    const recv = len === null ? 'null' : typeof len === 'object' ? 'an instance of ' + (len.constructor?.name || 'Object') : typeof len === 'string' ? "type string ('" + len + "')" : 'type ' + typeof len + ' (' + len + ')';
    const e = new TypeError('The "len" argument must be of type number. Received ' + recv);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (typeof len === 'number' && !Number.isInteger(len)) {
    const e = new RangeError('The value of "len" is out of range. It must be an integer. Received ' + len);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
}
function ftruncateSync(fd, len) { _validateFd(fd); _validateLen(len); b.ftruncate(fd, len > 0 ? len : 0); }
function fchmodSync(fd, mode) { _validateFd(fd); mode = _validateMode(mode, 'mode'); b.fchmod(fd, mode); }

function fsync(fd, cb) { _validateFd(fd); _validateCb(cb); _async(fsyncSync, [fd], (err) => cb(err)); }
function fdatasync(fd, cb) { _validateFd(fd); _validateCb(cb); _async(fdatasyncSync, [fd], (err) => cb(err)); }
function ftruncate(fd, len, cb) {
  if (typeof len === 'function') { cb = len; len = 0; }
  _validateFd(fd); _validateLen(len);
  _async(ftruncateSync, [fd, len], (err) => { if (cb) cb(err); });
}
function fchmod(fd, mode, cb) { _validateFd(fd); mode = _validateMode(mode, 'mode'); _validateCb(cb); _async(fchmodSync, [fd, mode], (err) => cb(err)); }

function open(path, flags, mode, cb) {
  if (typeof flags === 'function') { cb = flags; flags = 'r'; mode = 0o666; }
  else if (typeof mode === 'function') { cb = mode; mode = 0o666; }
  _validatePath(path, 'path');
  // openSync parses+masks mode (uint32 or octal string); validate here too so a
  // bad mode throws synchronously rather than via the callback.
  mode = mode == null ? 0o666 : _validateMode(mode, 'mode');
  _validateCb(cb);
  _async(openSync, [path, flags, mode], cb);
}

function close(fd, cb) {
  _validateFd(fd);
  if (cb !== undefined && typeof cb !== 'function') {
    throw _ERR_INVALID_ARG_TYPE('callback', 'function', cb);
  }
  if (typeof cb === 'function') {
    _async(closeSync, [fd], (err) => cb(err));
  } else {
    process.nextTick(() => { try { closeSync(fd); } catch {} });
  }
}

function read(fd, buffer, offset, length, position, cb) {
  _validateFd(fd);
  // read(fd, cb) — no buffer, allocate default
  if (typeof buffer === 'function') {
    cb = buffer;
    buffer = Buffer.alloc(16384);
    offset = 0;
    length = buffer.length;
    position = null;
  } else if (typeof offset === 'function') {
    cb = offset;
    // read(fd, options, cb)
    if (buffer != null && typeof buffer === 'object' && !Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
      const opts = buffer;
      if (opts.buffer !== undefined && opts.buffer !== null && !Buffer.isBuffer(opts.buffer) && !(opts.buffer instanceof Uint8Array) && !ArrayBuffer.isView(opts.buffer)) {
        const e = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received an instance of Object');
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      if (opts.buffer === null) {
        const e = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received an instance of Object');
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      buffer = opts.buffer || Buffer.alloc(16384);
      offset = opts.offset || 0;
      length = opts.length != null ? opts.length : buffer.length - offset;
      position = opts.position != null ? opts.position : null;
    } else {
      // read(fd, cb) with a null/undefined options arg → default buffer;
      // read(fd, buffer, cb) → keep the provided buffer.
      if (buffer == null) buffer = Buffer.alloc(16384);
      offset = 0;
      length = buffer.length;
      position = null;
    }
  } else if (typeof length === 'function') {
    cb = length;
    // read(fd, buffer, options, cb): the 3rd arg may be an options object, not a numeric offset.
    if (offset != null && typeof offset === 'object' && !Buffer.isBuffer(offset) && !ArrayBuffer.isView(offset)) {
      const opts = offset;
      offset = opts.offset == null ? 0 : opts.offset;
      length = opts.length == null ? (buffer ? buffer.length - offset : 0) : opts.length;
      position = opts.position == null ? null : opts.position;
    } else {
      length = buffer ? buffer.length - (offset || 0) : 0;
      position = null;
    }
  } else if (cb === undefined && typeof position === 'function') {
    cb = position;
    position = null;
  } else {
    // read(fd, buffer, options, cb) or read(fd, buffer, offset, length, position, cb)
    if (offset != null && typeof offset === 'object' && !Buffer.isBuffer(offset)) {
      cb = length;
      const opts = offset;
      offset = opts.offset || 0;
      length = opts.length != null ? opts.length : buffer.length - offset;
      position = opts.position != null ? opts.position : null;
    }
  }
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE('cb', 'function', cb);
  if (!Buffer.isBuffer(buffer) && !ArrayBuffer.isView(buffer)) {
    const e = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received type ' + typeof buffer + ' (' + buffer + ')');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (offset != null) {
    if (!Number.isInteger(offset)) { const e = new RangeError('The value of "offset" is out of range. It must be an integer. Received ' + (typeof offset === 'bigint' ? offset.toString() : offset)); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (offset < 0) { const e = new RangeError('The value of "offset" is out of range. It must be >= 0. Received ' + offset); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  }
  if (length != null) {
    if (!Number.isInteger(length)) { const e = new RangeError('The value of "length" is out of range. It must be an integer. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (length < 0) { const e = new RangeError('The value of "length" is out of range. It must be >= 0. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  }
  // reading >0 bytes into an empty buffer errors synchronously; 0-length is a no-op.
  if (buffer.byteLength === 0 && (length == null || length > 0)) throw _readEmptyBufErr(buffer);
  if (position != null) {
    if (typeof position === 'bigint') {
      if (position < 0n || position >= 2n ** 63n) { const e = new RangeError('The value of "position" is out of range. It must be >= 0n && < 2n ** 63n. Received ' + position + 'n'); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    } else if (typeof position !== 'number') {
      throw _ERR_INVALID_ARG_TYPE('position', 'integer or null', position);
    } else if (!Number.isInteger(position)) {
      const e = new RangeError('The value of "position" is out of range. It must be an integer. Received ' + position);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    } else if (position >= 2 ** 53) {
      const e = new RangeError('The value of "position" is out of range. It must be >= 0 && < 2 ** 53. Received ' + position);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
  }
  try {
    const n = readSync(fd, buffer, offset, length, position);
    process.nextTick(() => cb(null, n, buffer));
  } catch (e) { process.nextTick(() => cb(e)); }
}
// No promisify.custom here — the customArgs tag (set near module.exports) lets
// util.promisify resolve {bytesRead, buffer} while the callback read() above
// handles all the option/overload forms (a custom wrapper missed them).

function fstat(fd, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validateFd(fd);
  _async(fstatSync, [fd, opts], cb);
}

function readlink(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(path, 'path');
  _async(readlinkSync, [path, opts], cb);
}
function symlink(target, path, type, cb) {
  if (typeof type === 'function') { cb = type; type = undefined; }
  _validatePath(target, 'target');
  _validatePath(path, 'path');
  // type, when given, must be one of dir|file|junction (or null) — node throws otherwise.
  _validateSymlinkType(type);
  _validateCb(cb);
  _async(symlinkSync, [target, path], (err) => cb(err));
}
function write(fd, buffer, offset, length, position, cb) {
  _validateFd(fd);
  if (typeof buffer === 'string') {
    if (typeof offset === 'function') { cb = offset; offset = undefined; }
    else if (typeof length === 'function') { cb = length; length = undefined; }
    _validateCb(cb);
    const n = writeSync(fd, buffer, offset, length);
    process.nextTick(() => cb(null, n, buffer));
    return;
  }
  // non-string buffer must be a view (Buffer/TypedArray/DataView)
  if (!ArrayBuffer.isView(buffer)) {
    throw _ERR_INVALID_ARG_TYPE('buffer', ['string', 'Buffer', 'TypedArray', 'DataView'], buffer);
  }
  // write(fd, buffer, options, cb): 3rd arg may be an options object
  if (offset !== null && typeof offset === 'object') {
    cb = length; const o = offset; offset = o.offset; length = o.length; position = o.position;
  } else if (typeof offset === 'function') { cb = offset; offset = undefined; length = undefined; position = undefined; }
  else if (typeof length === 'function') { cb = length; length = undefined; position = undefined; }
  else if (typeof position === 'function') { cb = position; position = undefined; }
  _validateCb(cb);
  const bl = buffer.byteLength;
  if (offset == null) offset = 0;
  else {
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    if (!Number.isInteger(offset)) throw _ERR_OUT_OF_RANGE('offset', 'an integer', offset);
    if (offset < 0 || offset > bl) throw _ERR_OUT_OF_RANGE('offset', `>= 0 && <= ${bl}`, offset);
  }
  if (length == null) length = bl - offset;
  else {
    if (typeof length !== 'number') throw _ERR_INVALID_ARG_TYPE('length', 'number', length);
    if (!Number.isInteger(length)) throw _ERR_OUT_OF_RANGE('length', 'an integer', length);
    if (length < 0 || length > bl - offset) throw _ERR_OUT_OF_RANGE('length', `>= 0 && <= ${bl - offset}`, length);
  }
  if (position === undefined) position = null;
  try {
    const n = writeSync(fd, buffer, offset, length, position);
    process.nextTick(() => cb(null, n, buffer));
  } catch (e) { process.nextTick(() => cb(e)); }
}
// customArgs tag (near module.exports) handles util.promisify(fs.write).

// --- fs.watch / watchFile / unwatchFile via kqueue EVFILT_VNODE ---
const EventEmitter = require('events');
const tcp = internalBinding('tcp');
const net = require('net');
const path = require('path');

// NOTE_DELETE=1, NOTE_WRITE=2, NOTE_EXTEND=4, NOTE_ATTRIB=8, NOTE_RENAME=32
class FSWatcher extends EventEmitter {
  constructor(filename, options) {
    super();
    this._filename = path.resolve(filename);
    this._recursive = !!(options && options.recursive);
    this._encoding = typeof options === 'string' ? options : (options && options.encoding) || 'utf8';
    // {signal}: abort closes the watcher. Already-aborted closes on next tick.
    const signal = options && typeof options === 'object' ? options.signal : undefined;
    if (signal) {
      if (signal.aborted) process.nextTick(() => this.close());
      else signal.addEventListener('abort', () => this.close(), { once: true });
    }
    this._fds = new Map();
    net._ensurePoll();

    const fd = tcp.watchFile(this._filename);
    if (fd < 0) {
      this._fd = -1;
      process.nextTick(() => this.emit('error', new Error('watch ' + filename + ' failed')));
      return;
    }
    this._fd = fd;
    this._fds.set(fd, this._filename);
    net._fileWatchers.set(fd, this);

    // kqueue EVFILT_VNODE on a directory only signals "the dir changed", not which
    // entry. Snapshot the listing so a change event can diff to find the filename.
    this._isDir = false;
    try { this._isDir = statSync(this._filename).isDirectory(); } catch {}
    // snapshot every watched directory (top + recursive subdirs), keyed by path,
    // so a vnode event on any of them can diff to find the changed entry.
    this._dirSnapshots = new Map();
    if (this._isDir) this._dirSnapshots.set(this._filename, this._snapshotDir(this._filename));

    // macOS kqueue on a directory fd does NOT report in-place modifications of
    // files already inside it (only add/remove). To see content changes, also put
    // a vnode watch on each immediate child file. Maps the child fd back to its
    // name so _onEvent can report it. (Recursive mode additionally walks subdirs.)
    if (this._isDir) this._watchDirChildren(this._filename);

    if (this._recursive) {
      this._addSubdirs(this._filename);
    }
  }

  _watchDirChildren(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        if (statSync(full).isFile()) {
          const cfd = tcp.watchFile(full);
          if (cfd >= 0) { this._fds.set(cfd, full); net._fileWatchers.set(cfd, this); }
        }
      } catch {}
    }
  }

  _snapshotDir(dir) {
    try { return new Set(readdirSync(dir)); } catch { return new Set(); }
  }

  // Diff a directory's listing against its stored snapshot to find the changed
  // entry (added or removed). Returns the entry name, or null if nothing changed.
  _diffDir(dir) {
    const before = this._dirSnapshots.get(dir) || new Set();
    const after = this._snapshotDir(dir);
    let changed = null;
    for (const name of after) if (!before.has(name)) { changed = name; break; }
    if (changed === null) for (const name of before) if (!after.has(name)) { changed = name; break; }
    this._dirSnapshots.set(dir, after);
    return changed;
  }

  _addSubdirs(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          if (!this._fdForPath(full)) {
            const fd = tcp.watchFile(full);
            if (fd >= 0) {
              this._fds.set(fd, full);
              net._fileWatchers.set(fd, this);
              if (!this._dirSnapshots.has(full)) this._dirSnapshots.set(full, this._snapshotDir(full));
            }
          }
          this._addSubdirs(full);
        }
      } catch {}
    }
  }

  _fdForPath(p) { for (const [fd, fp] of this._fds) if (fp === p) return fd; return 0; }

  _onEvent(fflags, eventFd) {
    // Events already queued in a poll batch can arrive after the handler closed
    // the watcher (a single change handler often calls close()); drop them so
    // 'change' isn't re-emitted on a closed watcher. See test-fs-watch.
    if (this._closed) return;
    const isRename = !!(fflags & 32);
    const isWrite = !!(fflags & 2);
    const watchedPath = this._fds.get(eventFd) || this._filename;
    const isWatchedDir = this._dirSnapshots.has(watchedPath);
    let eventType, relPath;
    if (isWatchedDir) {
      // directory change: diff THIS dir's listing (works for the top dir and any
      // recursive subdir) to find the changed entry, reported relative to the root.
      const changed = this._diffDir(watchedPath);
      if (changed !== null) {
        eventType = 'rename';
        const abs = path.join(watchedPath, changed);
        relPath = watchedPath === this._filename ? changed : path.relative(this._filename, abs);
        // a newly-created subdir must itself be watched (recursive)
        if (this._recursive && !this._closed) this._addSubdirs(watchedPath);
      } else {
        // create+unlink netting to no listing change: filename unknown -> null (Node does this)
        eventType = 'rename'; relPath = null;
      }
    } else {
      // a watched child FILE changed in place (content); report its path from root.
      eventType = isRename ? 'rename' : 'change';
      relPath = watchedPath === this._filename
        ? path.basename(this._filename)
        : path.relative(this._filename, watchedPath);
    }
    this.emit('change', eventType, relPath === null ? null : _encodePathResult(relPath, this._encoding));
  }

  close() {
    if (this._closed) return; // closing a closed watcher is a noop
    this._closed = true;
    for (const [fd] of this._fds) {
      net._fileWatchers.delete(fd);
      tcp.unwatchFile(fd);
    }
    this._fds.clear();
    this._fd = -1;
    this.emit('close');
  }
  // ref/unref toggle whether this watcher keeps the event loop alive. The loop's
  // __hasIO counts only ref'd watchers (see _timers_init), so an unref'd watcher
  // still receives events but won't by itself prevent the process from exiting.
  ref() { this._unref = false; return this; }
  unref() { this._unref = true; return this; }
}

function watch(filename, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
  _assertEncoding(typeof options === 'string' ? options : (options && options.encoding));
  _validatePath(filename, 'filename');
  const watcher = new FSWatcher(String(filename), options);
  if (listener) watcher.on('change', listener);
  return watcher;
}

const _statWatchers = new Map();

// Returned by fs.watchFile — an EventEmitter polling stat() on an interval.
// Node exposes ref/unref (timer lifetime) and stop() (emits 'stop').
class StatWatcher extends EventEmitter {
  constructor() { super(); this._timer = null; this._stopped = false; }
  start(fname, interval, listener) {
    if (listener) this.on('change', listener);
    // A missing file is reported as an all-zero Stats (not an error), matching Node.
    const statOrZero = () => { try { return statSync(fname); } catch { return new Stats(0,0,0,0,0,0,0,0,0,0,0,0,0,0); } };
    let prev = statOrZero();
    let first = true;
    // setInterval clamps 0 to 1ms; that's fine for polling.
    this._timer = setInterval(() => {
      const curr = statOrZero();
      // Node fires an initial event once the watch is established (curr==prev),
      // then on every subsequent mtime/existence change (create/modify/delete).
      if (first) { first = false; this.emit('change', curr, prev); }
      else if (curr.mtimeMs !== prev.mtimeMs || curr.ino !== prev.ino || curr.size !== prev.size) {
        this.emit('change', curr, prev);
      }
      prev = curr;
    }, interval || 1);
    return this;
  }
  ref() { if (this._timer && this._timer.ref) this._timer.ref(); return this; }
  unref() { if (this._timer && this._timer.unref) this._timer.unref(); return this; }
  stop() {
    if (this._stopped) return;
    this._stopped = true;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    process.nextTick(() => this.emit('stop'));
  }
}

function watchFile(filename, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
  _validatePath(filename, 'filename');
  if (typeof listener !== 'function') throw _ERR_INVALID_ARG_TYPE('listener', 'function', listener);
  const interval = (options && options.interval) || 5007;
  const fname = String(filename);
  let watcher = _statWatchers.get(fname);
  if (!watcher) {
    watcher = new StatWatcher();
    _statWatchers.set(fname, watcher);
    watcher.start(fname, interval, listener);
  } else if (listener) {
    watcher.on('change', listener);
  }
  return watcher;
}

function unwatchFile(filename, listener) {
  _validatePath(filename, 'filename');
  const fname = String(filename);
  const watcher = _statWatchers.get(fname);
  if (!watcher) return;
  if (listener) watcher.removeListener('change', listener);
  // Node stops polling only when no listeners remain (or no listener arg given).
  if (!listener || watcher.listenerCount('change') === 0) {
    watcher.stop();
    _statWatchers.delete(fname);
  }
}

class Dirent {
  constructor(name, parentPath) {
    this.name = name;
    this.parentPath = parentPath;
    this.path = parentPath;
    this._stat = null;
  }
  _getStat() {
    if (!this._stat) {
      const p = require('path');
      try { this._stat = lstatSync(p.join(this.parentPath, this.name)); }
      catch { this._stat = { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false }; }
    }
    return this._stat;
  }
  isFile() { return this._getStat().isFile(); }
  isDirectory() { return this._getStat().isDirectory(); }
  isSymbolicLink() { return this._getStat().isSymbolicLink(); }
  isBlockDevice() { return this._getStat().isBlockDevice ? this._getStat().isBlockDevice() : false; }
  isCharacterDevice() { return this._getStat().isCharacterDevice ? this._getStat().isCharacterDevice() : false; }
  isFIFO() { return this._getStat().isFIFO ? this._getStat().isFIFO() : false; }
  isSocket() { return this._getStat().isSocket ? this._getStat().isSocket() : false; }
}

class Dir {
  constructor(path) {
    if (path === undefined) { const e = new TypeError('The "path" argument must be specified'); e.code = 'ERR_MISSING_ARGS'; throw e; }
    this.path = path;
  }
}

function _promisify(fn) { return (...args) => { try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); } }; }
// fs.promises.* accept a FileHandle where a path is expected; use its fd.
function _fdFromMaybeHandle(p) {
  return (p != null && typeof p === 'object' && typeof p.fd === 'number') ? p.fd : p;
}
// Run a sync fs op as a promise under an optional AbortSignal. The op is deferred
// via setImmediate so an abort scheduled on a microtask/nextTick (after the call
// returns but before the real I/O would finish) still wins the race, matching Node.
function _promiseSignal(sig, fn) {
  try { _validateAbortSignal(sig); } catch (e) { return Promise.reject(e); }
  if (sig && sig.aborted) return Promise.reject(_abortErr(sig));
  if (!sig) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }
  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = () => { if (done) return; done = true; reject(_abortErr(sig)); };
    sig.addEventListener('abort', onAbort, { once: true });
    setImmediate(() => {
      if (done) return;
      try { const r = fn(); if (done) return; done = true; sig.removeEventListener('abort', onAbort); resolve(r); }
      catch (e) { if (done) return; done = true; sig.removeEventListener('abort', onAbort); reject(e); }
    });
  });
}
const promises = {
  readFile: (path, opts) => {
    const sig = opts && typeof opts === 'object' ? opts.signal : undefined;
    return _promiseSignal(sig, () => readFileSync(path, opts));
  },
  writeFile: (path, data, opts) => {
    if (typeof opts === 'string') opts = { encoding: opts };
    const sig = opts && typeof opts === 'object' ? opts.signal : undefined;
    const enc = (opts && opts.encoding) || 'utf8';
    // data may be an async/sync iterable (e.g. Readable.from([...])); collect it
    // into one buffer first, then write. Node's promises.writeFile accepts these.
    if (data != null && typeof data !== 'string' && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data) &&
        (typeof data[Symbol.asyncIterator] === 'function' || typeof data[Symbol.iterator] === 'function')) {
      return (async () => {
        if (sig) _validateAbortSignal(sig);
        // yield once so a nextTick/microtask abort (scheduled right after this call)
        // is observed before we start consuming — matches Node, where draining the
        // source yields to the loop. Without this a synchronous iterable races past abort.
        if (sig) { await new Promise((r) => setImmediate(r)); if (sig.aborted) throw _abortErr(sig); }
        const chunks = [];
        for await (const chunk of data) {
          if (sig && sig.aborted) throw _abortErr(sig);
          // each chunk must be string or buffer-like; reject other types (ERR_INVALID_ARG_TYPE).
          if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !ArrayBuffer.isView(chunk)) {
            throw _ERR_INVALID_ARG_TYPE('data', 'string, Buffer, TypedArray, or DataView', chunk);
          }
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, enc) : Buffer.from(chunk.buffer || chunk, chunk.byteOffset, chunk.byteLength));
        }
        if (sig && sig.aborted) throw _abortErr(sig);
        writeFileSync(path, Buffer.concat(chunks), opts);
      })();
    }
    return _promiseSignal(sig, () => writeFileSync(path, data, opts));
  },
  stat: _promisify((path, opts) => statSync(path, opts)),
  lstat: _promisify((path, opts) => lstatSync(path, opts)),
  unlink: _promisify((path) => unlinkSync(path)),
  mkdir: _promisify((path, opts) => mkdirSync(path, opts)),
  rmdir: _promisify((path) => rmdirSync(path)),
  readdir: _promisify((path, opts) => readdirSync(path, opts)),
  access: _promisify((path, mode) => accessSync(path, mode)),
  rm: _promisify((path, opts) => rmSync(path, opts)),
  link: _promisify((existing, newPath) => linkSync(existing, newPath)),
  rename: _promisify((o, n) => renameSync(o, n)),
  chmod: _promisify((p, m) => chmodSync(p, m)),
  copyFile: _promisify((src, dst, mode) => copyFileSync(src, dst, mode)),
  mkdtemp: _promisify((prefix) => mkdtempSync(prefix)),
  readlink: _promisify((p, opts) => readlinkSync(p, opts)),
  realpath: _promisify((p, opts) => realpathSync(p, opts)),
  symlink: _promisify((target, p, type) => symlinkSync(target, p, type)),
  appendFile: _promisify((p, data, opts) => appendFileSync(_fdFromMaybeHandle(p), data, opts)),
  statfs: _promisify((path) => {
    _validatePath(path, 'path');
    const s = statSync(_toPath(path));
    return { type: 0, bsize: 4096, blocks: 0, bfree: 0, bavail: 0, files: 0, ffree: 0 };
  }),
  truncate: _promisify((p, len) => truncateSync(p, len)),
  opendir: _promisify((p, opts) => opendirSync(p, opts)),
  chown: (p, uid, gid) => { try { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); } catch(e) { return Promise.reject(e); } return _promisify(chownSync)(p, uid, gid); },
  lchown: (p, uid, gid) => { try { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); } catch(e) { return Promise.reject(e); } return _promisify(lchownSync)(p, uid, gid); },
  lchmod: _promisify((p, mode) => lchmodSync(p, mode)),
  lutimes: _promisify((p, atime, mtime) => lutimesSync(p, atime, mtime)),
  utimes: _promisify((p, atime, mtime) => utimesSync(p, atime, mtime)),
  open: (p, flags, mode) => {
    try {
      const fd = openSync(p, flags || 'r', mode);
      // After close the captured fd is stale (and may be reused by a later open),
      // so every fd op must reject EBADF rather than act on the wrong fd.
      const _ebadf = (syscall) => _fsError('EBADF', syscall, null, 'bad file descriptor');
      const handle = {
        fd,
        close() { if (!this._closed) { this._closed = true; closeSync(fd); this.fd = -1; this.emit('close'); } return Promise.resolve(); },
        read(buf, off, len, pos) {
          if (this._closed) return Promise.reject(_ebadf('read'));
          // FileHandle.read overloads: read(buffer,offset,length,position),
          // read(buffer,{offset,length,position}), and read({buffer,offset,length,position}).
          if (buf != null && typeof buf === 'object' && !Buffer.isBuffer(buf) && !ArrayBuffer.isView(buf)) {
            const o = buf;
            buf = o.buffer === undefined ? Buffer.alloc(16384) : o.buffer;
            off = o.offset; len = o.length; pos = o.position;
          } else if (buf == null) {
            buf = Buffer.alloc(16384);
          } else if (off != null && typeof off === 'object' && !Buffer.isBuffer(off) && !ArrayBuffer.isView(off)) {
            const o = off; off = o.offset; len = o.length; pos = o.position;
          }
          if (!Buffer.isBuffer(buf) && !ArrayBuffer.isView(buf)) return Promise.reject(_bufferArgError(buf));
          if (off == null) off = 0;
          if (len == null) len = buf.byteLength - off;
          if (pos === undefined) pos = null;
          try { return Promise.resolve({ bytesRead: readSync(fd, buf, off, len, pos), buffer: buf }); }
          catch (e) { return Promise.reject(e); }
        },
        write(buf, off, len, pos) {
          if (this._closed) return Promise.reject(_ebadf('write'));
          // writeSync validates+throws synchronously; surface as a rejection.
          try { return Promise.resolve({ bytesWritten: writeSync(fd, buf, off, len, pos), buffer: buf }); }
          catch (e) { return Promise.reject(e); }
        },
        stat(opts) { if (this._closed) return Promise.reject(_ebadf('fstat')); try { return Promise.resolve(fstatSync(fd, opts)); } catch (e) { return Promise.reject(e); } },
        readFile(opts) { if (this._closed) return Promise.reject(_ebadf('read')); try { return Promise.resolve(readFileSync('/dev/fd/' + fd, opts)); } catch (e) { return Promise.reject(e); } },
        writeFile(data) { if (this._closed) return Promise.reject(_ebadf('write')); writeSync(fd, data); return Promise.resolve(); },
        appendFile(data, opts) {
          const signal = opts && opts.signal;
          const run = (resolve, reject) => {
            if (signal && signal.aborted) { const e = new Error('The operation was aborted'); e.name = 'AbortError'; e.code = 'ABORT_ERR'; return reject(e); }
            try { b.fdSeek(fd, 0, 2); writeSync(fd, typeof data === 'string' ? Buffer.from(data, (opts && opts.encoding) || 'utf8') : data); resolve(); }
            catch (e) { reject(e); }
          };
          // signal may abort on a queued nextTick before our write runs — defer the
          // check so a same-tick abort() is observed and rejects with AbortError.
          return new Promise((resolve, reject) => { if (signal) process.nextTick(run, resolve, reject); else run(resolve, reject); });
        },
        readv(buffers, position) {
          try { return Promise.resolve({ bytesRead: readvSync(fd, buffers, position), buffers }); }
          catch (e) { return Promise.reject(e); }
        },
        writev(buffers, position) {
          try { return Promise.resolve({ bytesWritten: writevSync(fd, buffers, position), buffers }); }
          catch (e) { return Promise.reject(e); }
        },
        chmod(m) { if (this._closed) return Promise.reject(_ebadf('fchmod')); try { fchmodSync(fd, m); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        chown(uid, gid) { if (this._closed) return Promise.reject(_ebadf('fchown')); try { fchownSync(fd, uid, gid); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        utimes(atime, mtime) { if (this._closed) return Promise.reject(_ebadf('futime')); try { futimesSync(fd, atime, mtime); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        datasync() { if (this._closed) return Promise.reject(_ebadf('fdatasync')); try { fdatasyncSync(fd); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        sync() { if (this._closed) return Promise.reject(_ebadf('fsync')); try { fsyncSync(fd); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        truncate(len) { if (this._closed) return Promise.reject(_ebadf('ftruncate')); try { ftruncateSync(fd, len); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        // streams over the handle's fd; autoClose:false so closing the stream
        // doesn't close the handle the caller still owns.
        createReadStream(o) { return createReadStream(undefined, { fd, autoClose: false, ...(o || {}) }); },
        createWriteStream(o) { return createWriteStream(undefined, { fd, autoClose: false, ...(o || {}) }); },
        // explicit resource management: `await using fh = await open(...)` closes on scope exit
        [Symbol.asyncDispose]() { return this.close(); },
        [Symbol.dispose]() { try { this.close(); } catch {} },
      };
      // FileHandle is an EventEmitter (emits 'close'); methods stay own props.
      const _EE = require('events');
      Object.setPrototypeOf(handle, _EE.prototype);
      _EE.call(handle);
      return Promise.resolve(handle);
    } catch (e) { return Promise.reject(e); }
  },
  get constants() { return internalBinding('constants').fs; },
  // fs/promises.watch — async iterable yielding {eventType, filename}. Backed by
  // an FSWatcher; buffers events between for-await pulls; {signal} ends iteration.
  watch(filename, options) {
    if (typeof options === 'string') options = { encoding: options };
    else if (options !== undefined && (options === null || typeof options !== 'object')) throw _ERR_INVALID_ARG_TYPE('options', 'object', options);
    options = options || {};
    if (options.persistent !== undefined && typeof options.persistent !== 'boolean') throw _ERR_INVALID_ARG_TYPE('options.persistent', 'boolean', options.persistent);
    if (options.recursive !== undefined && typeof options.recursive !== 'boolean') throw _ERR_INVALID_ARG_TYPE('options.recursive', 'boolean', options.recursive);
    _assertEncoding(options.encoding);  // encoding:1 -> ERR_INVALID_ARG_VALUE
    _validateAbortSignal(options.signal);
    _validatePath(filename, 'filename');
    const watcher = watch(filename, options);
    const queue = [];
    let pending = null;     // {resolve,reject} of an awaiting next()
    let done = false;
    const push = (v) => { if (pending) { const p = pending; pending = null; p.resolve({ value: v, done: false }); } else queue.push(v); };
    const finish = () => { if (done) return; done = true; try { watcher.close(); } catch {} if (pending) { const p = pending; pending = null; p.resolve({ value: undefined, done: true }); } };
    watcher.on('change', (eventType, fname) => push({ eventType, filename: fname }));
    watcher.on('error', (err) => { if (pending) { const p = pending; pending = null; done = true; p.reject(err); } });
    watcher.on('close', finish);
    const sig = options.signal;
    if (sig) { if (sig.aborted) finish(); else sig.addEventListener('abort', finish, { once: true }); }
    return {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => { pending = { resolve, reject }; });
      },
      return(v) { finish(); return Promise.resolve({ value: v, done: true }); },
    };
  },
};

function _validateUid(uid) {
  if (typeof uid !== 'number') throw _ERR_INVALID_ARG_TYPE('uid', 'integer', uid);
  if (!Number.isInteger(uid)) { const e = new RangeError(`The value of "uid" is out of range. It must be an integer. Received ${uid}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (uid < -1 || uid > 4294967295) { const e = new RangeError(`The value of "uid" is out of range. It must be >= -1 && <= 4294967295. Received ${uid}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
}
function _validateGid(gid) {
  if (typeof gid !== 'number') throw _ERR_INVALID_ARG_TYPE('gid', 'integer', gid);
  if (!Number.isInteger(gid)) { const e = new RangeError(`The value of "gid" is out of range. It must be an integer. Received ${gid}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (gid < -1 || gid > 4294967295) { const e = new RangeError(`The value of "gid" is out of range. It must be >= -1 && <= 4294967295. Received ${gid}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
}
function fchown(fd, uid, gid, cb) { _validateFd(fd); _validateUid(uid); _validateGid(gid); _validateCb(cb); const _f = internalBinding('fs'); if (_f.fchown) _f.fchown(fd, uid, gid); process.nextTick(cb, null); }
function fchownSync(fd, uid, gid) { _validateFd(fd); _validateUid(uid); _validateGid(gid); const _f = internalBinding('fs'); if (_f.fchown) _f.fchown(fd, uid, gid); }
function chown(p, uid, gid, cb) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.chown) _f.chown(sp, uid, gid); if (cb) process.nextTick(cb, null); }
function lchown(p, uid, gid, cb) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); _validateCb(cb); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.lchown) _f.lchown(sp, uid, gid); else if (_f.chown) _f.chown(sp, uid, gid); process.nextTick(cb, null); }
function utimes(p, atime, mtime, cb) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); const r = _f.utimes(sp, Math.floor(_toUnixTimestamp(atime)), Math.floor(_toUnixTimestamp(mtime))); if (cb) process.nextTick(cb, _errnoErr(r, 'utime', sp)); }
function futimes(fd, atime, mtime, cb) { _validateFd(fd); _validateCb(cb); const _f = internalBinding('fs'); const r = _f.futimes(fd, Math.floor(_toUnixTimestamp(atime)), Math.floor(_toUnixTimestamp(mtime))); process.nextTick(cb, _errnoErr(r, 'futime', null)); }
function futimesSync(fd, atime, mtime) { _validateFd(fd); const _f = internalBinding('fs'); const r = _f.futimes(fd, Math.floor(_toUnixTimestamp(atime)), Math.floor(_toUnixTimestamp(mtime))); const e = _errnoErr(r, 'futime', null); if (e) throw e; }
function lutimes(p, atime, mtime, cb) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); const r = _f.lutimes(sp, Math.floor(_toUnixTimestamp(atime)), Math.floor(_toUnixTimestamp(mtime))); if (cb) process.nextTick(cb, _errnoErr(r, 'lutime', sp)); }
function lutimesSync(p, atime, mtime) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); const r = _f.lutimes(sp, Math.floor(_toUnixTimestamp(atime)), Math.floor(_toUnixTimestamp(mtime))); const e = _errnoErr(r, 'lutime', sp); if (e) throw e; }
function chownSync(p, uid, gid) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.chown) _f.chown(sp, uid, gid); }
function lchownSync(p, uid, gid) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); chownSync(p, uid, gid); }
function utimesSync(p, atime, mtime) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); const r = _f.utimes(sp, Math.floor(_toUnixTimestamp(atime)), Math.floor(_toUnixTimestamp(mtime))); const e = _errnoErr(r, 'utime', sp); if (e) throw e; }
function truncateSync(p, len) {
  _validatePath(p, 'path');
  _validateLen(len);
  const fd = openSync(_toPath(p), 'r+');
  try { ftruncateSync(fd, len || 0); } finally { closeSync(fd); }
}
function truncate(p, len, cb) {
  if (typeof len === 'function') { cb = len; len = 0; }
  _validatePath(p, 'path');
  _validateLen(len);
  try { truncateSync(p, len); if (cb) process.nextTick(cb, null); }
  catch (e) { if (cb) process.nextTick(cb, e); else throw e; }
}

function assertEncoding(encoding) {
  if (encoding && !Buffer.isEncoding(encoding)) {
    const e = new TypeError(`Unknown encoding: ${encoding}`);
    e.code = 'ERR_INVALID_ARG_VALUE';
    throw e;
  }
}

// Utf8Stream — fast writable stream for UTF-8 fd output
class Utf8Stream extends require('stream').Writable {
  constructor(opts) {
    super({ decodeStrings: false });
    this._sync = !!(opts && opts.sync);
    this._minLength = (opts && opts.minLength != null) ? opts.minLength : 0;
    this._buf = '';
    this._fd = null;
    this._fsOverride = (opts && opts.fs) || null;

    if (opts && opts.fd != null) {
      this._fd = opts.fd;
      process.nextTick(() => this.emit('ready'));
    } else if (opts && opts.dest) {
      this._fd = openSync(opts.dest, 'w');
      process.nextTick(() => this.emit('ready'));
    }
  }

  _write(chunk, encoding, cb) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    this._buf += str;
    if (this._buf.length < this._minLength) { cb(); return; }
    this._flush(cb);
  }

  _flush(cb) {
    if (this._buf.length === 0) { cb(); return; }
    const data = this._buf;
    this._buf = '';
    const buf = Buffer.from(data, 'utf8');
    if (this._sync) {
      try {
        const wsFn = this._fsOverride && this._fsOverride.writeSync;
        if (wsFn) wsFn(this._fd, buf, 0, buf.length);
        else writeSync(this._fd, buf, 0, buf.length);
        this.emit('write', buf.length);
        this.emit('drain');
        cb();
      } catch (e) { this.emit('error', e); cb(e); }
    } else {
      const wFn = this._fsOverride && this._fsOverride.write;
      const doWrite = wFn || write;
      doWrite(this._fd, buf, 0, buf.length, null, (err) => {
        if (err) { this.emit('error', err); cb(err); return; }
        this.emit('write', buf.length);
        this.emit('drain');
        cb();
      });
    }
  }

  _final(cb) {
    this._flush(cb);
  }
}

function _toUnixTimestamp(time) {
  if (typeof time === 'string' && +time == time) return +time;
  if (typeof time === 'number') {
    if (!Number.isFinite(time) || time < 0) return Date.now() / 1000;
    return time;
  }
  if (time instanceof Date) return time.getTime() / 1000;
  throw _ERR_INVALID_ARG_TYPE('time', 'Date or number', time);
}

function opendirSync(path, options) {
  _validatePath(path, 'path');
  const entries = readdirSync(path, { withFileTypes: true });
  let idx = 0;
  let closed = false;
  const _dirClosed = () => { const e = new Error('Directory handle was closed'); e.code = 'ERR_DIR_CLOSED'; return e; };
  return {
    path: typeof path === 'string' ? path : path.toString(),
    readSync() { if (closed) throw _dirClosed(); return idx < entries.length ? entries[idx++] : null; },
    read() { if (closed) return Promise.reject(_dirClosed()); return Promise.resolve(idx < entries.length ? entries[idx++] : null); },
    closeSync() { closed = true; },
    close() { closed = true; return Promise.resolve(); },  // idempotent
    [Symbol.dispose]() { closed = true; },
    [Symbol.asyncDispose]() { closed = true; return Promise.resolve(); },
    [Symbol.asyncIterator]() {
      const self = this;
      return { next() { const v = self.readSync(); return Promise.resolve(v ? { value: v, done: false } : { done: true }); } };
    },
  };
}

function opendir(path, options, cb) {
  if (typeof options === 'function') { cb = options; options = undefined; }
  _validateCb(cb);
  process.nextTick(() => { try { cb(null, opendirSync(path, options)); } catch (e) { cb(e); } });
}

// util.promisify(fs.read/write) must resolve with a named object, not just the
// first callback value — Node tags these with the customArgs symbol.
{
  const _cpa = Symbol.for('nodejs.util.promisify.customArgs');
  read[_cpa] = ['bytesRead', 'buffer'];
  write[_cpa] = ['bytesWritten', 'buffer'];
  readv[_cpa] = ['bytesRead', 'buffers'];
  writev[_cpa] = ['bytesWritten', 'buffers'];
}

module.exports = {
  readFile, writeFile, appendFile, stat, lstat, mkdir, readdir,
  unlink, rmdir, rename, chmod, lchmod, access, rm, copyFile, realpath, exists,
  open, close, read, write, fstat, fsync, fdatasync, ftruncate, fchmod, fchown, link, readlink, symlink,
  chown, lchown, utimes, futimes, lutimes, truncate, mkdtemp,
  readFileSync, writeFileSync, appendFileSync, statSync, existsSync,
  mkdirSync, unlinkSync, rmdirSync, renameSync,
  readdirSync, realpathSync, chmodSync,
  lchmodSync, rmSync, mkdtempSync, accessSync, copyFileSync,
  symlinkSync, lstatSync, readlinkSync, linkSync,
  chownSync, lchownSync, utimesSync, futimesSync, lutimesSync, truncateSync,
  openSync, closeSync, fstatSync, writeSync, readSync,
  fsyncSync, fdatasyncSync, ftruncateSync, fchmodSync, fchownSync, writevSync, writev, readv, readvSync,
  createReadStream, createWriteStream,
  watch, watchFile, unwatchFile, FSWatcher, Dirent, Dir, Stats,
  opendir, opendirSync, _toUnixTimestamp, statfsSync, statfs,
  promises, assertEncoding, stringToFlags, Utf8Stream,
  constants: internalBinding('constants').fs,
};
// ReadStream/WriteStream are real classes (instanceof + prototype work); init
// lazily to avoid a require('stream') cycle at fs load.
_initStreamClasses();
module.exports.ReadStream = ReadStreamCtor;
module.exports.WriteStream = WriteStreamCtor;
