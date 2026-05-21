// timer globals + event loop — internal bootstrap module
'use strict';

const _tb = internalBinding('timers');
const _timerCallbacks = new Map();

class Timeout {
  constructor(id, fn, delay, args, repeat) {
    this._id = id;
    this._fn = fn;
    this._delay = delay;
    this._args = args;
    this._repeat = repeat;
    this._refed = true;
  }
  refresh() {
    _tb.clear(this._id);
    _timerCallbacks.delete(this._id);
    const wrapped = this._repeat
      ? () => this._fn(...this._args)
      : () => { _timerCallbacks.delete(this._id); this._fn(...this._args); };
    this._id = _tb.schedule(wrapped, Math.max(0, this._delay || 0), this._repeat ? 1 : 0);
    _timerCallbacks.set(this._id, wrapped);
    return this;
  }
  unref() { this._refed = false; return this; }
  ref() { this._refed = true; return this; }
  hasRef() { return this._refed; }
  close() { globalThis.clearTimeout(this); return this; }
  [Symbol.toPrimitive]() { return this._id; }
  [Symbol.dispose]() { globalThis.clearTimeout(this); }
}

globalThis.setTimeout = function(fn, delay, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  const t = new Timeout(0, fn, delay, args, false);
  const wrapped = () => { _timerCallbacks.delete(t._id); fn(...args); };
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 0);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearTimeout = function(t) {
  const id = t && typeof t === 'object' ? t._id : t;
  _timerCallbacks.delete(id);
  _tb.clear(id);
};

globalThis.setInterval = function(fn, delay, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  const t = new Timeout(0, fn, delay, args, true);
  const wrapped = () => fn(...args);
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 1);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearInterval = function(t) {
  const id = t && typeof t === 'object' ? t._id : t;
  _timerCallbacks.delete(id);
  _tb.clear(id);
};

if (typeof setImmediate === 'undefined') {
  globalThis.setImmediate = function(fn, ...args) { return setTimeout(fn, 0, ...args); };
  globalThis.clearImmediate = function(id) { clearTimeout(id); };
}

// Event loop — called from main.milo after script execution
// Integrates timer queue + kqueue I/O polling
globalThis.__runEventLoop = function() {
  let net = null;
  try { net = require('net'); } catch {}
  const poll = net && net._pollOnce;

  for (;;) {
    _tb.fireDue();
    _tb.drainMicrotasks();

    const hasTimers = _tb.hasPending();
    const hasIO = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
    if (!hasTimers && !hasIO) break;

    let waitMs = 100;
    if (hasTimers) {
      const ms = _tb.msUntilNext();
      if (ms >= 0) waitMs = Math.min(waitMs, ms);
    }

    // Prevent busy-spin when timers are immediately due
    if (waitMs < 1) waitMs = 1;

    if (poll) {
      poll(waitMs);
    } else {
      _tb.sleepMs(waitMs);
    }
  }
};

globalThis.__hasIO = function() {
  try {
    const net = require('net');
    return (net.Server._servers && net.Server._servers.size > 0) ||
           (net.Socket._sockets && net.Socket._sockets.size > 0) ||
           (net._fileWatchers && net._fileWatchers.size > 0);
  } catch { return false; }
};
