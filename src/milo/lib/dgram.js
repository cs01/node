// dgram module — stub
'use strict';
const EventEmitter = require('events');
class Socket extends EventEmitter {
  bind() { return this; }
  close(cb) { if (cb) cb(); this.emit('close'); }
  send() { throw new Error('dgram not implemented'); }
  address() { return { address: '0.0.0.0', port: 0, family: 'udp4' }; }
  setBroadcast() {}
  setTTL() {}
  setMulticastTTL() {}
  addMembership() {}
  dropMembership() {}
}
module.exports = {
  createSocket: (type) => new Socket(),
  Socket,
};
