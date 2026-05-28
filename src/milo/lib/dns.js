// dns module — real hostname resolution via getaddrinfo
'use strict';

const b = internalBinding('dns');

function lookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  if (typeof options === 'number') options = { family: options };
  if (typeof hostname !== 'string' && hostname != null) throw _ERR_INVALID_ARG_TYPE('hostname', 'string', hostname);
  const opts = options || {};
  const family = opts.family || 0;

  // Synchronous lookup via C getaddrinfo — run on next tick to match Node.js async API
  process.nextTick(() => {
    const result = b.lookup(hostname, family);
    if (result === -1 || typeof result !== 'object') {
      const err = new Error('getaddrinfo ENOTFOUND ' + hostname);
      err.code = 'ENOTFOUND';
      err.hostname = hostname;
      if (cb) cb(err);
      return;
    }
    if (cb) cb(null, result.address, result.family);
  });
}

// DNS record type codes
const RR_TYPES = { A: 1, AAAA: 28, MX: 15, TXT: 16, SRV: 33, NS: 2, CNAME: 5, PTR: 12 };

function _queryRecords(hostname, rrtype, cb) {
  const rrtypeNum = RR_TYPES[rrtype];
  if (!rrtypeNum) return process.nextTick(() => cb(new Error('Unknown rrtype: ' + rrtype)));

  process.nextTick(() => {
    const raw = b.query(hostname, rrtypeNum);
    if (typeof raw === 'number' || raw === -1) {
      const err = new Error('queryRecords ENODATA ' + hostname);
      err.code = 'ENODATA';
      return cb(err);
    }
    if (!raw || raw.length === 0) return cb(null, []);

    const lines = raw.split('\n').filter(l => l.length > 0);
    let results;
    if (rrtype === 'MX') {
      results = lines.map(l => {
        const parts = l.split(' ');
        return { priority: parseInt(parts[0], 10), exchange: parts.slice(1).join(' ') };
      });
    } else if (rrtype === 'SRV') {
      results = lines.map(l => {
        const parts = l.split(' ');
        return { priority: parseInt(parts[0], 10), weight: parseInt(parts[1], 10), port: parseInt(parts[2], 10), name: parts.slice(3).join(' ') };
      });
    } else if (rrtype === 'TXT') {
      results = lines.map(l => [l]);
    } else {
      results = lines;
    }
    cb(null, results);
  });
}

