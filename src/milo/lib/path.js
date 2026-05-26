// path module — POSIX path manipulation (macOS only, no win32)
'use strict';

const SLASH = 47;  // '/'
const DOT = 46;    // '.'

function validateString(value, name) {
  if (typeof value !== 'string') throw _ERR_INVALID_ARG_TYPE(name, 'string', value);
}

function normalizeString(path, allowAboveRoot) {
  let res = '', lastSegLen = 0, lastSlash = -1, dots = 0, code;
  for (let i = 0; i <= path.length; i++) {
    code = i < path.length ? path.charCodeAt(i) : SLASH;
    if (code === SLASH) {
      if (lastSlash === i - 1 || dots === 1) {
        // noop
      } else if (dots === 2) {
        if (res.length < 2 || lastSegLen !== 2 || res.charCodeAt(res.length - 1) !== DOT || res.charCodeAt(res.length - 2) !== DOT) {
          if (res.length > 2) {
            const last = res.lastIndexOf('/');
            if (last !== res.length - 1) {
              if (last < 0) { res = ''; lastSegLen = 0; }
              else { res = res.slice(0, last); lastSegLen = res.length - 1 - res.lastIndexOf('/'); }
              lastSlash = i; dots = 0; continue;
            }
          } else if (res.length > 0) {
            res = ''; lastSegLen = 0; lastSlash = i; dots = 0; continue;
          }
        }
        if (allowAboveRoot) { res += res.length > 0 ? '/..' : '..'; lastSegLen = 2; }
      } else {
        if (res.length > 0) res += '/' + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegLen = i - lastSlash - 1;
      }
      lastSlash = i; dots = 0;
    } else if (code === DOT && dots !== -1) { dots++; }
    else { dots = -1; }
  }
  return res;
}

function resolve(...args) {
  let resolved = '', resolvedAbsolute = false;
  for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const path = i >= 0 ? args[i] : (process.cwd ? process.cwd() : '/');
    validateString(path, 'path');
    if (path.length === 0) continue;
    resolved = path + '/' + resolved;
    resolvedAbsolute = path.charCodeAt(0) === SLASH;
  }
  resolved = normalizeString(resolved, !resolvedAbsolute);
  return resolvedAbsolute ? '/' + resolved : resolved || '.';
}

function normalize(path) {
  validateString(path, 'path');
  if (path.length === 0) return '.';
  const isAbsolute = path.charCodeAt(0) === SLASH;
  const trailingSep = path.charCodeAt(path.length - 1) === SLASH;
  let out = normalizeString(path, !isAbsolute);
  if (out.length === 0 && !isAbsolute) out = '.';
  if (out.length > 0 && trailingSep) out += '/';
  return isAbsolute ? '/' + out : out;
}

function join(...args) {
  let joined = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    validateString(arg, 'path');
    if (arg.length > 0) joined += (joined.length > 0 ? '/' : '') + arg;
  }
  if (joined.length === 0) return '.';
  return normalize(joined);
}

function isAbsolute(path) { validateString(path, 'path'); return path.length > 0 && path.charCodeAt(0) === SLASH; }

function dirname(path) {
  validateString(path, 'path');
  if (path.length === 0) return '.';
  const hasRoot = path.charCodeAt(0) === SLASH;
  let end = -1, matchedSlash = true;
  for (let i = path.length - 1; i >= 1; i--) {
    if (path.charCodeAt(i) === SLASH) { if (!matchedSlash) { end = i; break; } }
    else { matchedSlash = false; }
  }
  if (end < 0) return hasRoot ? '/' : '.';
  return hasRoot && end === 1 ? '//' : path.slice(0, end);
}

function basename(path, ext) {
  validateString(path, 'path');
  if (ext !== undefined) validateString(ext, 'ext');
  let start = 0, end = -1, matchedSlash = true;
  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext === path) return '';
    let extIdx = ext.length - 1, firstNonSlash = -1;
    for (let i = path.length - 1; i >= 0; i--) {
      const code = path.charCodeAt(i);
      if (code === SLASH) { if (!matchedSlash) { start = i + 1; break; } }
      else {
        if (firstNonSlash < 0) { matchedSlash = false; firstNonSlash = i + 1; }
        if (extIdx >= 0) {
          if (code === ext.charCodeAt(extIdx)) { if (--extIdx < 0) end = i; }
          else { extIdx = -1; end = firstNonSlash; }
        }
      }
    }
    if (start === end) end = firstNonSlash; else if (end < 0) end = path.length;
    return path.slice(start, end);
  }
  for (let i = path.length - 1; i >= 0; i--) {
    if (path.charCodeAt(i) === SLASH) { if (!matchedSlash) { start = i + 1; break; } }
    else if (end < 0) { matchedSlash = false; end = i + 1; }
  }
  if (end < 0) return '';
  return path.slice(start, end);
}

