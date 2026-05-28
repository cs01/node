// querystring module
'use strict';

function escape(str) {
  try { return encodeURIComponent(str); }
  catch (e) { if (e instanceof URIError) e.code = 'ERR_INVALID_URI'; throw e; }
}
function unescape(str) {
  try { return decodeURIComponent(str.replace(/\+/g, ' ')); }
  catch {
    // Fallback: decode valid %XX sequences individually, leave invalid ones as-is
    return str.replace(/\+/g, ' ').replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

function _encodeVal(v) {
  if (typeof v === 'string') return escape(v);
  if (typeof v === 'number') return Number.isFinite(v) ? escape(String(v)) : '';
  if (typeof v === 'bigint') return escape(String(v));
  if (typeof v === 'boolean') return escape(String(v));
  return '';
}

function stringify(obj, sep, eq, opts) {
  sep = sep || '&';
  eq = eq || '=';
  const enc = (opts && opts.encodeURIComponent) || encodeURIComponent;
  const _esc = (s) => { try { return enc(s); } catch (e) { if (e instanceof URIError) e.code = 'ERR_INVALID_URI'; throw e; } };
  const _val = (v) => {
    if (typeof v === 'string') return _esc(v);
    if (typeof v === 'number') return Number.isFinite(v) ? _esc(String(v)) : '';
    if (typeof v === 'bigint') return _esc(String(v));
    if (typeof v === 'boolean') return _esc(String(v));
    return '';
  };
  if (!obj || typeof obj !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) { if (v.length > 0) parts.push(v.map(i => _esc(k) + eq + _val(i)).join(sep)); }
    else parts.push(_esc(k) + eq + _val(v));
  }
  return parts.join(sep);
}

function parse(str, sep, eq, opts) {
  sep = sep || '&';
  eq = eq || '=';
  let maxKeys = opts && typeof opts.maxKeys === 'number' ? opts.maxKeys : 1000;
  if (!Number.isFinite(maxKeys)) maxKeys = 0;
  const customDecode = opts && opts.decodeURIComponent;
  const _dec = (s) => {
    if (customDecode) {
      try { return customDecode(s); }
      catch { return module.exports.unescape(s); }
    }
    return module.exports.unescape(s);
  };
  const obj = Object.create(null);
  if (typeof str !== 'string' || str.length === 0) return obj;
  const pairs = str.split(sep);
  const len = maxKeys > 0 ? Math.min(pairs.length, maxKeys) : pairs.length;
  for (let i = 0; i < len; i++) {
    if (pairs[i].length === 0) continue;
    const idx = pairs[i].indexOf(eq);
    const k = idx >= 0 ? _dec(pairs[i].slice(0, idx)) : _dec(pairs[i]);
    const v = idx >= 0 ? _dec(pairs[i].slice(idx + eq.length)) : '';
    if (obj[k] !== undefined) {
      if (Array.isArray(obj[k])) obj[k].push(v);
      else obj[k] = [obj[k], v];
    } else obj[k] = v;
  }
  return obj;
}

function _hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

function unescapeBuffer(str, decodeSpaces) {
  const out = Buffer.allocUnsafe(str.length);
  let j = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 37 && i + 2 < str.length) {
      const h = _hexVal(str.charCodeAt(i + 1));
      const l = _hexVal(str.charCodeAt(i + 2));
      if (h >= 0 && l >= 0) { out[j++] = (h << 4) | l; i += 2; continue; }
    }
    if (decodeSpaces && ch === 43) { out[j++] = 32; continue; }
    out[j++] = ch;
  }
  return out.slice(0, j);
}

module.exports = { encode: stringify, decode: parse, stringify, parse, escape, unescape, unescapeBuffer };
