// dns module — real hostname resolution via getaddrinfo
'use strict';

const b = internalBinding('dns');

function lookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  if (typeof options === 'number') options = { family: options };
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

function resolve(hostname, rrtype, cb) {
  if (typeof rrtype === 'function') { cb = rrtype; rrtype = 'A'; }
  if (rrtype === 'A' || rrtype === 'AAAA') {
    const family = rrtype === 'AAAA' ? 6 : 4;
    lookup(hostname, { family }, (err, address) => {
      if (err) return cb(err);
      cb(null, [address]);
    });
  } else {
    process.nextTick(() => cb(null, []));
  }
}

const NODATA = 'ENODATA', FORMERR = 'EFORMERR', SERVFAIL = 'ESERVFAIL',
      NOTFOUND = 'ENOTFOUND', NOTIMP = 'ENOTIMP', REFUSED = 'EREFUSED',
      BADQUERY = 'EBADQUERY', BADNAME = 'EBADNAME', BADFAMILY = 'EBADFAMILY';

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
};

const dns = {
  lookup, resolve,
  resolve4: (h, cb) => resolve(h, 'A', cb),
  resolve6: (h, cb) => resolve(h, 'AAAA', cb),
  resolveMx: (h, cb) => process.nextTick(() => cb(null, [])),
  resolveTxt: (h, cb) => process.nextTick(() => cb(null, [])),
  resolveSrv: (h, cb) => process.nextTick(() => cb(null, [])),
  resolveNs: (h, cb) => process.nextTick(() => cb(null, [])),
  resolveCname: (h, cb) => process.nextTick(() => cb(null, [])),
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
  setServers: () => {},
  getServers: () => [],
  NODATA, FORMERR, SERVFAIL, NOTFOUND, NOTIMP, REFUSED, BADQUERY, BADNAME, BADFAMILY,
  promises,
};
module.exports = dns;
