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
      BADQUERY = 'EBADQUERY', BADNAME = 'EBADNAME', BADFAMILY = 'EBADFAMILY';

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
  resolve: (hostname, rrtype) => new Promise((resolve, reject) => {
    dns.resolve(hostname, rrtype || 'A', (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  }),
  resolve4: _promisify((h, cb) => dns.resolve4(h, cb)),
  resolve6: _promisify((h, cb) => dns.resolve6(h, cb)),
  resolveMx: _promisify((h, cb) => dns.resolveMx(h, cb)),
  resolveTxt: _promisify((h, cb) => dns.resolveTxt(h, cb)),
  resolveSrv: _promisify((h, cb) => dns.resolveSrv(h, cb)),
  resolveNs: _promisify((h, cb) => dns.resolveNs(h, cb)),
  resolveCname: _promisify((h, cb) => dns.resolveCname(h, cb)),
  resolvePtr: _promisify((h, cb) => dns.resolvePtr(h, cb)),
};

const dns = {
  lookup, resolve,
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
      if (addr.startsWith('[')) {
        const ci = addr.indexOf(']');
        addr = ci > 0 ? addr.substring(1, ci) : addr.substring(1);
      } else {
        // strip trailing :port for IPv4
        const li = addr.lastIndexOf(':');
        if (li > 0 && !addr.includes(':', li + 1)) addr = addr.substring(0, li);
      }
      // basic check — must look like IP
      if (!/^[\d.:a-fA-F]+$/.test(addr)) {
        const e = new TypeError(`Invalid IP address: ${s}`);
        e.code = 'ERR_INVALID_IP_ADDRESS'; throw e;
      }
      newServers.push(s);
    }
    dns._servers = newServers;
  },
  getServers: () => {
    if (dns._servers) return dns._servers.slice();
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
  promises,
};
module.exports = dns;
