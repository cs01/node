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
      ? () => _safeCall(this._fn, this._args, this)
      : () => { _timerCallbacks.delete(this._id); _safeCall(this._fn, this._args, this); };
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

function _safeCall(fn, args, thisArg) {
  try { fn.call(thisArg, ...args); }
  catch (e) {
    if (process._fatalException) process._fatalException(e);
    else throw e;
  }
}

let _negativeTimerWarned = false;
let _overflowTimerWarned = false;
const TIMEOUT_MAX = 2 ** 31 - 1;
function _validateTimerCb(fn) {
  if (typeof fn !== 'function') {
    const e = new TypeError('The "callback" argument must be of type function. Received ' + (fn === null ? 'null' : typeof fn === 'object' ? 'an instance of ' + ((fn.constructor && fn.constructor.name) || 'Object') : 'type ' + typeof fn + " ('" + fn + "')"));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
}
function _warnTimerDelay(delay) {
  if (typeof delay !== 'number') return;
  if (delay < 0 && !_negativeTimerWarned) {
    _negativeTimerWarned = true;
    const w = new Error(`${delay} is a negative number.\nTimers in Node.js can not span more than ${TIMEOUT_MAX} ms (approximately 24.8 days).`);
    w.name = 'TimeoutNegativeWarning';
    process.emitWarning(w);
  }
  if (delay > TIMEOUT_MAX) {
    const w = new Error(`${delay} does not fit into a 32-bit signed integer.\nTimer duration was truncated to ${TIMEOUT_MAX}.`);
    w.name = 'TimeoutOverflowWarning';
    process.emitWarning(w);
  }
}
globalThis.setTimeout = function setTimeout(fn, delay, ...args) {
  _validateTimerCb(fn);
  _warnTimerDelay(delay);
  const t = new Timeout(0, fn, delay, args, false);
  const wrapped = () => { _timerCallbacks.delete(t._id); t._destroyed = true; _safeCall(fn, args, t); };
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 0);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearTimeout = function clearTimeout(t) {
  if (t && typeof t === 'object') t._destroyed = true;
  const id = t && typeof t === 'object' ? t._id : t;
  _timerCallbacks.delete(id);
  _unrefTimers.delete(id);
  _tb.clear(id);
};

globalThis.setInterval = function setInterval(fn, delay, ...args) {
  _validateTimerCb(fn);
  _warnTimerDelay(delay);
  const t = new Timeout(0, fn, delay, args, true);
  const wrapped = () => _safeCall(fn, args, t);
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 1);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearInterval = function clearInterval(t) {
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

globalThis.setImmediate = function setImmediate(fn, ...args) {
  _validateTimerCb(fn);
  const id = ++_immediateId;
  _activeImmediates.add(id);
  const t = new Timeout(id, fn, 0, args, false);
  _immediateQueue.push({ id, fn, args, timeout: t });
  return t;
};
globalThis.clearImmediate = function clearImmediate(t) {
  const id = t && typeof t === 'object' ? t._id : t;
  _activeImmediates.delete(id);
};

function _drainImmediates() {
  const batch = _immediateQueue.splice(0, _immediateQueue.length);
  for (const item of batch) {
    if (_activeImmediates.has(item.id)) {
      _activeImmediates.delete(item.id);
      _safeCall(item.fn, item.args, item.timeout);
    }
  }
}

// Event loop — called from main.milo after script execution
// Integrates timer queue + kqueue I/O polling
// Event loop utilization tracking (millisecond precision via Date.now)
let _eluIdleMs = 0;
let _eluActiveMs = 0;
const _now = Date.now;

// pending close count — incremented when a socket/server defers _sockets/_servers deletion,
// decremented when the 'close' event fires and the deletion runs
let _pendingCloseRefs = 0;
Object.defineProperty(globalThis, '__pendingCloseRef', { value: function() { _pendingCloseRefs++; }, enumerable: false });
Object.defineProperty(globalThis, '__pendingCloseUnref', { value: function() { _pendingCloseRefs--; }, enumerable: false });

Object.defineProperty(globalThis, '__runEventLoop', { value: function __runEventLoop() {
  let net = null;
  try { net = require('net'); } catch {}
  const poll = net && net._pollOnce;
  const tick = () => { if (process._tickCallback) process._tickCallback(); };
  const drainAll = () => { tick(); _tb.drainMicrotasks(); tick(); };

  for (;;) {
    const tickStart = _now();
    drainAll();
    _tb.fireDue();
    drainAll();
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
    const hasPendingClose = _pendingCloseRefs > 0;
    if (!hasTimers && !hasIO && !hasTicks && !hasImmediates && !hasPendingClose) {
      if (process._emitBeforeExit) process._emitBeforeExit();
      drainAll();
      const hasTimers2 = _tb.hasPending() && (() => { for (const id of _timerCallbacks.keys()) { if (!_unrefTimers.has(id)) return true; } return false; })();
      const hasIO2 = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
      const hasTicks2 = process._nextTickQueue && process._nextTickQueue.length > 0;
      const hasImmediates2 = _immediateQueue.length > 0;
      const hasPendingClose2 = _pendingCloseRefs > 0;
      if (!hasTimers2 && !hasIO2 && !hasTicks2 && !hasImmediates2 && !hasPendingClose2) break;
    }

    let waitMs = 100;
    if (hasImmediates || hasPendingClose) {
      waitMs = 0;
    } else if (hasTimers) {
      const ms = _tb.msUntilNext();
      if (ms >= 0) waitMs = Math.min(waitMs, ms);
    }

    if (waitMs < 1 && !hasImmediates && !hasPendingClose) waitMs = 1;

    const pollStart = _now();
    if (poll) {
      poll(waitMs);
    } else {
      _tb.sleepMs(waitMs);
    }
    _eluIdleMs += _now() - pollStart;
    drainAll();
    if (poll) { let _rpn = 0; while (_rpn < 10 && poll(0) > 0) { _rpn++; drainAll(); } }
    _drainImmediates();
    drainAll();
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
