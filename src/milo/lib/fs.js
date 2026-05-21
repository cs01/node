// fs module — sync wrappers over internalBinding('fs')
'use strict';

const b = internalBinding('fs');

function readFileSync(path, opts) {
  const r = b.readFile(String(path));
  if (r === -1) { const e = new Error(`ENOENT: no such file or directory, open '${path}'`); e.code = 'ENOENT'; e.syscall = 'open'; e.path = String(path); throw e; }
  const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
  if (encoding === 'utf8' || encoding === 'utf-8') return r;
  return Buffer.from(r);
}

function _fsError(code, syscall, path, msg) {
  const e = new Error(`${code}: ${msg}, ${syscall} '${path}'`);
  e.code = code; e.syscall = syscall; e.path = String(path);
  return e;
}

function writeFileSync(path, data) {
  const r = b.writeFile(String(path), typeof data === 'string' ? data : data.toString());
  if (r === -1) throw _fsError('EIO', 'write', path, 'write failed');
}

function appendFileSync(path, data) {
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
  const s = b.stat(String(path));
  if (s === -1) throw _fsError('ENOENT', 'stat', path, 'no such file or directory');
  return _wrapStats(s);
}

function existsSync(path) { return !!b.exists(String(path)); }

function mkdirSync(path, opts) {
  const mode = (opts && opts.mode) || 0o777;
  if (opts && opts.recursive) {
    const parts = String(path).split('/');
    let cur = parts[0] === '' ? '/' : '';
    for (const p of parts) {
      if (!p) { if (!cur) cur = '/'; continue; }
      cur = cur ? cur + '/' + p : p;
      if (!existsSync(cur)) { const r = b.mkdir(cur, mode); if (r !== 0) throw _fsError('EACCES', 'mkdir', cur, 'permission denied'); }
    }
    return cur;
  }
  const r = b.mkdir(String(path), mode);
  if (r !== 0) throw _fsError('EEXIST', 'mkdir', path, 'file already exists');
}

function unlinkSync(path) { b.unlink(String(path)); }
function rmdirSync(path) { b.rmdir(String(path)); }
function renameSync(old, n) { b.rename(String(old), String(n)); }
function readdirSync(path) { return b.readdir(String(path)) || []; }
function realpathSync(path) { return b.realpath(String(path)); }
function chmodSync(path, mode) { b.chmod(String(path), mode); }
function symlinkSync(target, path) { b.symlink(String(target), String(path)); }
function lstatSync(path) {
  const result = b.lstat(String(path));
  if (typeof result === 'number') throw _fsError('ENOENT', 'lstat', path, 'no such file or directory');
  return _wrapStats(result);
}
function readlinkSync(path) { return b.readlink ? b.readlink(String(path)) : String(path); }
// POSIX open flags
const O_RDONLY = 0, O_WRONLY = 1, O_RDWR = 2, O_CREAT = 0x200, O_TRUNC = 0x400, O_APPEND = 0x8, O_EXCL = 0x800;
const FLAG_MAP = {
  'r': O_RDONLY, 'r+': O_RDWR, 'w': O_WRONLY | O_CREAT | O_TRUNC,
  'w+': O_RDWR | O_CREAT | O_TRUNC, 'a': O_WRONLY | O_CREAT | O_APPEND,
  'a+': O_RDWR | O_CREAT | O_APPEND, 'wx': O_WRONLY | O_CREAT | O_TRUNC | O_EXCL,
  'ax': O_WRONLY | O_CREAT | O_APPEND | O_EXCL,
};

function openSync(path, flags, mode) {
  const f = typeof flags === 'string' ? (FLAG_MAP[flags] ?? 0) : (flags || 0);
  const fd = b.open(String(path), f, mode || 0o666);
  if (fd < 0) throw _fsError('ENOENT', 'open', path, 'no such file or directory');
  return fd;
}

function closeSync(fd) { b.close(fd); }

function fstatSync(fd) {
  const result = b.fstat(fd);
  if (typeof result === 'number') throw _fsError('EBADF', 'fstat', fd, 'bad file descriptor');
  return _wrapStats(result);
}

function readSync(fd, buffer, offset, length, position) {
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
  try {
    const s = statSync(String(path));
    if (s.isDirectory()) {
      if (opts && opts.recursive) {
        const entries = readdirSync(String(path));
        for (const e of entries) rmSync(String(path) + '/' + e, opts);
        rmdirSync(String(path));
      } else {
        rmdirSync(String(path));
      }
    } else {
      unlinkSync(String(path));
    }
  } catch (e) {
    if (!(opts && opts.force)) throw e;
  }
}

function mkdtempSync(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const dir = prefix + suffix;
  mkdirSync(dir);
  return dir;
}

