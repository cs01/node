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
  const r = b.readFile(p);
  if (r === -1) { const e = new Error(`ENOENT: no such file or directory, open '${path}'`); e.code = 'ENOENT'; e.syscall = 'open'; e.path = String(path); throw e; }
  if (encoding === 'utf8' || encoding === 'utf-8') return r;
  return Buffer.from(r);
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
    if (buf.length > 0) b.fdWrite(path, buf, buf.length);
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
    if (buf.length > 0) b.fdWrite(fd, buf, buf.length);
  } finally {
    b.close(fd);
  }
}

function appendFileSync(path, data, options) {
  if (typeof options === 'string') options = { encoding: options };
  const opts = options || {};
  _assertEncoding(opts.encoding);
  _validatePath(path, 'path');
  const p = _toPath(path);
  const mode = opts.mode != null ? (typeof opts.mode === 'string' ? parseInt(opts.mode, 8) : opts.mode) : 0o666;
  const fd = b.open(p, stringToFlags('a'), mode);
  if (fd < 0) throw _fsError('ENOENT', 'open', p);
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, opts.encoding || 'utf8') : Buffer.from(data);
    if (buf.length > 0) b.fdWrite(fd, buf, buf.length);
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

function _wrapStats(s) {
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

function statSync(path, options) {
  _validatePath(path, 'path');
  const p = _toPath(path);
  if (p.length > 1024) throw _fsError('ENAMETOOLONG', 'stat', p, 'name too long');
  const s = b.stat(p);
  if (s === -1) {
    if (options && options.throwIfNoEntry === false) return undefined;
    throw _fsError('ENOENT', 'stat', p, 'no such file or directory');
  }
  return _wrapStats(s);
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
  const asBuffer = (typeof opts === 'string' ? opts : opts && opts.encoding) === 'buffer';
  if (opts && opts.withFileTypes) {
    return entries.map(name => new Dirent(asBuffer ? Buffer.from(name) : name, sp));
  }
  return asBuffer ? entries.map(name => Buffer.from(name)) : entries;
}
function realpathSync(path, opts) { _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding)); _validatePath(path, 'path'); return b.realpath(_toPath(path)); }
function chmodSync(path, mode) { _validatePath(path, 'path'); mode = _validateMode(mode, 'mode'); b.chmod(_toPath(path), mode); }
function lchmodSync(path, mode) { _validatePath(path, 'path'); mode = _validateMode(mode, 'mode'); b.lchmod ? b.lchmod(_toPath(path), mode) : b.chmod(_toPath(path), mode); }
function statfsSync(path, opts) {
  _validatePath(path, 'path');
  const r = b.statvfs(_toPath(path));
  if (r === -1) throw _fsError('EIO', 'statfs', _toPath(path));
  return { type: 0, bsize: r[0], blocks: r[2], bfree: r[3], bavail: r[4], files: r[5], ffree: r[6] };
}
function statfs(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path'); _validateCb(cb);
  _async(statfsSync, [path, opts], (err, res) => cb(err, res));
}
function lchmod(path, mode, cb) { _validatePath(path, 'path'); mode = _validateMode(mode, 'mode'); _validateCb(cb); _async(lchmodSync, [path, mode], (err) => cb(err)); }
function symlinkSync(target, path) { _validatePath(target, 'target'); _validatePath(path, 'path'); b.symlink(_toPath(target), _toPath(path)); }
function lstatSync(path, options) {
  _validatePath(path, 'path');
  const sp = _toPath(path);
  if (sp.length > 1024) throw _fsError('ENAMETOOLONG', 'lstat', sp, 'name too long');
  const result = b.lstat(sp);
  if (typeof result === 'number') {
    if (options && options.throwIfNoEntry === false) return undefined;
    throw _fsError('ENOENT', 'lstat', sp, 'no such file or directory');
  }
  return _wrapStats(result);
}
function readlinkSync(path, opts) { _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding)); _validatePath(path, 'path'); const sp = _toPath(path); return b.readlink ? b.readlink(sp) : sp; }
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
  if (mode != null && typeof mode === 'string') {
    const e = new TypeError(`The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received '${mode}'`);
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
  if (mode != null && typeof mode !== 'number' && typeof mode !== 'undefined') {
    throw _ERR_INVALID_ARG_TYPE('mode', 'integer', mode);
  }
  const sp = _toPath(path);
  const f = typeof flags === 'string' ? (FLAG_MAP[flags] ?? 0) : (flags || 0);
  const fd = b.open(sp, f, mode || 0o666);
  if (fd < 0) {
    if ((f & O_EXCL) && b.exists(sp)) throw _fsError('EEXIST', 'open', sp, 'file already exists');
    throw _fsError('ENOENT', 'open', sp, 'no such file or directory');
  }
  return fd;
}

