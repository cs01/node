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

function _safeCall(fn, args) {
  try { fn(...args); }
  catch (e) {
    const handlers = process.listeners && process.listeners('uncaughtException');
    if (handlers && handlers.length > 0) process.emit('uncaughtException', e);
    else throw e;
  }
}

globalThis.setTimeout = function(fn, delay, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  const t = new Timeout(0, fn, delay, args, false);
  const wrapped = () => { _timerCallbacks.delete(t._id); _safeCall(fn, args); };
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
  const wrapped = () => _safeCall(fn, args);
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
// Event loop utilization tracking (millisecond precision via Date.now)
let _eluIdleMs = 0;
let _eluActiveMs = 0;
const _now = Date.now;

globalThis.__runEventLoop = function() {
  let net = null;
  try { net = require('net'); } catch {}
  const poll = net && net._pollOnce;

  for (;;) {
    const tickStart = _now();
    if (process._tickCallback) process._tickCallback();
    _tb.fireDue();
    if (process._tickCallback) process._tickCallback();
    _tb.drainMicrotasks();
    if (process._tickCallback) process._tickCallback();
    _eluActiveMs += _now() - tickStart;

    const hasTimers = _tb.hasPending();
    const hasIO = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
    const hasTicks = process._nextTickQueue && process._nextTickQueue.length > 0;
    if (!hasTimers && !hasIO && !hasTicks) break;

    let waitMs = 100;
    if (hasTimers) {
      const ms = _tb.msUntilNext();
      if (ms >= 0) waitMs = Math.min(waitMs, ms);
    }

    if (waitMs < 1) waitMs = 1;

    const pollStart = _now();
    if (poll) {
      poll(waitMs);
    } else {
      _tb.sleepMs(waitMs);
    }
    _eluIdleMs += _now() - pollStart;
    if (process._tickCallback) process._tickCallback();
  }
};

globalThis.__eventLoopUtilization = function() {
  const total = _eluIdleMs + _eluActiveMs;
  return { idle: _eluIdleMs, active: _eluActiveMs, utilization: total > 0 ? _eluActiveMs / total : 0 };
};

// Ref counter for keeping event loop alive (e.g., async iterators, pending promises)
let _activeRefs = 0;
globalThis.__ref = function() { _activeRefs++; };
globalThis.__unref = function() { _activeRefs--; };

globalThis.__hasIO = function() {
  if (_activeRefs > 0) return true;
  try {
    const net = require('net');
    if (net.Server._servers && net.Server._servers.size > 0) return true;
    if (net._fileWatchers && net._fileWatchers.size > 0) return true;
    if (net.Socket._sockets && net.Socket._sockets.size > 0) {
      for (const sock of net.Socket._sockets.values()) {
        if (!sock._unref) return true;
      }
    }
    return false;
  } catch { return false; }
};
