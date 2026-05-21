// dns module — stub
'use strict';

const notImpl = (name) => (...args) => {
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(new Error(`dns.${name} not implemented`));
};

module.exports = {
  lookup: notImpl('lookup'),
  resolve: notImpl('resolve'),
  resolve4: notImpl('resolve4'),
  resolve6: notImpl('resolve6'),
  resolveMx: notImpl('resolveMx'),
  resolveTxt: notImpl('resolveTxt'),
  resolveSrv: notImpl('resolveSrv'),
  resolveNs: notImpl('resolveNs'),
  resolveCname: notImpl('resolveCname'),
  reverse: notImpl('reverse'),
  setServers: () => {},
  getServers: () => [],
  NODATA: 'ENODATA', FORMERR: 'EFORMERR', SERVFAIL: 'ESERVFAIL',
  NOTFOUND: 'ENOTFOUND', NOTIMP: 'ENOTIMP', REFUSED: 'EREFUSED',
  BADQUERY: 'EBADQUERY', BADNAME: 'EBADNAME', BADFAMILY: 'EBADFAMILY',
  promises: {
    lookup: () => Promise.reject(new Error('dns.promises.lookup not implemented')),
    resolve: () => Promise.reject(new Error('dns.promises.resolve not implemented')),
  },
};