function extname(path) {
  validateString(path, 'path');
  let startDot = -1, startPart = 0, end = -1, matchedSlash = true, preDotState = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const code = path.charCodeAt(i);
    if (code === SLASH) { if (!matchedSlash) { startPart = i + 1; break; } continue; }
    if (end < 0) { matchedSlash = false; end = i + 1; }
    if (code === DOT) { if (startDot < 0) startDot = i; else if (preDotState !== 1) preDotState = 1; }
    else if (startDot >= 0) { preDotState = -1; }
  }
  if (startDot < 0 || end < 0 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return '';
  return path.slice(startDot, end);
}

function relative(from, to) {
  validateString(from, 'from');
  validateString(to, 'to');
  if (from === to) return '';
  from = resolve(from); to = resolve(to);
  if (from === to) return '';
  let fromStart = 1, fromEnd = from.length, fromLen = fromEnd - fromStart;
  let toStart = 1, toLen = to.length - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1, i = 0;
  for (; i < length; i++) {
    const fc = from.charCodeAt(fromStart + i);
    if (fc !== to.charCodeAt(toStart + i)) break;
    if (fc === SLASH) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) { if (to.charCodeAt(toStart + i) === SLASH) return to.slice(toStart + i + 1); if (i === 0) return to.slice(toStart + i); }
    if (fromLen > length) { if (from.charCodeAt(fromStart + i) === SLASH) lastCommonSep = i; else if (i === 0) lastCommonSep = 0; }
  }
  let out = '';
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; i++) {
    if (i === fromEnd || from.charCodeAt(i) === SLASH) out += out.length === 0 ? '..' : '/..';
  }
  return out + to.slice(toStart + lastCommonSep);
}

function parse(path) {
  validateString(path, 'path');
  const ret = { root: '', dir: '', base: '', ext: '', name: '' };
  if (path.length === 0) return ret;
  const isAbs = path.charCodeAt(0) === SLASH;
  if (isAbs) ret.root = '/';
  let startDot = -1, startPart = 0, end = -1, matchedSlash = true, preDotState = 0, i = path.length - 1;
  for (; i >= (isAbs ? 1 : 0); i--) {
    const code = path.charCodeAt(i);
    if (code === SLASH) { if (!matchedSlash) { startPart = i + 1; break; } continue; }
    if (end < 0) { matchedSlash = false; end = i + 1; }
    if (code === DOT) { if (startDot < 0) startDot = i; else if (preDotState !== 1) preDotState = 1; }
    else if (startDot >= 0) preDotState = -1;
  }
  if (end >= 0) {
    const start = startPart === 0 && isAbs ? 1 : startPart;
    if (startDot < 0 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
      ret.base = ret.name = path.slice(start, end);
    } else {
      ret.name = path.slice(start, startDot);
      ret.base = path.slice(start, end);
      ret.ext = path.slice(startDot, end);
    }
  }
  if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
  else if (isAbs) ret.dir = '/';
  return ret;
}

function format(pathObject) {
  const dir = pathObject.dir || pathObject.root || '';
  const base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');
  if (!dir) return base;
  return dir === pathObject.root ? dir + base : dir + '/' + base;
}

const sep = '/';
const delimiter = ':';

// win32 — minimal implementation for test compatibility
const win32 = {
  sep: '\\', delimiter: ';',
  resolve(...args) { for (const a of args) validateString(a, 'path'); return resolve(...args).replace(/\//g, '\\'); },
  normalize(p) { validateString(p, 'path'); return normalize(p.replace(/\\/g, '/')).replace(/\//g, '\\'); },
  isAbsolute(p) { validateString(p, 'path'); return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\'); },
  join(...args) { if (args.length === 0) return '.'; for (const a of args) validateString(a, 'path'); const joined = args.filter(a => a !== '').map(a => a.replace(/\\/g, '/')).join('/'); if (!joined) return '.'; return normalize(joined).replace(/\//g, '\\'); },
  dirname(p) { validateString(p, 'path'); const n = p.replace(/\\/g, '/'); const d = dirname(n); return d.replace(/\//g, '\\'); },
  basename(p, ext) { validateString(p, 'path'); if (ext !== undefined) validateString(ext, 'ext'); const parts = p.replace(/\\+$/, '').split(/[\\/]/); const b = parts[parts.length - 1] || ''; if (ext && b.endsWith(ext)) return b.slice(0, -ext.length); return b; },
  extname(p) { validateString(p, 'path'); return extname(p.replace(/\\/g, '/')); },
  parse(p) { validateString(p, 'path'); return parse(p.replace(/\\/g, '/')); },
  format(o) { return format(o); },
  toNamespacedPath(p) { return p; },
  relative(from, to) { validateString(from, 'from'); validateString(to, 'to'); return relative(from.replace(/\\/g, '/'), to.replace(/\\/g, '/')).replace(/\//g, '\\'); },
};
win32.posix = null;
win32.win32 = win32;

function toNamespacedPath(p) { return p; }

module.exports = { resolve, normalize, isAbsolute, join, relative, dirname, basename, extname, parse, format, sep, delimiter, toNamespacedPath, posix: null, win32 };
module.exports.posix = module.exports;
win32.posix = module.exports;
