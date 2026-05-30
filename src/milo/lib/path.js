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

// --- win32 path internals (faithful port of Node's lib/path.js win32) ---
const _CC_DOT = 46, _CC_FSLASH = 47, _CC_BSLASH = 92, _CC_COLON = 58;
function _winIsSep(c) { return c === _CC_FSLASH || c === _CC_BSLASH; }
function _isWinDeviceRoot(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function _winNormalizeString(path, allowAboveRoot) {
  let res = '', lastSegmentLength = 0, lastSlash = -1, dots = 0, code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (_winIsSep(code)) break;
    else code = _CC_FSLASH;
    if (_winIsSep(code)) {
      if (lastSlash === i - 1 || dots === 1) { /* noop */ }
      else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== _CC_DOT || res.charCodeAt(res.length - 2) !== _CC_DOT) {
          if (res.length > 2) {
            const lsi = res.lastIndexOf('\\');
            if (lsi === -1) { res = ''; lastSegmentLength = 0; }
            else { res = res.slice(0, lsi); lastSegmentLength = res.length - 1 - res.lastIndexOf('\\'); }
            lastSlash = i; dots = 0; continue;
          } else if (res.length !== 0) { res = ''; lastSegmentLength = 0; lastSlash = i; dots = 0; continue; }
        }
        if (allowAboveRoot) { res += res.length > 0 ? '\\..' : '..'; lastSegmentLength = 2; }
      } else {
        if (res.length > 0) res += '\\' + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i; dots = 0;
    } else if (code === _CC_DOT && dots !== -1) { ++dots; }
    else { dots = -1; }
  }
  return res;
}

