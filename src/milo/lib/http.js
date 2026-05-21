// http module — stub
'use strict';

const EventEmitter = require('events');

class IncomingMessage extends EventEmitter {
  constructor() { super(); this.headers = {}; this.method = 'GET'; this.url = '/'; this.statusCode = 200; }
}

class ServerResponse extends EventEmitter {
  constructor() { super(); this.statusCode = 200; this._headers = {}; this.finished = false; }
  setHeader(k, v) { this._headers[k.toLowerCase()] = v; }
  getHeader(k) { return this._headers[k.toLowerCase()]; }
  removeHeader(k) { delete this._headers[k.toLowerCase()]; }
  writeHead(code, headers) { this.statusCode = code; if (headers) for (const [k,v] of Object.entries(headers)) this.setHeader(k, v); }
  write(chunk) { return true; }
  end(chunk) { this.finished = true; this.emit('finish'); }
}

class Server extends EventEmitter {
  constructor(opts, handler) {
    super();
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    if (handler) this.on('request', handler);
    this._listening = false;
  }
  listen(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    this._listening = true;
    if (cb) Promise.resolve().then(cb);
    return this;
  }
  close(cb) { this._listening = false; if (cb) cb(); this.emit('close'); }
  address() { return { address: '127.0.0.1', port: 0, family: 'IPv4' }; }
}

class Agent {
  constructor(opts) { this.maxSockets = (opts && opts.maxSockets) || Infinity; }
  destroy() {}
}

const METHODS = ['GET','HEAD','POST','PUT','DELETE','CONNECT','OPTIONS','TRACE','PATCH'];
const STATUS_CODES = {200:'OK',201:'Created',204:'No Content',301:'Moved Permanently',302:'Found',304:'Not Modified',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',500:'Internal Server Error'};

module.exports = {
  createServer: (opts, handler) => new Server(opts, handler),
  request: () => { throw new Error('http.request not implemented'); },
  get: () => { throw new Error('http.get not implemented'); },
  Server, IncomingMessage, ServerResponse, Agent,
  globalAgent: new Agent(),
  METHODS, STATUS_CODES,
  maxHeaderSize: 16384,
};
