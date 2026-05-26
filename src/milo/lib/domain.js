// domain module — error handling domains (deprecated but still tested)
'use strict';

const EventEmitter = require('events');

class Domain extends EventEmitter {
  constructor() {
    super();
    this.members = [];
    this._disposed = false;
  }

  add(emitter) {
    if (emitter.domain === this) return;
    if (emitter.domain) emitter.domain.remove(emitter);
    Object.defineProperty(emitter, 'domain', { value: this, writable: true, enumerable: false, configurable: true });
    this.members.push(emitter);
  }

  remove(emitter) {
    const idx = this.members.indexOf(emitter);
    if (idx >= 0) this.members.splice(idx, 1);
    Object.defineProperty(emitter, 'domain', { value: null, writable: true, enumerable: false, configurable: true });
  }

  run(fn, ...args) {
    this.enter();
    try { const r = fn.apply(this, args); return r; }
    catch (e) { this.emit('error', e); }
    finally { this.exit(); }
  }

  bind(fn) {
    return (...args) => {
      this.enter();
      try { return fn(...args); }
      catch (e) { this.emit('error', e); }
      finally { this.exit(); }
    };
  }

  intercept(fn) {
    return (err, ...args) => {
      if (err) { this.emit('error', err); return; }
      this.enter();
      try { return fn(...args); }
      catch (e) { this.emit('error', e); }
      finally { this.exit(); }
    };
  }

  enter() { exports.active = process.domain = this; }
  exit() { exports.active = process.domain = null; }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.removeAllListeners();
    this.members.forEach(m => this.remove(m));
    this.exit();
  }
}

function create() { return new Domain(); }

exports.Domain = Domain;
exports.create = create;
exports.createDomain = create;
exports.active = null;
