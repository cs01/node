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
  // Reflect.apply, not fn.call — user code may overwrite fn.call/fn.apply
  // (they're just own properties), and node invokes the callback regardless.
  try { Reflect.apply(fn, thisArg, args); }
  catch (e) {
    if (process._fatalException) process._fatalException(e);
    else throw e;
  }
}

let _negativeTimerWarned = false;
let _overflowTimerWarned = false;
let _nanTimerWarned = false;
const TIMEOUT_MAX = 2 ** 31 - 1;
function _validateTimerCb(fn) {
  if (typeof fn !== 'function') {
    const e = new TypeError('The "callback" argument must be of type function. Received ' + (fn === null ? 'null' : typeof fn === 'object' ? 'an instance of ' + ((fn.constructor && fn.constructor.name) || 'Object') : 'type ' + typeof fn + " ('" + fn + "')"));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
}
function _warnTimerDelay(delay) {
  if (typeof delay !== 'number') return;
  if (Number.isNaN(delay)) {
    if (!_nanTimerWarned) {
      _nanTimerWarned = true;
      const w = new Error(`${delay} is not a number.\nTimers in Node.js can not span more than ${TIMEOUT_MAX} ms (approximately 24.8 days).`);
      w.name = 'TimeoutNaNWarning';
      process.emitWarning(w);
    }
    return;
  }
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
  const wrapped = () => {
    const before = t._id;
    _timerCallbacks.delete(before);
    _safeCall(fn, args, t);
    // A callback may turn a one-shot into a repeating timer by setting _repeat
    // (Node's listOnTimeout re-arms in that case); otherwise mark it done unless
    // the callback already refreshed it (changing _id).
    if (t._repeat && !t._destroyed) t.refresh();
    else if (t._id === before) t._destroyed = true;
  };
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 0);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearTimeout = function clearTimeout(t) {
  if (t && typeof t === 'object') t._destroyed = true;
  // ids are numeric; accept the primitive form too — `${timeout}` yields a numeric
  // string that must be coerced back or it won't match the registry key.
  let id = t && typeof t === 'object' ? t._id : t;
  if (typeof id === 'string') id = +id;
  _timerCallbacks.delete(id);
  _unrefTimers.delete(id);
  _tb.clear(id);
};

globalThis.setInterval = function setInterval(fn, delay, ...args) {
  _validateTimerCb(fn);
  _warnTimerDelay(delay);
  const t = new Timeout(0, fn, delay, args, true);
  t._onTimeout = fn;
  t._idleTimeout = delay;
  // Honor Node's internal stop signals: clearing _onTimeout (null) or setting
  // _idleTimeout < 0 from within the callback unenrolls the interval.
  const wrapped = () => {
    if (t._destroyed || t._idleTimeout < 0 || typeof t._onTimeout !== 'function') {
      _tb.clear(t._id); _timerCallbacks.delete(t._id); return;
    }
    _safeCall(t._onTimeout, args, t);
  };
  t._id = _tb.schedule(wrapped, Math.max(0, delay || 0), 1);
  _timerCallbacks.set(t._id, wrapped);
  return t;
};

globalThis.clearInterval = function clearInterval(t) {
  if (t && typeof t === 'object') t._destroyed = true;
  let id = t && typeof t === 'object' ? t._id : t;
  if (typeof id === 'string') id = +id;
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
  let id = t && typeof t === 'object' ? t._id : t;
  if (typeof id === 'string') id = +id;
  _activeImmediates.delete(id);
};

// One event-loop iteration for a worker thread: fire due timers, drain ticks +
// microtasks + immediates, return whether timer/immediate/tick work remains.
Object.defineProperty(globalThis, '__workerTick', { value: function __workerTick() {
  const tick = () => { if (process.processTicksAndRejections) process.processTicksAndRejections(); };
  tick(); _tb.drainMicrotasks(); tick();
  _tb.fireDue();
  _drainImmediates();
  tick(); _tb.drainMicrotasks(); tick();
  let hasTimers = false;
  if (_tb.hasPending()) { for (const id of _timerCallbacks.keys()) { if (!_unrefTimers.has(id)) { hasTimers = true; break; } } }
  return hasTimers || _immediateQueue.length > 0 || (process._nextTickQueue && process._nextTickQueue.length > 0);
}, enumerable: false });

// Only ref'd immediates keep the loop alive; an unref'd-only queue lets the
// process exit without running them (setImmediate(fn).unref()).
function _hasRefImmediate() {
  for (const item of _immediateQueue) { if (!_unrefTimers.has(item.id)) return true; }
  return false;
}
function _drainImmediates() {
  const batch = _immediateQueue.splice(0, _immediateQueue.length);
  for (const item of batch) {
    // Skip immediates cleared (clearImmediate) or disposed ([Symbol.dispose] →
    // clearTimeout, which marks _destroyed without touching _activeImmediates).
    if (_activeImmediates.has(item.id) && !(item.timeout && item.timeout._destroyed)) {
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

// MILO_LIFECYCLE_DEBUG=1 dumps loop-liveness state every N iterations. A healthy loop
// blocks in poll() and never reaches the sample threshold; a busy-loop hits it in <1s and
// the dump names the fd/counter that is wedging the exit check. See lifecycle-probes/PLAYBOOK.md.
const _LC_DEBUG = !!(process.env && process.env.MILO_LIFECYCLE_DEBUG);
// Time-based, not iteration-based: a hung-but-idle loop does very few iterations, so
// sampling every N iterations prints nothing for exactly the case you're debugging.
const _LC_MS = 500;
let _lcLastDump = 0;
function _lcLog(msg) {
  try { require('fs').writeSync(2, `[lc] ${msg}\n`); } catch {}
}

Object.defineProperty(globalThis, '__runEventLoop', { value: function __runEventLoop() {
  let net = null;
  try { net = require('net'); } catch {}
  const poll = net && net._pollOnce;
  const tick = () => { if (process.processTicksAndRejections) process.processTicksAndRejections(); };
  const drainAll = () => { tick(); _tb.drainMicrotasks(); tick(); };
  let _lcIter = 0;

  for (;;) {
    const tickStart = _now();
    drainAll();
    _tb.fireDue();
    drainAll();
    // pump messages from worker threads (parent side) + dispatch exit events
    if (globalThis.__pumpParentWorkers) globalThis.__pumpParentWorkers();
    drainAll();
    _eluActiveMs += _now() - tickStart;

    const hasWorkers = globalThis.__hasActiveWorkers ? globalThis.__hasActiveWorkers() : false;
    const hasTimersNative = _tb.hasPending();
    let hasTimers = false;
    if (hasTimersNative) {
      for (const id of _timerCallbacks.keys()) {
        if (!_unrefTimers.has(id)) { hasTimers = true; break; }
      }
    }
    const hasIO = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
    const hasTicks = process._nextTickQueue && process._nextTickQueue.length > 0;
    const hasImmediates = _hasRefImmediate();
    const hasPendingClose = _pendingCloseRefs > 0;
    _lcIter++;
    if (_LC_DEBUG && _now() - _lcLastDump >= _LC_MS) {
      _lcLastDump = _now();
      const socks = net && net.Socket._sockets ? [...net.Socket._sockets.keys()] : [];
      const srvs = net && net.Server._servers ? [...net.Server._servers.keys()] : [];
      if (globalThis.__lcTrace && globalThis.__lcTrace.length) { _lcLog('TRACE: ' + globalThis.__lcTrace.join(' | ')); globalThis.__lcTrace.length = 0; }
      _lcLog(`iter=${_lcIter} timers=${hasTimers} io=${hasIO} ticks=${hasTicks} imm=${hasImmediates} pclose=${_pendingCloseRefs} workers=${hasWorkers} socks=[${socks}] srvs=[${srvs}]`);
    }
    if (!hasTimers && !hasIO && !hasTicks && !hasImmediates && !hasPendingClose && !hasWorkers) {
      if (process._emitBeforeExit) process._emitBeforeExit();
      drainAll();
      if (globalThis.__pumpParentWorkers) globalThis.__pumpParentWorkers();
      drainAll();
      const hasTimers2 = _tb.hasPending() && (() => { for (const id of _timerCallbacks.keys()) { if (!_unrefTimers.has(id)) return true; } return false; })();
      const hasIO2 = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
      const hasTicks2 = process._nextTickQueue && process._nextTickQueue.length > 0;
      const hasImmediates2 = _hasRefImmediate();
      const hasPendingClose2 = _pendingCloseRefs > 0;
      const hasWorkers2 = globalThis.__hasActiveWorkers ? globalThis.__hasActiveWorkers() : false;
      if (!hasTimers2 && !hasIO2 && !hasTicks2 && !hasImmediates2 && !hasPendingClose2 && !hasWorkers2) break;
    }

    let waitMs = 100;
    if (_immediateQueue.length > 0 || hasPendingClose) {
      waitMs = 0;
    } else if (hasTimers) {
      const ms = _tb.msUntilNext();
      if (ms >= 0) waitMs = Math.min(waitMs, ms);
    }
    // Workers no longer force a 2ms poll cap: a worker posting a message triggers EVFILT_USER
    // (tcp.pollWake) which returns pollWait immediately, so the loop can block properly
    // instead of waking 500x/second to busy-check queues that are almost always empty.

    if (waitMs < 1 && !hasImmediates && !hasPendingClose) waitMs = 1;

    const pollStart = _now();
    let _lcN = 0;
    if (poll) {
      _lcN = poll(waitMs);
    } else {
      _tb.sleepMs(waitMs);
    }
    if (_LC_DEBUG && _now() === _lcLastDump) {
      _lcLog(`  poll(waitMs=${waitMs}) -> ${_lcN} events in ${_now() - pollStart}ms; immQ=${_immediateQueue.length}`);
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
    // only ref'd file watchers keep the loop alive (an unref'd watcher still gets
    // events but won't by itself hold the process open). See FSWatcher.unref().
    if (net._fileWatchers && net._fileWatchers.size > 0) {
      for (const w of net._fileWatchers.values()) { if (!w._unref) return true; }
    }
    if (net.Socket._sockets && net.Socket._sockets.size > 0) {
      for (const sock of net.Socket._sockets.values()) {
        if (sock._unref) continue;
        // Mirror libuv: an open fd does not by itself hold the loop open — only an ACTIVE
        // handle does. A socket that has consumed the peer's FIN (readable ended) and has
        // finished its own writable side can never produce another event, so it must not
        // count as pending work even though it is still in the map awaiting destroy.
        // Node exits on exactly this state (verified: a client with unread buffered data +
        // FIN and no data listener never emits 'close' and node still exits 0). Treating
        // mere map membership as liveness is what hung those tests forever.
        const rs = sock._readableState, ws = sock._writableState;
        // ws.finished ONLY — not ws.ended. Writes can now park on EAGAIN, so 'ended'
        // (end() called) no longer implies 'flushed'; exiting on it would drop the tail of
        // a large response. 'finished' means every _write cb has fired, so nothing is parked.
        if (rs && ws && rs.ended && ws.finished) continue;
        return true;
      }
    }
    return false;
  } catch { return false; }
}, enumerable: false });
