// timers/promises module
'use strict';

function _abortError(signal) {
  const reason = signal.reason || new DOMException('The operation was aborted', 'AbortError');
  const err = new Error(reason.message || 'The operation was aborted');
  err.code = 'ABORT_ERR';
  err.cause = reason;
  return err;
}

function setTimeout(delay, value, opts) {
  return new Promise((resolve, reject) => {
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return reject(_abortError(signal));
    const id = globalThis.setTimeout(() => resolve(value), delay);
    if (signal) signal.addEventListener('abort', () => { globalThis.clearTimeout(id); reject(_abortError(signal)); });
  });
}

function setImmediate(value, opts) {
  return new Promise((resolve, reject) => {
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return reject(_abortError(signal));
    globalThis.setImmediate(() => resolve(value));
  });
}

function setInterval(delay, value, opts) {
  return (async function*() {
    while (true) { yield await setTimeout(delay, value, opts); }
  })();
}

class Scheduler {
  constructor() {
    const e = new TypeError('Illegal constructor');
    e.code = 'ERR_ILLEGAL_CONSTRUCTOR';
    throw e;
  }
}
const scheduler = Object.create(Scheduler.prototype);
scheduler.yield = function() { return new Promise(resolve => globalThis.setImmediate(resolve)); };
scheduler.wait = function(delay, options) { return setTimeout(delay, undefined, options); };

module.exports = { setTimeout, setImmediate, setInterval, scheduler };