function accessSync(path, mode) {
  if (!existsSync(String(path))) {
    const err = new Error('ENOENT: no such file or directory: ' + path);
    err.code = 'ENOENT';
    throw err;
  }
}

function copyFileSync(src, dest) {
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
  return ws;
}

// Async callback wrappers — run sync on next tick to match Node.js API shape
function _async(syncFn, args, cb) {
  process.nextTick(() => { try { const r = syncFn(...args); cb(null, r); } catch (e) { cb(e); } });
}

function readFile(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(readFileSync, [path, opts], cb);
}

function writeFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(writeFileSync, [path, data], (err) => cb(err));
}

function stat(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(statSync, [path], cb);
}

function lstat(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(lstatSync, [path], cb);
}

function mkdir(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(mkdirSync, [path, opts], cb);
}

function readdir(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(readdirSync, [path], cb);
}

function unlink(path, cb) { _async(unlinkSync, [path], (err) => cb(err)); }
function rmdir(path, cb) { _async(rmdirSync, [path], (err) => cb(err)); }
function rename(oldPath, newPath, cb) { _async(renameSync, [oldPath, newPath], (err) => cb(err)); }
function chmod(path, mode, cb) { _async(chmodSync, [path, mode], (err) => cb(err)); }
function access(path, mode, cb) {
  if (typeof mode === 'function') { cb = mode; mode = undefined; }
  _async(accessSync, [path, mode], (err) => cb(err));
}
function rm(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(rmSync, [path, opts], (err) => cb(err));
}
function copyFile(src, dest, flags, cb) {
  if (typeof flags === 'function') { cb = flags; flags = 0; }
  _async(copyFileSync, [src, dest], (err) => cb(err));
}
function realpath(path, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(realpathSync, [path], cb);
}
function appendFile(path, data, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = undefined; }
  _async(appendFileSync, [path, data], (err) => cb(err));
}
function exists(path, cb) { process.nextTick(() => cb(existsSync(path))); }

// --- fs.watch / watchFile / unwatchFile via kqueue EVFILT_VNODE ---
const EventEmitter = require('events');
const tcp = internalBinding('tcp');
const net = require('net');
const path = require('path');

// NOTE_DELETE=1, NOTE_WRITE=2, NOTE_EXTEND=4, NOTE_ATTRIB=8, NOTE_RENAME=32
class FSWatcher extends EventEmitter {
  constructor(filename, options) {
    super();
    this._filename = filename;
    net._ensurePoll();
    this._fd = tcp.watchFile(filename);
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('watch ' + filename + ' failed')));
      return;
    }
    net._fileWatchers.set(this._fd, this);
  }
  _onEvent(fflags) {
    const isRename = !!(fflags & 32);
    const eventType = isRename ? 'rename' : 'change';
    this.emit('change', eventType, path.basename(this._filename));
  }
  close() {
    if (this._fd >= 0) {
      net._fileWatchers.delete(this._fd);
      tcp.unwatchFile(this._fd);
      this._fd = -1;
    }
    this.emit('close');
  }
  ref() { return this; }
  unref() { return this; }
}

function watch(filename, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
  const watcher = new FSWatcher(String(filename), options);
  if (listener) watcher.on('change', listener);
  return watcher;
}

const _watchFileTimers = new Map();

function watchFile(filename, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
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
  const fname = String(filename);
  const timer = _watchFileTimers.get(fname);
  if (timer) { clearInterval(timer); _watchFileTimers.delete(fname); }
}

const promises = {
  readFile: (path, opts) => Promise.resolve(readFileSync(path, opts)),
  writeFile: (path, data) => Promise.resolve(writeFileSync(path, data)),
  stat: (path) => Promise.resolve(statSync(path)),
  unlink: (path) => Promise.resolve(unlinkSync(path)),
  mkdir: (path, opts) => Promise.resolve(mkdirSync(path, opts)),
  rmdir: (path) => Promise.resolve(rmdirSync(path)),
  readdir: (path) => Promise.resolve(readdirSync(path)),
  access: (path, mode) => Promise.resolve(accessSync(path, mode)),
  rm: (path, opts) => Promise.resolve(rmSync(path, opts)),
};

module.exports = {
  readFile, writeFile, appendFile, stat, lstat, mkdir, readdir,
  unlink, rmdir, rename, chmod, access, rm, copyFile, realpath, exists,
  readFileSync, writeFileSync, appendFileSync, statSync, existsSync,
  mkdirSync, unlinkSync, rmdirSync, renameSync,
  readdirSync, realpathSync, chmodSync,
  rmSync, mkdtempSync, accessSync, copyFileSync,
  symlinkSync, lstatSync, readlinkSync,
  openSync, closeSync, fstatSync, writeSync, readSync,
  createReadStream, createWriteStream,
  watch, watchFile, unwatchFile, FSWatcher,
  promises,
  constants: internalBinding('constants').fs,
};