function closeSync(fd) { _validateFd(fd); b.close(fd); }

function fstatSync(fd) {
  _validateFd(fd);
  const result = b.fstat(fd);
  if (typeof result === 'number') throw _fsError('EBADF', 'fstat', null, 'bad file descriptor');
  return _wrapStats(result);
}

function _bufferArgError(buffer) {
  let recv;
  if (buffer === null) recv = 'null';
  else if (typeof buffer === 'object') recv = 'an instance of ' + (buffer.constructor && buffer.constructor.name ? buffer.constructor.name : 'Object');
  else recv = 'type ' + typeof buffer + ' (' + buffer + ')';
  const e = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + recv);
  e.code = 'ERR_INVALID_ARG_TYPE'; return e;
}

function readSync(fd, buffer, offset, length, position) {
  _validateFd(fd);
  if (!Buffer.isBuffer(buffer) && !ArrayBuffer.isView(buffer)) {
    throw _bufferArgError(buffer);
  }
  if (offset != null && typeof offset === 'object' && !Array.isArray(offset) && !(offset instanceof String)) {
    ({ offset = 0, length = buffer.length, position = null } = offset);
  }
  if (offset == null) offset = 0;
  if (!Number.isInteger(offset)) { const e = new RangeError('The value of "offset" is out of range. It must be an integer. Received ' + offset); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (offset < 0) { const e = new RangeError('The value of "offset" is out of range. It must be >= 0. Received ' + offset); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  length = length != null ? length : buffer.length - offset;
  if (!Number.isInteger(length)) { const e = new RangeError('The value of "length" is out of range. It must be an integer. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (length < 0) { const e = new RangeError('The value of "length" is out of range. It must be >= 0. Received ' + length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
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
  if (typeof data === 'string') { data = Buffer.from(data); }
  else if (!Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) {
    throw _ERR_INVALID_ARG_TYPE('buffer', ['string', 'Buffer', 'TypedArray', 'DataView'], data);
  }
  offset = offset || 0;
  length = length != null ? length : data.length - offset;
  if (length === 0) return 0;
  if (position != null) b.fdSeek(fd, position, 0);
  const slice = data.slice(offset, offset + length);
  return b.fdWrite(fd, slice, slice.length);
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
    const n = b.fdWrite(fd, data, data.length);
    if (n > 0) total += n;
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
      const n = b.fdWrite(fd, data, data.length);
      if (n > 0) total += n;
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

function mkdtempSync(prefix, opts) {
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(prefix, 'prefix');
  prefix = _toPath(prefix);
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
const _ERRNO_CODES = { 1: 'EPERM', 2: 'ENOENT', 13: 'EACCES', 20: 'ENOTDIR', 30: 'EROFS', 62: 'ELOOP', 63: 'ENAMETOOLONG' };
const _ERRNO_MSG = { EPERM: 'operation not permitted', ENOENT: 'no such file or directory', EACCES: 'permission denied', ENOTDIR: 'not a directory', EROFS: 'read-only file system', ELOOP: 'too many symbolic links', ENAMETOOLONG: 'name too long' };
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

function copyFileSync(src, dest, mode) {
  _validatePath(src, 'src');
  _validatePath(dest, 'dest');
  if (mode != null && typeof mode !== 'number') throw _ERR_INVALID_ARG_TYPE('mode', 'integer', mode);
  const COPYFILE_EXCL = 1;
  if ((mode & COPYFILE_EXCL) && existsSync(dest)) {
    throw _fsError('EEXIST', 'copyfile', _toPath(src), 'file already exists', _toPath(dest));
  }
  const data = readFileSync(src);
  writeFileSync(dest, data);
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
      super({ highWaterMark: options.highWaterMark || 65536, encoding: options.encoding });
      this.fs = options.fs || module.exports;
      this.path = path == null ? undefined : path;
      this.flags = options.flags || 'r';
      this.mode = options.mode != null ? options.mode : 0o666;
      this.start = options.start;
      this.end = options.end == null ? Infinity : options.end;
      this.pos = this.start != null ? this.start : undefined;
      this.bytesRead = 0;
      this.closed = false;
      this.autoClose = options.autoClose !== undefined ? options.autoClose : true;
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
      const toRead = this.end !== Infinity ? Math.min(n, this.end - (this.pos || 0) + 1) : n;
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
      super({ highWaterMark: options.highWaterMark });
      this.fs = options.fs || module.exports;
      this.path = path == null ? undefined : path;
      this.flags = options.flags || 'w';
      this.mode = options.mode != null ? options.mode : 0o666;
      this.start = options.start;
      this.pos = this.start;
      this.bytesWritten = 0;
      this.closed = false;
      this.autoClose = options.autoClose !== undefined ? options.autoClose : true;
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
  _async(readFileSync, [path, opts], cb);
}

function writeFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  if (typeof path === 'number') {
    // fd mode
    _validateCb(cb);
    process.nextTick(() => {
      try { writeSync(path, typeof data === 'string' ? data : data.toString()); cb(null); }
      catch (e) { cb(e); }
    });
    return;
  }
  _validatePath(path, 'path');
  _validateCb(cb);
  _async(writeFileSync, [path, data], (err) => cb(err));
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
  _validateCb(cb); _async(copyFileSync, [src, dest, flags], (err) => cb(err));
}
function realpath(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(path, 'path');
  _async(realpathSync, [path], cb);
}
realpath.native = realpath;
realpathSync.native = realpathSync;
function appendFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _assertEncoding(typeof opts === 'string' ? opts : (opts && opts.encoding));
  _validatePath(path, 'path');
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
function ftruncateSync(fd, len) { _validateFd(fd); _validateLen(len); b.ftruncate(fd, len || 0); }
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
  if (mode != null && typeof mode === 'string') {
    const e = new TypeError(`The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received '${mode}'`);
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
  if (mode != null && typeof mode !== 'number') {
    throw _ERR_INVALID_ARG_TYPE('mode', 'integer', mode);
  }
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
  _async(fstatSync, [fd], cb);
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

    if (this._recursive) {
      this._addSubdirs(this._filename);
    }
  }

  _addSubdirs(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          const fd = tcp.watchFile(full);
          if (fd >= 0) {
            this._fds.set(fd, full);
            net._fileWatchers.set(fd, this);
            this._addSubdirs(full);
          }
        }
      } catch {}
    }
  }

  _onEvent(fflags, eventFd) {
    const isRename = !!(fflags & 32);
    const isWrite = !!(fflags & 2);
    const eventType = isRename ? 'rename' : 'change';
    const watchedPath = this._fds.get(eventFd) || this._filename;
    const relPath = watchedPath === this._filename
      ? path.basename(this._filename)
      : path.relative(this._filename, watchedPath);
    this.emit('change', eventType, relPath);

    // When a directory changes, scan for new subdirectories to watch
    if (this._recursive && isWrite) {
      this._addSubdirs(watchedPath);
    }
  }

  close() {
    for (const [fd] of this._fds) {
      net._fileWatchers.delete(fd);
      tcp.unwatchFile(fd);
    }
    this._fds.clear();
    this._fd = -1;
    this.emit('close');
  }
  ref() { return this; }
  unref() { return this; }
}

function watch(filename, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
  _assertEncoding(typeof options === 'string' ? options : (options && options.encoding));
  _validatePath(filename, 'filename');
  const watcher = new FSWatcher(String(filename), options);
  if (listener) watcher.on('change', listener);
  return watcher;
}

const _watchFileTimers = new Map();

function watchFile(filename, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
  _validatePath(filename, 'filename');
  const interval = (options && options.interval) || 5007;
  const fname = String(filename);
  let prev = null;
  try { prev = statSync(fname); } catch {}
  const timer = setInterval(() => {
    let curr = null;
    try { curr = statSync(fname); } catch {}
    if (prev && curr && prev.mtimeMs !== curr.mtimeMs) {
      listener(curr, prev);
    } else if (!prev && curr) {
      listener(curr, prev || curr);
    }
    prev = curr;
  }, interval);
  _watchFileTimers.set(fname, timer);
}

function unwatchFile(filename, listener) {
  _validatePath(filename, 'filename');
  const fname = String(filename);
  const timer = _watchFileTimers.get(fname);
  if (timer) { clearInterval(timer); _watchFileTimers.delete(fname); }
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
const promises = {
  readFile: _promisify((path, opts) => readFileSync(path, opts)),
  writeFile: _promisify((path, data) => writeFileSync(path, data)),
  stat: _promisify((path) => statSync(path)),
  lstat: _promisify((path) => lstatSync(path)),
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
  readlink: _promisify((p) => readlinkSync(p)),
  realpath: _promisify((p) => realpathSync(p)),
  symlink: _promisify((target, p) => symlinkSync(target, p)),
  appendFile: _promisify((p, data) => appendFileSync(p, data)),
  statfs: _promisify((path) => {
    _validatePath(path, 'path');
    const s = statSync(_toPath(path));
    return { type: 0, bsize: 4096, blocks: 0, bfree: 0, bavail: 0, files: 0, ffree: 0 };
  }),
  truncate: _promisify((p, len) => truncateSync(p, len)),
  opendir: _promisify((p, opts) => opendirSync(p, opts)),
  chown: (p, uid, gid) => { try { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); } catch(e) { return Promise.reject(e); } return _promisify(chownSync)(p, uid, gid); },
  lchown: (p, uid, gid) => { try { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); } catch(e) { return Promise.reject(e); } return _promisify(lchownSync)(p, uid, gid); },
  lchmod: (p, mode) => { try { _validatePath(p, 'path'); } catch(e) { return Promise.reject(e); } return Promise.resolve(); },
  lutimes: (p, atime, mtime) => { try { _validatePath(p, 'path'); } catch(e) { return Promise.reject(e); } return Promise.resolve(); },
  utimes: (p, atime, mtime) => { try { _validatePath(p, 'path'); } catch(e) { return Promise.reject(e); } return Promise.resolve(); },
  open: (p, flags, mode) => {
    try {
      const fd = openSync(p, flags || 'r', mode);
      const handle = {
        fd,
        close() { if (!this._closed) { this._closed = true; closeSync(fd); this.fd = -1; this.emit('close'); } return Promise.resolve(); },
        read(buf, off, len, pos) {
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
          // writeSync validates+throws synchronously; surface as a rejection.
          try { return Promise.resolve({ bytesWritten: writeSync(fd, buf, off, len, pos), buffer: buf }); }
          catch (e) { return Promise.reject(e); }
        },
        stat() { try { return Promise.resolve(fstatSync(fd)); } catch (e) { return Promise.reject(e); } },
        readFile(opts) { try { return Promise.resolve(readFileSync('/dev/fd/' + fd, opts)); } catch (e) { return Promise.reject(e); } },
        writeFile(data) { writeSync(fd, data); return Promise.resolve(); },
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
        chmod(m) { fchmodSync(fd, m); return Promise.resolve(); },
        chown(uid, gid) { try { fchownSync(fd, uid, gid); } catch {} return Promise.resolve(); },
        utimes(atime, mtime) { return Promise.resolve(); },
        datasync() { fdatasyncSync(fd); return Promise.resolve(); },
        sync() { fsyncSync(fd); return Promise.resolve(); },
        truncate(len) { ftruncateSync(fd, len); return Promise.resolve(); },
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
function utimes(p, atime, mtime, cb) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); _f.utimes(sp, Math.floor(atime), Math.floor(mtime)); if (cb) process.nextTick(cb, null); }
function lutimes(p, atime, mtime, cb) { _validatePath(p, 'path'); if (cb) process.nextTick(cb, null); }
function chownSync(p, uid, gid) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.chown) _f.chown(sp, uid, gid); }
function lchownSync(p, uid, gid) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); chownSync(p, uid, gid); }
function utimesSync(p, atime, mtime) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); _f.utimes(sp, Math.floor(atime), Math.floor(mtime)); }
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
  chown, lchown, utimes, lutimes, truncate, mkdtemp,
  readFileSync, writeFileSync, appendFileSync, statSync, existsSync,
  mkdirSync, unlinkSync, rmdirSync, renameSync,
  readdirSync, realpathSync, chmodSync,
  lchmodSync, rmSync, mkdtempSync, accessSync, copyFileSync,
  symlinkSync, lstatSync, readlinkSync, linkSync,
  chownSync, lchownSync, utimesSync, truncateSync,
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
