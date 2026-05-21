// timer globals + event loop — internal bootstrap module
'use strict';

const _tb = internalBinding('timers');
const _timerCallbacks = new Map();

globalThis.setTimeout = function(fn, delay, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  const wrapped = () => { _timerCallbacks.delete(id); fn(...args); };
  const id = _tb.schedule(wrapped, Math.max(0, delay || 0), 0);
  _timerCallbacks.set(id, wrapped);
  return id;
};

globalThis.clearTimeout = function(id) { _timerCallbacks.delete(id); _tb.clear(id); };

globalThis.setInterval = function(fn, delay, ...args) {
  if (typeof fn !== 'function') fn = Function(fn);
  const wrapped = () => fn(...args);
  const id = _tb.schedule(wrapped, Math.max(0, delay || 0), 1);
  _timerCallbacks.set(id, wrapped);
  return id;
};

globalThis.clearInterval = function(id) { _timerCallbacks.delete(id); _tb.clear(id); };

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

    const hasTimers = _tb.hasPending();
    const hasIO = poll ? (globalThis.__hasIO && globalThis.__hasIO()) : false;
    if (!hasTimers && !hasIO) break;

    let waitMs = 100;
    if (hasTimers) {
      const ms = _tb.msUntilNext();
      if (ms >= 0) waitMs = Math.min(waitMs, ms);
    }

    if (poll) {
      poll(waitMs);
    } else if (waitMs > 0) {
      _tb.sleepMs(waitMs);
    }
  }
};

globalThis.__hasIO = function() {
  try {
    const net = require('net');
    return (net.Server._servers && net.Server._servers.size > 0) ||
           (net.Socket._sockets && net.Socket._sockets.size > 0);
  } catch { return false; }
};
