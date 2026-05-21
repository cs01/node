// tls module — stub
'use strict';
const net = require('net');
module.exports = {
  createServer: () => { throw new Error('tls not implemented'); },
  connect: () => { throw new Error('tls not implemented'); },
  TLSSocket: class TLSSocket extends net.Socket {},
  Server: class Server extends net.Server {},
  DEFAULT_MIN_VERSION: 'TLSv1.2',
  DEFAULT_MAX_VERSION: 'TLSv1.3',
  DEFAULT_CIPHERS: '',
  rootCertificates: [],
};