const win32 = {
  sep: '\\', delimiter: ';',
  resolve(...args) {
    let resolvedDevice = '', resolvedTail = '', resolvedAbsolute = false;
    for (let i = args.length - 1; i >= -1; i--) {
      let path;
      if (i >= 0) {
        path = args[i]; validateString(path, `paths[${i}]`);
        if (path.length === 0) continue;
      } else if (resolvedDevice.length === 0) { path = process.cwd(); }
      else {
        path = process.env['=' + resolvedDevice] || process.cwd();
        if (path === undefined || (path.slice(0, 2).toLowerCase() !== resolvedDevice.toLowerCase() && path.charCodeAt(2) === _CC_BSLASH)) {
          path = resolvedDevice + '\\';
        }
      }
      const len = path.length;
      let rootEnd = 0, device = '', isAbsolute = false;
      const code = path.charCodeAt(0);
      if (len === 1) { if (_winIsSep(code)) { rootEnd = 1; isAbsolute = true; } }
      else if (_winIsSep(code)) {
        isAbsolute = true;
        if (_winIsSep(path.charCodeAt(1))) {
          let j = 2, last = j;
          while (j < len && !_winIsSep(path.charCodeAt(j))) j++;
          if (j < len && j !== last) {
            const firstPart = path.slice(last, j); last = j;
            while (j < len && _winIsSep(path.charCodeAt(j))) j++;
            if (j < len && j !== last) {
              last = j;
              while (j < len && !_winIsSep(path.charCodeAt(j))) j++;
              if (j === len || j !== last) { device = '\\\\' + firstPart + '\\' + path.slice(last, j); rootEnd = j; }
            }
          }
        } else { rootEnd = 1; }
      } else if (_isWinDeviceRoot(code) && path.charCodeAt(1) === _CC_COLON) {
        device = path.slice(0, 2); rootEnd = 2;
        if (len > 2 && _winIsSep(path.charCodeAt(2))) { isAbsolute = true; rootEnd = 3; }
      }
      if (device.length > 0) {
        if (resolvedDevice.length > 0) { if (device.toLowerCase() !== resolvedDevice.toLowerCase()) continue; }
        else { resolvedDevice = device; }
      }
      if (resolvedAbsolute) { if (resolvedDevice.length > 0) break; }
      else {
        resolvedTail = path.slice(rootEnd) + '\\' + resolvedTail;
        resolvedAbsolute = isAbsolute;
        if (isAbsolute && resolvedDevice.length > 0) break;
      }
    }
    resolvedTail = _winNormalizeString(resolvedTail, !resolvedAbsolute);
    return resolvedAbsolute ? resolvedDevice + '\\' + resolvedTail : (resolvedDevice + resolvedTail) || '.';
  },
  normalize(path) {
    validateString(path, 'path');
    const len = path.length;
    if (len === 0) return '.';
    let rootEnd = 0, device, isAbsolute = false;
    const code = path.charCodeAt(0);
    if (len === 1) return _winIsSep(code) ? '\\' : path;
    if (_winIsSep(code)) {
      isAbsolute = true;
      if (_winIsSep(path.charCodeAt(1))) {
        let j = 2, last = j;
        while (j < len && !_winIsSep(path.charCodeAt(j))) j++;
        if (j < len && j !== last) {
          const firstPart = path.slice(last, j); last = j;
          while (j < len && _winIsSep(path.charCodeAt(j))) j++;
          if (j < len && j !== last) {
            last = j;
            while (j < len && !_winIsSep(path.charCodeAt(j))) j++;
            if (j === len) return '\\\\' + firstPart + '\\' + path.slice(last) + '\\';
            if (j !== last) { device = '\\\\' + firstPart + '\\' + path.slice(last, j); rootEnd = j; }
          }
        }
      } else { rootEnd = 1; }
    } else if (_isWinDeviceRoot(code) && path.charCodeAt(1) === _CC_COLON) {
      device = path.slice(0, 2); rootEnd = 2;
      if (len > 2 && _winIsSep(path.charCodeAt(2))) { isAbsolute = true; rootEnd = 3; }
    }
    let tail = rootEnd < len ? _winNormalizeString(path.slice(rootEnd), !isAbsolute) : '';
    if (tail.length === 0 && !isAbsolute) tail = '.';
    if (tail.length > 0 && _winIsSep(path.charCodeAt(len - 1))) tail += '\\';
    if (device === undefined) return isAbsolute ? (tail.length > 0 ? '\\' + tail : '\\') : tail;
    return isAbsolute ? (tail.length > 0 ? device + '\\' + tail : device + '\\') : device + tail;
  },
  isAbsolute(path) {
    validateString(path, 'path');
    const len = path.length;
    if (len === 0) return false;
    const code = path.charCodeAt(0);
    return _winIsSep(code) || (len > 2 && _isWinDeviceRoot(code) && path.charCodeAt(1) === _CC_COLON && _winIsSep(path.charCodeAt(2)));
  },
  join(...args) {
    if (args.length === 0) return '.';
    let joined, firstPart;
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i]; validateString(arg, 'path');
      if (arg.length > 0) { if (joined === undefined) joined = firstPart = arg; else joined += '\\' + arg; }
    }
    if (joined === undefined) return '.';
    let needsReplace = true, slashCount = 0;
    if (_winIsSep(firstPart.charCodeAt(0))) {
      ++slashCount;
      const firstLen = firstPart.length;
      if (firstLen > 1 && _winIsSep(firstPart.charCodeAt(1))) {
        ++slashCount;
        if (firstLen > 2) { if (_winIsSep(firstPart.charCodeAt(2))) ++slashCount; else needsReplace = false; }
      }
    }
    if (needsReplace) {
      while (slashCount < joined.length && _winIsSep(joined.charCodeAt(slashCount))) slashCount++;
      if (slashCount >= 2) joined = '\\' + joined.slice(slashCount);
    }
    return win32.normalize(joined);
  },
  dirname(p) {
    validateString(p, 'path');
    if (p.length === 0) return '.';
    const BSLASH = 92, FSLASH = 47, COLON = 58;
    const isSep = c => c === BSLASH || c === FSLASH;
    let rootEnd = -1, offset = 0;
    const code = p.charCodeAt(0);
    if (p.length === 1) return isSep(code) ? p : '.';
    // UNC path \\server\share
    if (isSep(code)) {
      rootEnd = offset = 1;
      if (isSep(p.charCodeAt(1))) {
        let j = 2, last = j;
        while (j < p.length && !isSep(p.charCodeAt(j))) j++;
        if (j < p.length && j !== last) {
          last = j;
          while (j < p.length && isSep(p.charCodeAt(j))) j++;
          if (j < p.length && j !== last) {
            last = j;
            while (j < p.length && !isSep(p.charCodeAt(j))) j++;
            if (j === p.length) return p;
            if (j !== last) rootEnd = offset = j + 1;
          }
        }
      }
    } else if (p.charCodeAt(1) === COLON && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      // drive letter e.g. C:
      rootEnd = offset = 2;
      if (p.length > 2 && isSep(p.charCodeAt(2))) rootEnd = offset = 3;
    }
    let end = -1, matchedSlash = true;
    for (let i = p.length - 1; i >= offset; i--) {
      if (isSep(p.charCodeAt(i))) { if (!matchedSlash) { end = i; break; } }
      else matchedSlash = false;
    }
    if (end === -1) {
      if (rootEnd === -1) return '.';
      end = rootEnd;
    }
    return p.slice(0, end);
  },
  basename(p, ext) {
    validateString(p, 'path');
    if (ext !== undefined) validateString(ext, 'ext');
    const BSLASH = 92, FSLASH = 47, COLON = 58;
    const isSep = c => c === BSLASH || c === FSLASH;
    let start = 0, end = -1, matchedSlash = true;
    // skip drive letter (e.g. C:)
    if (p.length >= 2 && p.charCodeAt(1) === COLON) {
      const d = p.charCodeAt(0);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122)) start = 2;
    }
    if (ext !== undefined && ext.length > 0 && ext.length <= p.length) {
      if (ext === p) return '';
      let extIdx = ext.length - 1, firstNonSlash = -1;
      for (let i = p.length - 1; i >= start; i--) {
        const code = p.charCodeAt(i);
        if (isSep(code)) { if (!matchedSlash) { start = i + 1; break; } }
        else {
          if (firstNonSlash < 0) { matchedSlash = false; firstNonSlash = i + 1; }
          if (extIdx >= 0) {
            if (code === ext.charCodeAt(extIdx)) { if (--extIdx < 0) end = i; }
            else { extIdx = -1; end = firstNonSlash; }
          }
        }
      }
      if (start === end) end = firstNonSlash; else if (end < 0) end = p.length;
      return p.slice(start, end);
    }
    for (let i = p.length - 1; i >= start; i--) {
      if (isSep(p.charCodeAt(i))) { if (!matchedSlash) { start = i + 1; break; } }
      else if (end < 0) { matchedSlash = false; end = i + 1; }
    }
    if (end < 0) return '';
    return p.slice(start, end);
  },
  extname(p) {
    validateString(p, 'path');
    let s = p.replace(/\\/g, '/');
    if (s.length >= 2 && s.charCodeAt(1) === 58) {
      const d = s.charCodeAt(0);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122)) s = s.slice(2);
    }
    return extname(s);
  },
  parse(p) {
    validateString(p, 'path');
    const ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (p.length === 0) return ret;
    const isSep = c => c === 47 || c === 92;
    let start = 0;
    // drive letter
    if (p.length >= 2 && p.charCodeAt(1) === 58) {
      const d = p.charCodeAt(0);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122)) {
        start = 2;
        if (p.length > 2 && isSep(p.charCodeAt(2))) {
          ret.root = p.slice(0, 3);
          start = 3;
        } else {
          ret.root = p.slice(0, 2);
        }
      }
    } else if (isSep(p.charCodeAt(0))) {
      ret.root = '\\';
      start = 1;
      if (p.length > 1 && isSep(p.charCodeAt(1))) { start = 2; ret.root = '\\\\'; }
    }
    let startDot = -1, startPart = start, end = -1, matchedSlash = true, preDotState = 0;
    for (let i = p.length - 1; i >= start; i--) {
      const code = p.charCodeAt(i);
      if (isSep(code)) { if (!matchedSlash) { startPart = i + 1; break; } continue; }
      if (end < 0) { matchedSlash = false; end = i + 1; }
      if (code === 46) { if (startDot < 0) startDot = i; else if (preDotState !== 1) preDotState = 1; }
      else if (startDot >= 0) preDotState = -1;
    }
    if (end >= 0) {
      if (startDot < 0 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
        ret.base = ret.name = p.slice(startPart, end);
      } else {
        ret.name = p.slice(startPart, startDot);
        ret.base = p.slice(startPart, end);
        ret.ext = p.slice(startDot, end);
      }
    }
    if (startPart > start) ret.dir = p.slice(0, startPart - 1);
    else if (ret.root) ret.dir = ret.root;
    return ret;
  },
  format(o) {
    const dir = o.dir || o.root || '';
    const base = o.base || (o.name || '') + (o.ext || '');
    if (!dir) return base;
    return dir === o.root ? dir + base : dir + '\\' + base;
  },
  toNamespacedPath(p) { return p; },
  relative(from, to) {
    validateString(from, 'from'); validateString(to, 'to');
    if (from === to) return '';
    const fromOrig = win32.resolve(from);
    const toOrig = win32.resolve(to);
    if (fromOrig === toOrig) return '';
    // Case-only differences resolve to the same path (length-changing lowercase is
    // fine for an equality check since both sides change identically).
    if (fromOrig.toLowerCase() === toOrig.toLowerCase()) return '';
    // Compare case-insensitively on the ORIGINAL strings (ASCII only). Pre-lowercasing
    // the whole string can change its length (e.g. İ→i̇) and misalign the indices used
    // to slice the original-case result.
    const _lc = (c) => (c >= 65 && c <= 90) ? c + 32 : c;
    from = fromOrig;
    to = toOrig;
    let fromStart = 0;
    while (fromStart < from.length && from.charCodeAt(fromStart) === _CC_BSLASH) fromStart++;
    let fromEnd = from.length;
    while (fromEnd - 1 > fromStart && from.charCodeAt(fromEnd - 1) === _CC_BSLASH) fromEnd--;
    const fromLen = fromEnd - fromStart;
    let toStart = 0;
    while (toStart < to.length && to.charCodeAt(toStart) === _CC_BSLASH) toStart++;
    let toEnd = to.length;
    while (toEnd - 1 > toStart && to.charCodeAt(toEnd - 1) === _CC_BSLASH) toEnd--;
    const toLen = toEnd - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      const fromCode = from.charCodeAt(fromStart + i);
      if (_lc(fromCode) !== _lc(to.charCodeAt(toStart + i))) break;
      else if (fromCode === _CC_BSLASH) lastCommonSep = i;
    }
    if (i !== length) {
      if (lastCommonSep === -1) return toOrig;
    } else {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === _CC_BSLASH) return toOrig.slice(toStart + i + 1);
        if (i === 2) return toOrig.slice(toStart + i);
      }
      if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === _CC_BSLASH) lastCommonSep = i;
        else if (i === 2) lastCommonSep = 3;
      }
      if (lastCommonSep === -1) lastCommonSep = 0;
    }
    let out = '';
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === _CC_BSLASH) out += out.length === 0 ? '..' : '\\..';
    }
    toStart += lastCommonSep;
    if (out.length > 0) return out + toOrig.slice(toStart, toEnd);
    if (toOrig.charCodeAt(toStart) === _CC_BSLASH) ++toStart;
    return toOrig.slice(toStart, toEnd);
  },
};
win32.posix = null;
win32.win32 = win32;

