// net module — stub for test/common compatibility
'use strict';
module.exports = {
  setDefaultAutoSelectFamilyAttemptTimeout: () => {},
  getDefaultAutoSelectFamilyAttemptTimeout: () => 5000,
  createServer: () => { throw new Error('net not implemented'); },
  connect: () => { throw new Error('net not implemented'); },
  Socket: class Socket {},
  Server: class Server {},
  isIP: (s) => { if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return 4; if (s.includes(':')) return 6; return 0; },
  isIPv4: (s) => /^\d+\.\d+\.\d+\.\d+$/.test(s),
  isIPv6: (s) => s.includes(':'),
};
