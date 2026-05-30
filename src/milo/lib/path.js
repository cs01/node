// path module — POSIX path manipulation (macOS only, no win32)
'use strict';

const SLASH = 47;  // '/'
const DOT = 46;    // '.'

function validateString(value, name) {
  if (typeof value !== 'string') throw _ERR_INVALID_ARG_TYPE(name, 'string', value);
}

function validateObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw _ERR_INVALID_ARG_TYPE(name, 'object', value);
  }
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
  validateObject(pathObject, 'pathObject');
  const dir = pathObject.dir || pathObject.root || '';
  const ext = pathObject.ext;
  const base = pathObject.base || (pathObject.name || '') + (ext ? (ext[0] === '.' ? '' : '.') + ext : '');
  if (!dir) return base;
  return dir === pathObject.root ? dir + base : dir + '/' + base;
}

const sep = '/';
const delimiter = ':';

// --- win32 path internals (faithful port of Node's lib/path.js win32) ---
const _CC_DOT = 46, _CC_FSLASH = 47, _CC_BSLASH = 92, _CC_COLON = 58, _CC_QMARK = 63;
function _winIsSep(c) { return c === _CC_FSLASH || c === _CC_BSLASH; }
function _isPosixSep(c) { return c === _CC_FSLASH; }
function _isWinDeviceRoot(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
// Reserved DOS device names — paths like CON:.. must NOT be normalized away (CVE).
const _WIN_RESERVED = ['CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'COM\xb9', 'COM\xb2', 'COM\xb3', 'LPT\xb9', 'LPT\xb2', 'LPT\xb3'];
function _isWinReserved(path, colonIndex) {
  return _WIN_RESERVED.includes(path.slice(0, colonIndex).toUpperCase());
}
// lastSegmentLength is tracked across iterations so the parent slice uses
// res.length - lastSegmentLength - 1 (NOT lastIndexOf) — matches Node exactly.
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
            const lsi = res.length - lastSegmentLength - 1;
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
              if (j === len || j !== last) {
                if (firstPart !== '.' && firstPart !== '?') {
                  device = '\\\\' + firstPart + '\\' + path.slice(last, j); rootEnd = j;
                } else {
                  // device root e.g. \\.\PHYSICALDRIVE0 — keep \\. or \\? as device, rest is tail
                  device = '\\\\' + firstPart; rootEnd = 4;
                }
              }
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
    if (len === 1) return _isPosixSep(code) ? '\\' : path;
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
            if (j === len || j !== last) {
              if (firstPart === '.' || firstPart === '?') {
                device = '\\\\' + firstPart; rootEnd = 4;
                const colonIndex = path.indexOf(':');
                const possibleDevice = path.slice(4, colonIndex + 1);
                if (_isWinReserved(possibleDevice, possibleDevice.length - 1)) {
                  device = '\\\\?\\' + possibleDevice; rootEnd = 4 + possibleDevice.length;
                }
              } else if (j === len) {
                return '\\\\' + firstPart + '\\' + path.slice(last) + '\\';
              } else {
                device = '\\\\' + firstPart + '\\' + path.slice(last, j); rootEnd = j;
              }
            }
          }
        }
      } else { rootEnd = 1; }
    } else {
      const colonIndex = path.indexOf(':');
      if (colonIndex > 0) {
        if (_isWinDeviceRoot(code) && colonIndex === 1) {
          device = path.slice(0, 2); rootEnd = 2;
          if (len > 2 && _winIsSep(path.charCodeAt(2))) { isAbsolute = true; rootEnd = 3; }
        } else if (_isWinReserved(path, colonIndex)) {
          device = path.slice(0, colonIndex + 1); rootEnd = colonIndex + 1;
        }
      }
    }
    let tail = rootEnd < len ? _winNormalizeString(path.slice(rootEnd), !isAbsolute) : '';
    if (tail.length === 0 && !isAbsolute) tail = '.';
    if (tail.length > 0 && _winIsSep(path.charCodeAt(len - 1))) tail += '\\';
    if (!isAbsolute && device === undefined && path.includes(':')) {
      // CVE-2024-36139: a relative path that normalized to something Windows
      // could read as absolute (drive letter or colon-segment) must be neutralized.
      if (tail.length >= 2 && _isWinDeviceRoot(tail.charCodeAt(0)) && tail.charCodeAt(1) === _CC_COLON) {
        return '.\\' + tail;
      }
      let index = path.indexOf(':');
      do {
        if (index === len - 1 || _winIsSep(path.charCodeAt(index + 1))) return '.\\' + tail;
      } while ((index = path.indexOf(':', index + 1)) !== -1);
    }
    const colonIndex = path.indexOf(':');
    if (_isWinReserved(path, colonIndex)) return '.\\' + (device ?? '') + tail;
    if (device === undefined) return isAbsolute ? '\\' + tail : tail;
    return isAbsolute ? device + '\\' + tail : device + tail;
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
    // A reserved device name segment (CON:, COM1:, ...) must survive verbatim —
    // normalize would strip the colon-segment and enable path traversal (CVE).
    const parts = [];
    let part = '';
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === '\\') {
        if (part) parts.push(part);
        part = '';
        while (i + 1 < joined.length && joined[i + 1] === '\\') i++;
      } else { part += joined[i]; }
    }
    if (part) parts.push(part);
    if (parts.some((p) => { const ci = p.indexOf(':'); return ci !== -1 && _isWinReserved(p, ci); })) {
      let result = '';
      for (let i = 0; i < joined.length; i++) result += joined[i] === '/' ? '\\' : joined[i];
      return result;
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
    const len = p.length;
    let rootEnd = 0;
    let code = p.charCodeAt(0);
    if (len === 1) {
      if (_winIsSep(code)) { ret.root = ret.dir = p; return ret; }
      ret.base = ret.name = p; return ret;
    }
    if (_winIsSep(code)) {
      rootEnd = 1;
      if (_winIsSep(p.charCodeAt(1))) {
        // UNC root \\server\share — root spans both components
        let j = 2, last = j;
        while (j < len && !_winIsSep(p.charCodeAt(j))) j++;
        if (j < len && j !== last) {
          last = j;
          while (j < len && _winIsSep(p.charCodeAt(j))) j++;
          if (j < len && j !== last) {
            last = j;
            while (j < len && !_winIsSep(p.charCodeAt(j))) j++;
            if (j === len) rootEnd = j;
            else if (j !== last) rootEnd = j + 1;
          }
        }
      }
    } else if (_isWinDeviceRoot(code) && p.charCodeAt(1) === _CC_COLON) {
      if (len <= 2) { ret.root = ret.dir = p; return ret; }
      rootEnd = 2;
      if (_winIsSep(p.charCodeAt(2))) {
        if (len === 3) { ret.root = ret.dir = p; return ret; }
        rootEnd = 3;
      }
    }
    if (rootEnd > 0) ret.root = p.slice(0, rootEnd);
    let startDot = -1, startPart = rootEnd, end = -1, matchedSlash = true, preDotState = 0;
    for (let i = len - 1; i >= rootEnd; i--) {
      code = p.charCodeAt(i);
      if (_winIsSep(code)) { if (!matchedSlash) { startPart = i + 1; break; } continue; }
      if (end < 0) { matchedSlash = false; end = i + 1; }
      if (code === _CC_DOT) { if (startDot < 0) startDot = i; else if (preDotState !== 1) preDotState = 1; }
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
    if (startPart > 0 && startPart !== rootEnd) ret.dir = p.slice(0, startPart - 1);
    else ret.dir = ret.root;
    return ret;
  },
  format(o) {
    validateObject(o, 'pathObject');
    const dir = o.dir || o.root || '';
    const base = o.base || (o.name || '') + (o.ext ? (o.ext[0] === '.' ? '' : '.') + o.ext : '');
    if (!dir) return base;
    return dir === o.root ? dir + base : dir + '\\' + base;
  },
  toNamespacedPath(p) {
    if (typeof p !== 'string' || p.length === 0) return p;
    const rp = win32.resolve(p);
    if (rp.length <= 2) return p;
    if (rp.charCodeAt(0) === _CC_BSLASH) {
      if (rp.charCodeAt(1) === _CC_BSLASH) {
        const code = rp.charCodeAt(2);
        if (code !== _CC_QMARK && code !== _CC_DOT) return '\\\\?\\UNC\\' + rp.slice(2);
      }
    } else if (_isWinDeviceRoot(rp.charCodeAt(0)) && rp.charCodeAt(1) === _CC_COLON && rp.charCodeAt(2) === _CC_BSLASH) {
      return '\\\\?\\' + rp;
    }
    return rp;
  },
  relative(from, to) {
    validateString(from, 'from'); validateString(to, 'to');
    if (from === to) return '';
    const fromOrig = win32.resolve(from);
    const toOrig = win32.resolve(to);
    if (fromOrig === toOrig) return '';
    from = fromOrig.toLowerCase();
    to = toOrig.toLowerCase();
    if (from === to) return '';
    // Unicode case-folding can change string length (e.g. İ→i̇), misaligning
    // byte indices used to slice the original-case result. Fall back to a
    // segment-split comparison in that case.
    if (fromOrig.length !== from.length || toOrig.length !== to.length) {
      const fromSplit = fromOrig.split('\\');
      const toSplit = toOrig.split('\\');
      if (fromSplit[fromSplit.length - 1] === '') fromSplit.pop();
      if (toSplit[toSplit.length - 1] === '') toSplit.pop();
      const fLen = fromSplit.length, tLen = toSplit.length;
      const lengthS = fLen < tLen ? fLen : tLen;
      let k;
      for (k = 0; k < lengthS; k++) {
        if (fromSplit[k].toLowerCase() !== toSplit[k].toLowerCase()) break;
      }
      if (k === 0) return toOrig;
      if (k === lengthS) {
        if (tLen > lengthS) return toSplit.slice(k).join('\\');
        if (fLen > lengthS) return '..\\'.repeat(fLen - 1 - k) + '..';
        return '';
      }
      return '..\\'.repeat(fLen - k) + toSplit.slice(k).join('\\');
    }
    // from/to remain lowercased here; output slices come from *Orig (original case).
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
      if (fromCode !== to.charCodeAt(toStart + i)) break;
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