function resolve(hostname, rrtype, cb) {
  if (typeof rrtype === 'function') { cb = rrtype; rrtype = 'A'; }
  if (typeof hostname !== 'string') {
    const v = hostname === undefined ? 'undefined' : hostname === null ? 'null' : 'an instance of ' + ((hostname.constructor && hostname.constructor.name) || 'Object');
    const e = new TypeError('The "name" argument must be of type string. Received ' + v);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (typeof rrtype !== 'string') {
    const v = rrtype === undefined ? 'undefined' : rrtype === null ? 'null' : 'an instance of ' + ((rrtype.constructor && rrtype.constructor.name) || 'Object');
    const e = new TypeError('The "rrtype" argument must be of type string. Received ' + v);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (rrtype === 'A' || rrtype === 'AAAA') {
    const family = rrtype === 'AAAA' ? 6 : 4;
    lookup(hostname, { family }, (err, address) => {
      if (err) return cb(err);
      cb(null, [address]);
    });
  } else {
    _queryRecords(hostname, rrtype, cb);
  }
}

const NODATA = 'ENODATA', FORMERR = 'EFORMERR', SERVFAIL = 'ESERVFAIL',
      NOTFOUND = 'ENOTFOUND', NOTIMP = 'ENOTIMP', REFUSED = 'EREFUSED',
      BADQUERY = 'EBADQUERY', BADNAME = 'EBADNAME', BADFAMILY = 'EBADFAMILY',
      BADRESP = 'EBADRESP', CONNREFUSED = 'ECONNREFUSED', TIMEOUT = 'ETIMEOUT',
      EOF = 'EOF', FILE = 'EFILE', NOMEM = 'ENOMEM', DESTRUCTION = 'EDESTRUCTION',
      BADSTR = 'EBADSTR', BADFLAGS = 'EBADFLAGS', NONAME = 'ENONAME',
      BADHINTS = 'EBADHINTS', NOTINITIALIZED = 'ENOTINITIALIZED',
      LOADIPHLPAPI = 'ELOADIPHLPAPI', ADDRGETNETWORKPARAMS = 'EADDRGETNETWORKPARAMS',
      CANCELLED = 'ECANCELLED';

function _promisify(fn) {
  return (...args) => new Promise((resolve, reject) => {
    fn(...args, (err, result) => err ? reject(err) : resolve(result));
  });
}

const promises = {
  lookup: (hostname, options) => new Promise((resolve, reject) => {
    lookup(hostname, options || {}, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  }),
  resolve: (hostname, rrtype) => {
    if (typeof hostname !== 'string') {
      const v = hostname === undefined ? 'undefined' : hostname === null ? 'null' : 'an instance of ' + ((hostname.constructor && hostname.constructor.name) || 'Object');
      const e = new TypeError('The "name" argument must be of type string. Received ' + v);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    return new Promise((resolve, reject) => {
    dns.resolve(hostname, rrtype || 'A', (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  }); },
  resolve4: _promisify((h, cb) => dns.resolve4(h, cb)),
  resolve6: _promisify((h, cb) => dns.resolve6(h, cb)),
  resolveMx: _promisify((h, cb) => dns.resolveMx(h, cb)),
  resolveTxt: _promisify((h, cb) => dns.resolveTxt(h, cb)),
  resolveSrv: _promisify((h, cb) => dns.resolveSrv(h, cb)),
  resolveNs: _promisify((h, cb) => dns.resolveNs(h, cb)),
  resolveCname: _promisify((h, cb) => dns.resolveCname(h, cb)),
  resolvePtr: _promisify((h, cb) => dns.resolvePtr(h, cb)),
  lookupService: _promisify((addr, port, cb) => dns.lookupService(addr, port, cb)),
  NODATA, FORMERR, SERVFAIL, NOTFOUND, NOTIMP, REFUSED, BADQUERY, BADNAME, BADFAMILY,
  BADRESP, CONNREFUSED, TIMEOUT, EOF, FILE, NOMEM, DESTRUCTION, BADSTR, BADFLAGS,
  NONAME, BADHINTS, NOTINITIALIZED, LOADIPHLPAPI, ADDRGETNETWORKPARAMS, CANCELLED,
  Resolver: class PromiseResolver {
    constructor(options) { this._r = new Resolver(options); }
    cancel() { this._r.cancel(); }
    setLocalAddress(ipv4, ipv6) { this._r.setLocalAddress(ipv4, ipv6); }
    getServers() { return this._r.getServers(); }
    setServers(servers) { this._r.setServers(servers); }
    resolve(hostname, rrtype) { return _promisify((h, r, cb) => this._r.resolve(h, r, cb))(hostname, rrtype || 'A'); }
    resolve4(h, opts) { return _promisify((h2, cb) => this._r.resolve4(h2, cb))(h); }
    resolve6(h, opts) { return _promisify((h2, cb) => this._r.resolve6(h2, cb))(h); }
    reverse(ip) { return _promisify((i, cb) => this._r.reverse(i, cb))(ip); }
  },
};

class Resolver {
  constructor(options) {
    this._servers = null;
    if (options && options.timeout !== undefined) {
      if (typeof options.timeout !== 'number') {
        const e = new TypeError('The "options.timeout" property must be of type number. Received type ' + typeof options.timeout + (typeof options.timeout === 'string' ? " ('" + options.timeout + "')" : ' (' + String(options.timeout) + ')'));
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      if (options.timeout < -1 || !Number.isInteger(options.timeout) || options.timeout > 2147483647) {
        const e = new RangeError('The value of "options.timeout" is out of range. It must be >= -1 && <= 2147483647. Received ' + options.timeout);
        e.code = 'ERR_OUT_OF_RANGE'; throw e;
      }
      this._timeout = options.timeout;
    }
  }
  cancel() {}
  setLocalAddress(ipv4, ipv6) {}
  getServers() { return dns.getServers(); }
  setServers(servers) { dns.setServers(servers); this._servers = servers; }
  resolve(hostname, rrtype, cb) { return resolve(hostname, rrtype, cb); }
  resolve4(h, opts, cb) { if (typeof opts === 'function') { cb = opts; } resolve(h, 'A', cb); }
  resolve6(h, opts, cb) { if (typeof opts === 'function') { cb = opts; } resolve(h, 'AAAA', cb); }
  resolveMx(h, cb) { _queryRecords(h, 'MX', cb); }
  resolveTxt(h, cb) { _queryRecords(h, 'TXT', cb); }
  resolveSrv(h, cb) { _queryRecords(h, 'SRV', cb); }
  resolveNs(h, cb) { _queryRecords(h, 'NS', cb); }
  resolveCname(h, cb) { _queryRecords(h, 'CNAME', cb); }
  resolvePtr(h, cb) { _queryRecords(h, 'PTR', cb); }
  reverse(ip, cb) { dns.reverse(ip, cb); }
}

const dns = {
  lookup, resolve, Resolver,
  resolve4: (h, cb) => resolve(h, 'A', cb),
  resolve6: (h, cb) => resolve(h, 'AAAA', cb),
  resolveMx: (h, cb) => _queryRecords(h, 'MX', cb),
  resolveTxt: (h, cb) => _queryRecords(h, 'TXT', cb),
  resolveSrv: (h, cb) => _queryRecords(h, 'SRV', cb),
  resolveNs: (h, cb) => _queryRecords(h, 'NS', cb),
  resolveCname: (h, cb) => _queryRecords(h, 'CNAME', cb),
  resolvePtr: (h, cb) => _queryRecords(h, 'PTR', cb),
  reverse: (ip, cb) => process.nextTick(() => {
    const result = b.reverse(ip);
    if (result === -1 || typeof result !== 'string') {
      const err = new Error('getHostByAddr ENOTFOUND ' + ip);
      err.code = 'ENOTFOUND';
      cb(err);
    } else {
      cb(null, [result]);
    }
  }),
  setServers: (servers) => {
    if (!Array.isArray(servers)) throw new TypeError('The "servers" argument must be an instance of Array');
    const newServers = [];
    for (let i = 0; i < servers.length; i++) {
      if (!(i in servers)) continue;
      const s = servers[i];
      if (typeof s !== 'string') continue;
      // strip brackets and port for validation
      let addr = s;
      let port = null;
      if (addr.startsWith('[')) {
        const ci = addr.indexOf(']');
        if (ci > 0) {
          const rest = addr.substring(ci + 1);
          addr = addr.substring(1, ci);
          if (rest.startsWith(':')) port = rest.substring(1);
        } else {
          addr = addr.substring(1);
        }
      } else {
        const li = addr.lastIndexOf(':');
        if (li > 0 && !addr.includes(':', li + 1)) {
          port = addr.substring(li + 1);
          addr = addr.substring(0, li);
        }
      }
      const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(addr);
      const isV6 = /^[a-fA-F0-9:]+$/.test(addr) && addr.includes(':');
      if ((!isV4 && !isV6) || (port !== null && !/^\d+$/.test(port))) {
        const e = new TypeError(`Invalid IP address: ${s}`);
        e.code = 'ERR_INVALID_IP_ADDRESS'; throw e;
      }
      newServers.push(s);
    }
    dns._servers = newServers;
  },
  getServers: () => {
    if (dns._servers) return dns._servers.map(s => {
      if (s.startsWith('[')) {
        const ci = s.indexOf(']');
        if (ci > 0) {
          const rest = s.substring(ci + 1);
          const addr = s.substring(1, ci);
          if (rest === '' || rest === ':53') return addr;
        }
      } else if (!s.includes(':')) return s;
      else {
        const li = s.lastIndexOf(':');
        const port = s.substring(li + 1);
        if (port === '53') return s.substring(0, li);
      }
      return s;
    });
    // Read from /etc/resolv.conf on first call
    try {
      const fs = require('fs');
      const content = fs.readFileSync('/etc/resolv.conf', 'utf8');
      const servers = [];
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*nameserver\s+(\S+)/);
        if (m) servers.push(m[1]);
      }
      dns._servers = servers;
      return servers.slice();
    } catch {
      return [];
    }
  },
  ADDRCONFIG: 0, V4MAPPED: 0, ALL: 0,
  NODATA, FORMERR, SERVFAIL, NOTFOUND, NOTIMP, REFUSED, BADQUERY, BADNAME, BADFAMILY,
  BADRESP, CONNREFUSED, TIMEOUT, EOF, FILE, NOMEM, DESTRUCTION, BADSTR, BADFLAGS,
  NONAME, BADHINTS, NOTINITIALIZED, LOADIPHLPAPI, ADDRGETNETWORKPARAMS, CANCELLED,
  lookupService: (address, port, cb) => {
    if (typeof address !== 'string') {
      const e = new TypeError('The "address" argument must be of type string. Received ' + (address === undefined ? 'undefined' : typeof address));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (arguments.length < 3) {
      const e = new TypeError('The "address", "port", and "callback" arguments must be specified');
      e.code = 'ERR_MISSING_ARGS'; throw e;
    }
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
      const e = new RangeError('The value of "port" is out of range');
      e.code = 'ERR_SOCKET_BAD_PORT'; throw e;
    }
    if (!/^[\d.]+$/.test(address) && !/^[a-fA-F0-9:]+$/.test(address)) {
      const e = new TypeError("The argument 'address' is invalid. Received '" + address + "'");
      e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
    }
    const result = b.reverseLookup ? b.reverseLookup(address) : address;
    process.nextTick(cb, null, result, String(port));
  },
  promises,
};
module.exports = dns;
