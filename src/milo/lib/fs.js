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

function _validatePath(p, name) {
  if (typeof p !== 'string' && !Buffer.isBuffer(p)) {
    if (p instanceof URL) {
      // URL with null bytes in pathname or encoded as %00
      const pathname = p.pathname;
      if (pathname.indexOf('\0') !== -1 || pathname.indexOf('%00') !== -1) {
        const err = new TypeError(`The "${name || 'path'}" argument must be of type string without null bytes. Received ${JSON.stringify(pathname)}`);
        err.code = 'ERR_INVALID_ARG_VALUE';
        throw err;
      }
      return;
    }
    const err = new TypeError(`The "${name || 'path'}" argument must be of type string or an instance of Buffer or URL. Received ${typeof p === 'object' ? (p === null ? 'null' : 'an instance of ' + (p.constructor && p.constructor.name || 'Object')) : 'type ' + typeof p} (${String(p)})`);
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
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
  if (typeof fd !== 'number' || fd !== (fd | 0) || fd < 0) throw _ERR_INVALID_ARG_TYPE('fd', 'number', fd);
}
function _validateMode(mode, name) {
  if (typeof mode === 'string') {
    if (!/^[0-7]+$/.test(mode)) { const e = new TypeError(`The "${name || 'mode'}" argument must be a 32-bit unsigned integer or an octal string. Received '${mode}'`); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; }
    return parseInt(mode, 8);
  }
  if (typeof mode !== 'number') throw _ERR_INVALID_ARG_TYPE(name || 'mode', 'number', mode);
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
  _validatePath(path, 'path');
  const r = b.readFile(_toPath(path));
  if (r === -1) { const e = new Error(`ENOENT: no such file or directory, open '${path}'`); e.code = 'ENOENT'; e.syscall = 'open'; e.path = String(path); throw e; }
  const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
  if (encoding === 'utf8' || encoding === 'utf-8') return r;
  return Buffer.from(r);
}

function _fsError(code, syscall, path, msg) {
  const pathStr = path != null ? ` '${path}'` : '';
  const e = new Error(`${code}: ${msg}, ${syscall}${pathStr}`);
  e.code = code; e.syscall = syscall; if (path != null) e.path = String(path);
  return e;
}

function writeFileSync(path, data) {
  _validatePath(path, 'path');
  const p = _toPath(path);
  const r = b.writeFile(p, typeof data === 'string' ? data : data.toString());
  if (r === -1) throw _fsError('EIO', 'write', p, 'write failed');
}

function appendFileSync(path, data) {
  _validatePath(path, 'path');
  let existing = '';
  try { existing = readFileSync(path, 'utf8'); } catch {}
  writeFileSync(path, existing + (typeof data === 'string' ? data : data.toString()));
}

function _wrapStats(s) {
  return {
    dev: s.dev || 0, ino: s.ino || 0, mode: s.mode || 0, nlink: s.nlink || 0,
    uid: s.uid || 0, gid: s.gid || 0, rdev: 0, size: s.size || 0,
    blksize: s.blksize || 4096, blocks: s.blocks || 0,
    atimeMs: s.atimeMs || 0, mtimeMs: s.mtimeMs || 0, ctimeMs: s.ctimeMs || 0, birthtimeMs: s.birthtimeMs || 0,
    atime: new Date(s.atimeMs || 0), mtime: new Date(s.mtimeMs || 0), ctime: new Date(s.ctimeMs || 0), birthtime: new Date(s.birthtimeMs || 0),
    isFile: () => !!s.isFile, isDirectory: () => !!s.isDirectory,
    isSymbolicLink: () => !!s.isSymbolicLink, isBlockDevice: () => false,
    isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false,
  };
}

function statSync(path) {
  _validatePath(path, 'path');
  const p = _toPath(path);
  const s = b.stat(p);
  if (s === -1) throw _fsError('ENOENT', 'stat', p, 'no such file or directory');
  return _wrapStats(s);
}

function existsSync(path) {
  // null bytes in path means file can't exist
  if (typeof path === 'string' && path.indexOf('\0') !== -1) return false;
  try { return !!b.exists(_toPath(path)); } catch { return false; }
}

function mkdirSync(path, opts) {
  _validatePath(path, 'path');
  const sp = _toPath(path);
  const mode = (opts && opts.mode) || 0o777;
  if (opts && opts.recursive) {
    const parts = sp.split('/');
    let cur = parts[0] === '' ? '/' : '';
    for (const p of parts) {
      if (!p) { if (!cur) cur = '/'; continue; }
      cur = cur ? cur + '/' + p : p;
      if (!existsSync(cur)) { const r = b.mkdir(cur, mode); if (r !== 0) throw _fsError('EACCES', 'mkdir', cur, 'permission denied'); }
    }
    return cur;
  }
  const r = b.mkdir(sp, mode);
  if (r !== 0) throw _fsError('EEXIST', 'mkdir', sp, 'file already exists');
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
  _validatePath(path, 'path');
  const sp = _toPath(path);
  const entries = b.readdir(sp) || [];
  if (opts && opts.withFileTypes) {
    return entries.map(name => new Dirent(name, sp));
  }
  return entries;
}
function realpathSync(path) { _validatePath(path, 'path'); return b.realpath(_toPath(path)); }
function chmodSync(path, mode) { _validatePath(path, 'path'); b.chmod(_toPath(path), mode); }
function symlinkSync(target, path) { _validatePath(target, 'target'); _validatePath(path, 'path'); b.symlink(_toPath(target), _toPath(path)); }
function lstatSync(path) {
  _validatePath(path, 'path');
  const sp = _toPath(path);
  const result = b.lstat(sp);
  if (typeof result === 'number') throw _fsError('ENOENT', 'lstat', sp, 'no such file or directory');
  return _wrapStats(result);
}
function readlinkSync(path) { _validatePath(path, 'path'); const sp = _toPath(path); return b.readlink ? b.readlink(sp) : sp; }
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
  const sp = _toPath(path);
  const f = typeof flags === 'string' ? (FLAG_MAP[flags] ?? 0) : (flags || 0);
  const fd = b.open(sp, f, mode || 0o666);
  if (fd < 0) throw _fsError('ENOENT', 'open', sp, 'no such file or directory');
  return fd;
}

