// dgram module — UDP sockets via kqueue + sendto/recvfrom
'use strict';

const EventEmitter = require('events');
const tcp = internalBinding('tcp');
const net = require('net');

class Socket extends EventEmitter {
  constructor(type, listener) {
    super();
    this.type = type || 'udp4';
    this._fd = -1;
    this._bound = false;
    this._receiving = false;
    if (listener) this.on('message', listener);
  }

  bind(port, address, cb) {
    if (typeof port === 'object') {
      const opts = port;
      cb = address;
      port = opts.port;
      address = opts.address;
    }
    if (typeof address === 'function') { cb = address; address = undefined; }

    this._fd = tcp.udpSocket();
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('socket() failed')));
      return this;
    }

    const host = address || '0.0.0.0';
    const r = tcp.udpBind(this._fd, port || 0, host);
    if (r < 0) {
      process.nextTick(() => this.emit('error', new Error('bind failed')));
      return this;
    }

    this._bound = true;
    this._startReceiving();

    const addr = this.address();
    if (cb) process.nextTick(cb);
    process.nextTick(() => this.emit('listening'));
    return this;
  }

  _startReceiving() {
    if (this._receiving) return;
    this._receiving = true;
    net._ensurePoll();

    const self = this;
    const pipeObj = {
      _fd: this._fd,
      destroyed: false,
      _onReadable() {
        for (;;) {
          const result = tcp.udpRecv(self._fd);
          if (!result) break;
          self.emit('message', Buffer.from(result.data), result.rinfo);
        }
      }
    };

    net.Socket._sockets.set(this._fd, pipeObj);
    tcp.pollAdd(this._fd, tcp.EVFILT_READ);
    this._pipeObj = pipeObj;
  }

  send(msg, offset, length, port, address, cb) {
    // Handle flexible arguments: send(msg, port, address, cb)
    if (typeof offset === 'number' && typeof length === 'number' && typeof port === 'number') {
      // send(msg, offset, length, port, address, cb)
      msg = typeof msg === 'string' ? msg.substring(offset, offset + length) : msg.slice(offset, offset + length);
    } else {
      // send(msg, port, address, cb)
      cb = address;
      address = port;
      port = offset;
      // offset/length not used
    }

    if (typeof address === 'function') { cb = address; address = undefined; }
    address = address || '127.0.0.1';

    if (!this._bound) {
      this._fd = tcp.udpSocket();
      if (this._fd < 0) {
        if (cb) cb(new Error('socket() failed'));
        return;
      }
    }

    const str = typeof msg === 'string' ? msg : msg.toString();
    const n = tcp.udpSend(this._fd, str, port, address);
    if (cb) process.nextTick(() => cb(n < 0 ? new Error('send failed') : null));
  }

  close(cb) {
    if (this._fd >= 0) {
      if (this._receiving) {
        net.Socket._sockets.delete(this._fd);
      }
      tcp.close(this._fd);
      this._fd = -1;
    }
    this._bound = false;
    this._receiving = false;
    if (cb) this.once('close', cb);
    process.nextTick(() => this.emit('close'));
    return this;
  }

  address() {
    if (this._fd < 0) return { address: '0.0.0.0', port: 0, family: 'udp4' };
    const info = tcp.getSockName(this._fd);
    return { address: info.address, port: info.port, family: 'IPv4' };
  }

  setBroadcast(flag) { if (this._fd >= 0) tcp.udpSetOpt(this._fd, 1, flag ? 1 : 0); }
  setTTL(ttl) { if (this._fd >= 0) tcp.udpSetOpt(this._fd, 2, ttl); }
  setMulticastTTL(ttl) { if (this._fd >= 0) tcp.udpSetOpt(this._fd, 3, ttl); }
  addMembership(mcast, iface) { if (this._fd >= 0) tcp.udpAddMembership(this._fd, mcast, iface || ''); }
  dropMembership(mcast, iface) { if (this._fd >= 0) tcp.udpDropMembership(this._fd, mcast, iface || ''); }
  setMulticastLoopback() {}
  ref() { return this; }
  unref() { return this; }
  setRecvBufferSize() {}
  setSendBufferSize() {}
  getRecvBufferSize() { return 65536; }
  getSendBufferSize() { return 65536; }
  remoteAddress() { return {}; }
}

function createSocket(options, listener) {
  if (typeof options === 'string') options = { type: options };
  return new Socket(options.type, listener);
}

module.exports = { createSocket, Socket };
