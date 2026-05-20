// fs module — sync wrappers over internalBinding('fs')
'use strict';

const b = internalBinding('fs');

function readFileSync(path, opts) {
  const r = b.readFile(String(path));
  if (r === -1) throw new Error('ENOENT: no such file: ' + path);
  return r;
}

function writeFileSync(path, data) {
  const r = b.writeFile(String(path), String(data));
  if (r === -1) throw new Error('EIO: write failed: ' + path);
}

function statSync(path) {
  const s = b.stat(String(path));
  if (s === -1) throw new Error('ENOENT: no such file: ' + path);
  return { ...s, isFile: () => !!s.isFile, isDirectory: () => !!s.isDirectory };
}

function existsSync(path) { return !!b.exists(String(path)); }

function mkdirSync(path, opts) {
  const mode = (opts && opts.mode) || 0o777;
  const r = b.mkdir(String(path), mode);
  if (r !== 0) throw new Error('EEXIST: mkdir failed: ' + path);
}

function unlinkSync(path) { b.unlink(String(path)); }
function rmdirSync(path) { b.rmdir(String(path)); }
function renameSync(old, n) { b.rename(String(old), String(n)); }
function readdirSync(path) { return b.readdir(String(path)) || []; }
function realpathSync(path) { return b.realpath(String(path)); }
function chmodSync(path, mode) { b.chmod(String(path), mode); }

module.exports = {
  readFileSync, writeFileSync, statSync, existsSync,
  mkdirSync, unlinkSync, rmdirSync, renameSync,
  readdirSync, realpathSync, chmodSync,
  constants: internalBinding('constants').fs,
};