function closeSync(fd) { _validateFd(fd); b.close(fd); }

function fstatSync(fd) {
  _validateFd(fd);
  const result = b.fstat(fd);
  if (typeof result === 'number') throw _fsError('EBADF', 'fstat', null, 'bad file descriptor');
  return _wrapStats(result);
}

function readSync(fd, buffer, offset, length, position) {
  if (offset != null && typeof offset === 'object') {
    ({ offset = 0, length = buffer.length, position = null } = offset);
  }
  offset = offset || 0;
  length = length || buffer.length - offset;
  if (position != null) b.fdSeek(fd, position, 0);
  const result = b.fdRead(fd, length);
  if (typeof result === 'number') return 0;
  const bytes = new Uint8Array(result.buffer || result);
  for (let i = 0; i < bytes.length; i++) buffer[offset + i] = bytes[i];
  return bytes.length;
}

function writeSync(fd, data, offset, length, position) {
  if (typeof data === 'string') data = Buffer.from(data);
  offset = offset || 0;
  length = length || data.length - offset;
  if (position != null) b.fdSeek(fd, position, 0);
  const slice = data.slice(offset, offset + length);
  return b.fdWrite(fd, slice, slice.length);
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

function mkdtempSync(prefix) {
  _validatePath(prefix, 'prefix');
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const dir = prefix + suffix;
  mkdirSync(dir);
  return dir;
}

function mkdtemp(prefix, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(prefix, 'prefix');
  _validateCb(cb);
  _async(mkdtempSync, [prefix], cb);
}

function accessSync(path, mode) {
  _validatePath(path, 'path');
  const sp = _toPath(path);
  if (!existsSync(sp)) {
    const err = new Error('ENOENT: no such file or directory: ' + sp);
    err.code = 'ENOENT';
    throw err;
  }
}

function copyFileSync(src, dest) {
  _validatePath(src, 'src');
  _validatePath(dest, 'dest');
  const data = readFileSync(src);
  writeFileSync(dest, data);
}

function createReadStream(path, opts) {
  const { Readable } = require('stream');
  const highWaterMark = (opts && opts.highWaterMark) || 65536;
  const encoding = opts && opts.encoding;
  const fd = openSync(path, (opts && opts.flags) || 'r');
  let pos = (opts && opts.start) || 0;
  const end = opts && opts.end;
  const rs = new Readable({
    highWaterMark,
    read(size) {
      const toRead = end != null ? Math.min(size, end - pos + 1) : size;
      if (toRead <= 0) { this.push(null); closeSync(fd); return; }
      const buf = Buffer.alloc(toRead);
      const n = readSync(fd, buf, 0, toRead, pos);
      if (n <= 0) { this.push(null); closeSync(fd); return; }
      pos += n;
      const chunk = n < toRead ? buf.slice(0, n) : buf;
      this.push(encoding ? chunk.toString(encoding) : chunk);
    },
  });
  rs.path = path;
  rs.fd = fd;
  process.nextTick(() => rs.emit('open', fd));
  return rs;
}

function createWriteStream(path, opts) {
  const { Writable } = require('stream');
  const flags = (opts && opts.flags) || 'w';
  const fd = openSync(path, flags);
  const ws = new Writable({
    write(chunk, encoding, cb) {
      try { writeSync(fd, chunk); cb(); } catch (e) { cb(e); }
    },
    final(cb) { closeSync(fd); cb(); },
  });
  ws.path = path;
  ws.fd = fd;
  process.nextTick(() => ws.emit('open', fd));
  return ws;
}

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
  if (typeof path === 'number') {
    // fd mode — read all data from fd
    process.nextTick(() => {
      try {
        const chunks = [];
        const buf = Buffer.alloc(8192);
        let n;
        while ((n = readSync(path, buf, 0, 8192, null)) > 0) chunks.push(buf.slice(0, n));
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
  _async(statSync, [path], cb);
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
  _validateCb(cb); _async(copyFileSync, [src, dest], (err) => cb(err));
}
function realpath(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _async(realpathSync, [path], cb);
}
function appendFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _validateCb(cb); _async(appendFileSync, [path, data], (err) => cb(err));
}
function exists(path, cb) {
  if (typeof cb !== 'function') throw _ERR_INVALID_ARG_TYPE('cb', 'function', cb);
  process.nextTick(() => { try { cb(existsSync(path)); } catch { cb(false); } });
}

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
function ftruncateSync(fd, len) { _validateFd(fd); b.ftruncate(fd, len || 0); }
function fchmodSync(fd, mode) { _validateFd(fd); mode = _validateMode(mode, 'mode'); b.fchmod(fd, mode); }

function fsync(fd, cb) { _validateFd(fd); _validateCb(cb); _async(fsyncSync, [fd], (err) => cb(err)); }
function fdatasync(fd, cb) { _validateFd(fd); _validateCb(cb); _async(fdatasyncSync, [fd], (err) => cb(err)); }
function ftruncate(fd, len, cb) {
  if (typeof len === 'function') { cb = len; len = 0; }
  _async(ftruncateSync, [fd, len], (err) => cb(err));
}
function fchmod(fd, mode, cb) { _validateFd(fd); mode = _validateMode(mode, 'mode'); _validateCb(cb); _async(fchmodSync, [fd, mode], (err) => cb(err)); }

function open(path, flags, mode, cb) {
  if (typeof flags === 'function') { cb = flags; flags = 'r'; mode = 0o666; }
  if (typeof mode === 'function') { cb = mode; mode = 0o666; }
  _validatePath(path, 'path');
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
  if (typeof position === 'function') { cb = position; position = null; }
  if (fd == null || typeof fd !== 'number') throw new TypeError('The "fd" argument must be of type number. Received ' + typeof fd);
  try {
    const n = readSync(fd, buffer, offset, length, position);
    process.nextTick(() => cb(null, n, buffer));
  } catch (e) { process.nextTick(() => cb(e)); }
}

function fstat(fd, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validateFd(fd);
  _async(fstatSync, [fd], cb);
}

function readlink(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _validatePath(path, 'path');
  _async(readlinkSync, [path], cb);
}
function symlink(target, path, type, cb) {
  if (typeof type === 'function') { cb = type; type = undefined; }
  _validatePath(target, 'target');
  _validatePath(path, 'path');
  _async(symlinkSync, [target, path], (err) => cb(err));
}
function write(fd, buffer, offset, length, position, cb) {
  if (fd == null || typeof fd !== 'number') throw new TypeError('The "fd" argument must be of type number. Received ' + typeof fd);
  if (typeof offset === 'function') { cb = offset; offset = 0; length = buffer.length; position = null; }
  if (typeof length === 'function') { cb = length; length = buffer.length - offset; position = null; }
  if (typeof position === 'function') { cb = position; position = null; }
  try {
    const n = writeSync(fd, buffer, offset, length, position);
    process.nextTick(() => cb(null, n, buffer));
  } catch (e) { process.nextTick(() => cb(e)); }
}

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
  copyFile: _promisify((src, dst) => copyFileSync(src, dst)),
  mkdtemp: _promisify((prefix) => mkdtempSync(prefix)),
  readlink: _promisify((p) => readlinkSync(p)),
  realpath: _promisify((p) => realpathSync(p)),
  symlink: _promisify((target, p) => symlinkSync(target, p)),
  appendFile: _promisify((p, data) => appendFileSync(p, data)),
  chown: () => Promise.resolve(),
  lchown: () => Promise.resolve(),
  lchmod: () => Promise.resolve(),
  lutimes: () => Promise.resolve(),
  utimes: () => Promise.resolve(),
  open: (p, flags, mode) => {
    const fd = openSync(p, flags || 'r', mode);
    const handle = {
      fd,
      close() { closeSync(fd); return Promise.resolve(); },
      read(buf, off, len, pos) { return Promise.resolve({ bytesRead: readSync(fd, buf, off, len, pos), buffer: buf }); },
      write(buf, off, len, pos) { return Promise.resolve({ bytesWritten: writeSync(fd, buf, off, len, pos), buffer: buf }); },
      stat() { return Promise.resolve(fstatSync(fd)); },
      readFile(opts) { return Promise.resolve(readFileSync('/dev/fd/' + fd, opts)); },
      writeFile(data) { writeSync(fd, data); return Promise.resolve(); },
      chmod(m) { fchmodSync(fd, m); return Promise.resolve(); },
      datasync() { fdatasyncSync(fd); return Promise.resolve(); },
      sync() { fsyncSync(fd); return Promise.resolve(); },
      truncate(len) { ftruncateSync(fd, len); return Promise.resolve(); },
    };
    return Promise.resolve(handle);
  },
  get constants() { return internalBinding('constants').fs; },
};

function _validateUid(uid) { if (typeof uid !== 'number' || uid !== (uid | 0)) throw _ERR_INVALID_ARG_TYPE('uid', 'integer', uid); }
function _validateGid(gid) { if (typeof gid !== 'number' || gid !== (gid | 0)) throw _ERR_INVALID_ARG_TYPE('gid', 'integer', gid); }
function fchown(fd, uid, gid, cb) { _validateUid(uid); _validateGid(gid); const _f = internalBinding('fs'); if (_f.fchown) _f.fchown(fd, uid, gid); if (cb) process.nextTick(cb, null); }
function fchownSync(fd, uid, gid) { _validateUid(uid); _validateGid(gid); const _f = internalBinding('fs'); if (_f.fchown) _f.fchown(fd, uid, gid); }
function chown(p, uid, gid, cb) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.chown) _f.chown(sp, uid, gid); if (cb) process.nextTick(cb, null); }
function lchown(p, uid, gid, cb) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.lchown) _f.lchown(sp, uid, gid); else if (_f.chown) _f.chown(sp, uid, gid); if (cb) process.nextTick(cb, null); }
function utimes(p, atime, mtime, cb) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); _f.utimes(sp, Math.floor(atime), Math.floor(mtime)); if (cb) process.nextTick(cb, null); }
function lutimes(p, atime, mtime, cb) { _validatePath(p, 'path'); if (cb) process.nextTick(cb, null); }
function chownSync(p, uid, gid) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); const sp = _toPath(p); const _f = internalBinding('fs'); if (_f.chown) _f.chown(sp, uid, gid); }
function lchownSync(p, uid, gid) { _validatePath(p, 'path'); _validateUid(uid); _validateGid(gid); chownSync(p, uid, gid); }
function utimesSync(p, atime, mtime) { _validatePath(p, 'path'); const sp = _toPath(p); const _f = internalBinding('fs'); _f.utimes(sp, Math.floor(atime), Math.floor(mtime)); }
function truncateSync(p, len) {
  _validatePath(p, 'path');
  const fd = openSync(_toPath(p), 'r+');
  try { ftruncateSync(fd, len || 0); } finally { closeSync(fd); }
}
function truncate(p, len, cb) {
  if (typeof len === 'function') { cb = len; len = 0; }
  _validatePath(p, 'path');
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

module.exports = {
  readFile, writeFile, appendFile, stat, lstat, mkdir, readdir,
  unlink, rmdir, rename, chmod, access, rm, copyFile, realpath, exists,
  open, close, read, write, fstat, fsync, fdatasync, ftruncate, fchmod, fchown, link, readlink, symlink,
  chown, lchown, utimes, lutimes, truncate, mkdtemp,
  readFileSync, writeFileSync, appendFileSync, statSync, existsSync,
  mkdirSync, unlinkSync, rmdirSync, renameSync,
  readdirSync, realpathSync, chmodSync,
  rmSync, mkdtempSync, accessSync, copyFileSync,
  symlinkSync, lstatSync, readlinkSync, linkSync,
  chownSync, lchownSync, utimesSync, truncateSync,
  openSync, closeSync, fstatSync, writeSync, readSync,
  fsyncSync, fdatasyncSync, ftruncateSync, fchmodSync, fchownSync,
  createReadStream, createWriteStream,
  ReadStream: createReadStream, WriteStream: createWriteStream,
  watch, watchFile, unwatchFile, FSWatcher, Dirent,
  promises, assertEncoding, stringToFlags,
  constants: internalBinding('constants').fs,
};
