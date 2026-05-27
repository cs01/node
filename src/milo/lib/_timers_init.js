// timer globals + event loop — internal bootstrap module
'use strict';

const _tb = internalBinding('timers');
const _timerCallbacks = new Map();
const _unrefTimers = new Set();

class Timeout {
  constructor(id, fn, delay, args, repeat) {
    this._id = id;
    this._fn = fn;
    this._delay = delay;
    this._args = args;
    this._repeat = repeat;
    this._refed = true;
    this._destroyed = false;
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
  unref() { this._refed = false; _unrefTimers.add(this._id); return this; }
  ref() { this._refed = true; _unrefTimers.delete(this._id); return this; }
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

let _negativeTimerWarned = false;
globalThis.setTimeout = function(fn, delay, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  if (typeof delay === 'number' && delay < 0 && !_negativeTimerWarned) {
    _negativeTimerWarned = true;
    const w = new Error(`${delay} is a negative number.\nTimers in Node.js can not span more than 2147483647 ms (approximately 24.8 days).`);
    w.name = 'TimeoutNegativeWarning';
    process.emitWarning(w);
  }
  const t = new Timeout(0, fn, delay, args, false);
  const wrapped = () => { _timerCallbacks.delete(t._id); t._destroyed = true; _safeCall(fn, args); };
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 0);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearTimeout = function(t) {
  if (t && typeof t === 'object') t._destroyed = true;
  const id = t && typeof t === 'object' ? t._id : t;
  _timerCallbacks.delete(id);
  _unrefTimers.delete(id);
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
  if (t && typeof t === 'object') t._destroyed = true;
  const id = t && typeof t === 'object' ? t._id : t;
  _timerCallbacks.delete(id);
  _unrefTimers.delete(id);
  _tb.clear(id);
};

// setImmediate runs after I/O poll, not as setTimeout(0)
const _immediateQueue = [];
let _immediateId = 0;
const _activeImmediates = new Set();

globalThis.setImmediate = function(fn, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  const id = ++_immediateId;
  _activeImmediates.add(id);
  _immediateQueue.push({ id, fn, args });
  return new Timeout(id, fn, 0, args, false);
};
globalThis.clearImmediate = function(t) {
  const id = t && typeof t === 'object' ? t._id : t;
  _activeImmediates.delete(id);
};

function _drainImmediates() {
  const batch = _immediateQueue.splice(0, _immediateQueue.length);
  for (const item of batch) {
    if (_activeImmediates.has(item.id)) {
      _activeImmediates.delete(item.id);
      _safeCall(item.fn, item.args);
    }
  }
}

// Event loop — called from main.milo after script execution
// Integrates timer queue + kqueue I/O polling
// Event loop utilization tracking (millisecond precision via Date.now)
let _eluIdleMs = 0;
let _eluActiveMs = 0;
const _now = Date.now;

Object.defineProperty(globalThis, '__runEventLoop', { value: function __runEventLoop() {
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

    const hasTimersNative = _tb.hasPending();
    let hasTimers = false;
    if (hasTimersNative) {
      for (const id of _timerCallbacks.keys()) {
        if (!_unrefTimers.has(id)) { hasTimers = true; break; }
      }
    }
    const hasIO = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
    const hasTicks = process._nextTickQueue && process._nextTickQueue.length > 0;
    const hasImmediates = _immediateQueue.length > 0;
    if (!hasTimers && !hasIO && !hasTicks && !hasImmediates) {
      // Emit beforeExit — handlers may schedule new work
      if (process._emitBeforeExit) process._emitBeforeExit();
      if (process._tickCallback) process._tickCallback();
      // Re-check if beforeExit handlers added work
      const hasTimers2 = _tb.hasPending() && (() => { for (const id of _timerCallbacks.keys()) { if (!_unrefTimers.has(id)) return true; } return false; })();
      const hasIO2 = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
      const hasTicks2 = process._nextTickQueue && process._nextTickQueue.length > 0;
      const hasImmediates2 = _immediateQueue.length > 0;
      if (!hasTimers2 && !hasIO2 && !hasTicks2 && !hasImmediates2) break;
    }

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
    // Quick non-blocking poll to catch events triggered during callbacks
    if (poll && _immediateQueue.length > 0) { poll(0); if (process._tickCallback) process._tickCallback(); }
    // setImmediate: run after I/O poll (Node.js "check" phase)
    _drainImmediates();
    if (process._tickCallback) process._tickCallback();
  }
}, enumerable: false });

Object.defineProperty(globalThis, '__eventLoopUtilization', { value: function() {
  const total = _eluIdleMs + _eluActiveMs;
  return { idle: _eluIdleMs, active: _eluActiveMs, utilization: total > 0 ? _eluActiveMs / total : 0 };
}, enumerable: false });

// Ref counter for keeping event loop alive
let _activeRefs = 0;
Object.defineProperty(globalThis, '__ref', { value: function() { _activeRefs++; }, enumerable: false });
Object.defineProperty(globalThis, '__unref', { value: function() { _activeRefs--; }, enumerable: false });

Object.defineProperty(globalThis, '__hasIO', { value: function() {
  if (_activeRefs > 0) return true;
  try {
    const net = require('net');
    if (net.Server._servers && net.Server._servers.size > 0) {
      for (const srv of net.Server._servers.values()) {
        if (!srv._unref) return true;
      }
    }
    if (net._fileWatchers && net._fileWatchers.size > 0) return true;
    if (net.Socket._sockets && net.Socket._sockets.size > 0) {
      for (const sock of net.Socket._sockets.values()) {
        if (!sock._unref) return true;
      }
    }
    return false;
  } catch { return false; }
}, enumerable: false });
