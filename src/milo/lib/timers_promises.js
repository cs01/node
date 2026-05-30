// timers/promises module
'use strict';

function _abortError(signal) {
  // Always an AbortError (name matches /AbortError/), carrying the signal's
  // reason as `cause` — AbortSignal.abort('boom') must surface { cause: 'boom' }.
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  if (signal && signal.reason !== undefined) err.cause = signal.reason;
  return err;
}

function _argTypeErr(name, expected, actual) {
  const e = new TypeError(`The "${name}" argument must be of type ${expected}. Received ${actual === null ? 'null' : typeof actual}`);
  e.code = 'ERR_INVALID_ARG_TYPE';
  return e;
}

// Returns an error if opts (or its signal/ref) is invalid, else null.
function _validateOpts(opts) {
  if (opts === undefined) return null;
  if (typeof opts !== 'object' || opts === null) return _argTypeErr('options', 'Object', opts);
  // Node's validateAbortSignal accepts any object exposing `aborted` (tests pass
  // NodeEventTarget mocks), not strictly `instanceof AbortSignal`.
  if (opts.signal !== undefined && (opts.signal === null || typeof opts.signal !== 'object' || !('aborted' in opts.signal))) return _argTypeErr('options.signal', 'AbortSignal', opts.signal);
  if (opts.ref !== undefined && typeof opts.ref !== 'boolean') return _argTypeErr('options.ref', 'boolean', opts.ref);
  return null;
}

function setTimeout(delay, value, opts) {
  return new Promise((resolve, reject) => {
    if (delay !== undefined && typeof delay !== 'number') return reject(_argTypeErr('delay', 'number', delay));
    const optErr = _validateOpts(opts);
    if (optErr) return reject(optErr);
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return reject(_abortError(signal));
    const id = globalThis.setTimeout(() => resolve(value), delay);
    if (opts && opts.ref === false && id && id.unref) id.unref();
    if (signal) signal.addEventListener('abort', () => { globalThis.clearTimeout(id); reject(_abortError(signal)); });
  });
}

function setImmediate(value, opts) {
  return new Promise((resolve, reject) => {
    const optErr = _validateOpts(opts);
    if (optErr) return reject(optErr);
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return reject(_abortError(signal));
    const id = globalThis.setImmediate(() => resolve(value));
    if (opts && opts.ref === false && id && id.unref) id.unref();
    if (signal) signal.addEventListener('abort', () => { globalThis.clearImmediate(id); reject(_abortError(signal)); });
  });
}

function setInterval(delay, value, opts) {
  // Hand-rolled async iterator (not a generator delegating to setTimeout) so the
  // signal gets ONE abort listener for the iterator's whole life, added lazily on
  // first next() and removed on return()/abort — matching Node's leak-free
  // semantics (tests assert listenerCount transitions 0→1→0).
  let signal, onAbort = null, aborted = false, abortErr = null;
  const cleanup = () => { if (signal && onAbort) { signal.removeEventListener('abort', onAbort); onAbort = null; } };
  const iterator = {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      if (delay !== undefined && typeof delay !== 'number') throw _argTypeErr('delay', 'number', delay);
      const optErr = _validateOpts(opts);
      if (optErr) throw optErr;
      signal = opts && opts.signal;
      if (signal && signal.aborted) { cleanup(); throw _abortError(signal); }
      if (signal && !onAbort) {
        onAbort = () => { aborted = true; abortErr = _abortError(signal); };
        signal.addEventListener('abort', onAbort);
      }
      if (aborted) { cleanup(); throw abortErr; }
      await new Promise((res) => {
        const id = globalThis.setTimeout(res, delay);
        if (opts && opts.ref === false && id && id.unref) id.unref();
      });
      if (aborted) { cleanup(); throw abortErr; }
      return { value, done: false };
    },
    async return() { cleanup(); return { value: undefined, done: true }; },
  };
  return iterator;
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
