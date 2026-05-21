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

function statSync(path) {
  const s = b.stat(String(path));
  if (s === -1) throw _fsError('ENOENT', 'stat', path, 'no such file or directory');
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
function lstatSync(path) { return statSync(path); }
function readlinkSync(path) { return b.readlink ? b.readlink(String(path)) : String(path); }
function openSync() { throw new Error('openSync not implemented'); }
function closeSync() {}
function fstatSync() { return { isFile: () => true, isDirectory: () => false, size: 0 }; }
function writeSync() { return 0; }
function readSync() { return 0; }

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

function createReadStream() { throw new Error('createReadStream not implemented'); }
function createWriteStream() { throw new Error('createWriteStream not implemented'); }

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
  readFileSync, writeFileSync, appendFileSync, statSync, existsSync,
  mkdirSync, unlinkSync, rmdirSync, renameSync,
  readdirSync, realpathSync, chmodSync,
  rmSync, mkdtempSync, accessSync, copyFileSync,
  symlinkSync, lstatSync, readlinkSync,
  openSync, closeSync, fstatSync, writeSync, readSync,
  createReadStream, createWriteStream,
  promises,
  constants: internalBinding('constants').fs,
};