function toNamespacedPath(p) { return p; }

// Translate a glob to a RegExp and test it. `*` stops at a separator, `**` crosses
// them, `?` is one non-separator char, `[...]`/`[!...]` are char classes/negation.
// On win32 both `\` and `/` count as separators.
function _matchesGlob(pathStr, glob, isWin) {
  validateString(pathStr, 'path');
  validateString(glob, 'pattern');
  const sep = isWin ? '[\\\\/]' : '/';
  const notSep = isWin ? '[^\\\\/]' : '[^/]';
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'; i++;
        if (glob[i + 1] === '/' || (isWin && glob[i + 1] === '\\')) i++;
      } else { re += notSep + '*'; }
    } else if (c === '?') {
      re += notSep;
    } else if (c === '[') {
      let j = i + 1, neg = false;
      if (glob[j] === '!' || glob[j] === '^') { neg = true; j++; }
      let cls = '';
      while (j < glob.length && glob[j] !== ']') { const cc = glob[j]; cls += '\\^]'.includes(cc) ? '\\' + cc : cc; j++; }
      re += '[' + (neg ? '^' : '') + cls + ']';
      i = j;
    } else if (c === '/' || (isWin && c === '\\')) {
      re += sep;
    } else {
      re += '.+^${}()|[]\\'.includes(c) ? '\\' + c : c;
    }
  }
  return new RegExp(re + '$').test(pathStr);
}
function matchesGlob(pathStr, glob) { return _matchesGlob(pathStr, glob, false); }
win32.matchesGlob = (pathStr, glob) => _matchesGlob(pathStr, glob, true);

module.exports = { resolve, normalize, isAbsolute, join, relative, dirname, basename, extname, parse, format, sep, delimiter, toNamespacedPath, matchesGlob, posix: null, win32 };
module.exports.posix = module.exports;
win32.posix = module.exports;
