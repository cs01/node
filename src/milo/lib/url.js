// url module — parse/resolve/format + WHATWG URL
'use strict';

function parse(urlStr, parseQueryString, slashesDenoteHost) {
  const result = {
    protocol: null, slashes: null, auth: null, host: null, port: null,
    hostname: null, hash: null, search: null, query: null, pathname: null,
    path: null, href: urlStr,
  };
  let rest = urlStr.trim();

  const protoMatch = rest.match(/^([a-z][a-z0-9.+-]*:)/i);
  if (protoMatch) {
    result.protocol = protoMatch[1].toLowerCase();
    rest = rest.slice(protoMatch[1].length);
  }

  if (result.protocol && rest.startsWith('//')) {
    result.slashes = true;
    rest = rest.slice(2);
    const hostEnd = rest.search(/[/?#]/);
    const hostPart = hostEnd >= 0 ? rest.slice(0, hostEnd) : rest;
    rest = hostEnd >= 0 ? rest.slice(hostEnd) : '';

    const atIdx = hostPart.lastIndexOf('@');
    if (atIdx >= 0) {
      result.auth = hostPart.slice(0, atIdx);
      const hp = hostPart.slice(atIdx + 1);
      result.host = hp;
    } else {
      result.host = hostPart;
    }

    const portMatch = result.host.match(/:(\d+)$/);
    if (portMatch) {
      result.port = portMatch[1];
      result.hostname = result.host.slice(0, -portMatch[0].length);
    } else {
      result.hostname = result.host;
    }
  }

  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    result.hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }

  const searchIdx = rest.indexOf('?');
  if (searchIdx >= 0) {
    result.search = rest.slice(searchIdx);
    result.query = result.search.slice(1);
    rest = rest.slice(0, searchIdx);
  }

  if (parseQueryString) {
    const qs = require('querystring');
    result.query = qs.parse(result.query || '');
  }

  result.pathname = rest || (result.slashes ? '/' : null);
  result.path = (result.pathname || '') + (result.search || '');
  result.href = format(result);

  return result;
}

function resolve(from, to) {
  return format(new URL(to, from));
}

function resolveObject(from, to) {
  if (typeof from === 'string') from = parse(from);
  const resolved = parse(to);
  if (resolved.protocol) return resolved;
  resolved.protocol = from.protocol;
  if (!resolved.host) {
    resolved.host = from.host;
    resolved.hostname = from.hostname;
    resolved.port = from.port;
    resolved.auth = from.auth;
  }
  resolved.href = format(resolved);
  return resolved;
}

function format(urlObj) {
  if (typeof urlObj === 'string') return urlObj;
  if (urlObj instanceof URL) return urlObj.href;
  let result = '';
  if (urlObj.protocol) result += urlObj.protocol;
  if (urlObj.slashes) result += '//';
  if (urlObj.auth) result += urlObj.auth + '@';
  if (urlObj.hostname) result += urlObj.hostname;
  if (urlObj.port) result += ':' + urlObj.port;
  if (urlObj.pathname) result += urlObj.pathname;
  if (urlObj.search) result += urlObj.search;
  if (urlObj.hash) result += urlObj.hash;
  return result;
}

function pathToFileURL(p) {
  if (typeof p !== 'string') { const e = new TypeError('The "path" argument must be of type string'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
  const path = require('path');
  let resolved = path.resolve(p);
  if (p.endsWith('/') || p.endsWith('\\')) resolved += '/';
  const encoded = resolved.split('/').map(s => encodeURIComponent(s)).join('/');
  return new URL('file://' + encoded);
}

function fileURLToPath(u) {
  const s = typeof u === 'string' ? u : u.href;
  if (!s.startsWith('file:')) throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(s.replace(/^file:\/\//, ''));
}

function urlToHttpOptions(url) {
  const u = typeof url === 'string' ? new URL(url) : url;
  return {
    protocol: u.protocol, hostname: u.hostname, port: u.port,
    path: u.pathname + u.search, hash: u.hash,
    auth: u.username ? u.username + (u.password ? ':' + u.password : '') : undefined,
  };
}

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Polyfill URLSearchParams.sort if missing (older V8 builds)
if (!URLSearchParams.prototype.sort) {
  URLSearchParams.prototype.sort = function() {
    const entries = [...this.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const keys = [...this.keys()];
    for (const k of keys) this.delete(k);
    for (const [k, v] of entries) this.append(k, v);
  };
}

module.exports = {
  URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams,
  parse, resolve, resolveObject, format, pathToFileURL, fileURLToPath, urlToHttpOptions,
  Url, domainToASCII: (d) => d, domainToUnicode: (d) => d,
};
