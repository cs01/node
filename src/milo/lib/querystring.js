// querystring module
'use strict';

function escape(str) { return encodeURIComponent(str); }
function unescape(str) { return decodeURIComponent(str.replace(/\+/g, ' ')); }

function stringify(obj, sep, eq) {
  sep = sep || '&';
  eq = eq || '=';
  if (!obj || typeof obj !== 'object') return '';
  return Object.keys(obj).map(k => {
    const v = obj[k];
    if (Array.isArray(v)) return v.map(i => escape(k) + eq + escape(String(i))).join(sep);
    return escape(k) + eq + escape(String(v));
  }).join(sep);
}

function parse(str, sep, eq, opts) {
  sep = sep || '&';
  eq = eq || '=';
  const maxKeys = (opts && opts.maxKeys) || 1000;
  const obj = Object.create(null);
  if (typeof str !== 'string' || str.length === 0) return obj;
  const pairs = str.split(sep);
  const len = maxKeys > 0 ? Math.min(pairs.length, maxKeys) : pairs.length;
  for (let i = 0; i < len; i++) {
    const idx = pairs[i].indexOf(eq);
    const k = idx >= 0 ? unescape(pairs[i].slice(0, idx)) : unescape(pairs[i]);
    const v = idx >= 0 ? unescape(pairs[i].slice(idx + eq.length)) : '';
    if (obj[k] !== undefined) {
      if (Array.isArray(obj[k])) obj[k].push(v);
      else obj[k] = [obj[k], v];
    } else obj[k] = v;
  }
  return obj;
}

module.exports = { encode: stringify, decode: parse, stringify, parse, escape, unescape };
