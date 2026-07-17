// stream module — Readable, Writable, Duplex, Transform, PassThrough
'use strict';

const EventEmitter = require('events');

function _ERR_UNKNOWN_ENCODING(enc) {
  const e = new TypeError('Unknown encoding: ' + enc);
  e.code = 'ERR_UNKNOWN_ENCODING';
  return e;
}

function _ERR_METHOD_NOT_IMPLEMENTED(method) {
  const e = new Error('The ' + method + ' method is not implemented');
  e.code = 'ERR_METHOD_NOT_IMPLEMENTED';
  return e;
}

function _validateHWM(hwm, name) {
  if (hwm != null && (typeof hwm !== 'number' || !(hwm >= 0) || !Number.isFinite(hwm))) {
    const { inspect } = require('util');
    const e = new TypeError(`The property 'options.${name || 'highWaterMark'}' is invalid. Received ${inspect(hwm)}`);
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
}

let _defaultHWM = 65536;
let _defaultObjectHWM = 16;

// Function-based so old-style util.inherits + .call() works
function Stream() { EventEmitter.call(this); }
Object.setPrototypeOf(Stream.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Stream, EventEmitter);
Stream.prototype.pipe = function pipe(dest, opts) {
  const src = this;
  if (src._readableState && src._readableState.pipes) src._readableState.pipes.push(dest);
  if (!src._pipeListeners) src._pipeListeners = [];

  const ondata = (chunk) => {
    if (dest.writable !== false) {
      const canContinue = dest.write(chunk);
      if (canContinue === false && src.pause) src.pause();
    }
  };
  const ondrain = () => { if (src.resume) src.resume(); };
  // cleanup() removes every listener this pipe added — works for legacy base
  // Stream (no _readableState, where unpipe is a no-op) and modern streams.
  // Idempotent removeListener makes double-invocation (end + unpipe) safe.
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    src.removeListener('data', ondata);
    src.removeListener('end', onend);
    src.removeListener('close', onsrcclose);
    src.removeListener('end', cleanup);
    src.removeListener('close', cleanup);
    dest.removeListener('drain', ondrain);
    dest.removeListener('close', ondestclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('error', onerror);
    if (src._pipeListeners) { const i = src._pipeListeners.findIndex(e => e.dest === dest); if (i >= 0) src._pipeListeners.splice(i, 1); }
    if (src._readableState && src._readableState.pipes) { const i = src._readableState.pipes.indexOf(dest); if (i >= 0) src._readableState.pipes.splice(i, 1); }
  };
  let ended = false;
  const onend = () => { if (ended) return; ended = true; if (!opts || opts.end !== false) dest.end(); };
  const onsrcclose = () => { if (ended) return; ended = true; if ((!opts || opts.end !== false) && typeof dest.destroy === 'function') dest.destroy(); };
  const ondestclose = () => cleanup();
  const onfinish = () => cleanup();
  const onerror = () => cleanup();

  src.on('data', ondata);
  dest.on('drain', ondrain);
  src.on('end', onend);
  src.on('close', onsrcclose);
  src.on('end', cleanup);
  src.on('close', cleanup);
  dest.on('close', ondestclose);
  dest.on('finish', onfinish);
  dest.on('error', onerror);

  src._pipeListeners.push({ dest, ondata, onend, ondrain, onclose: ondestclose, onfinish, onerror, _cleanup: cleanup });
  dest.emit('pipe', src);
  if (src.resume) src.resume();
  return dest;
};

Stream.prototype.unpipe = function unpipe(dest) {
  if (!this._pipeListeners || this._pipeListeners.length === 0) return this;
  const entries = !dest ? this._pipeListeners.slice() : this._pipeListeners.filter(e => e.dest === dest);
  for (const entry of entries) {
    if (entry._cleanup) entry._cleanup(); // removes listeners + splices from _pipeListeners/pipes
    entry.dest.emit('unpipe', this);
  }
  if (this._readableState) {
    if (!this._readableState.pipes || this._readableState.pipes.length === 0) {
      this._readableState.flowing = false;
      this.emit('pause');
    }
  }
  return this;
};

// Constructor bodies live in standalone init fns so ES5-style inheritance
// (util.inherits + Readable.call(this, opts), e.g. graceful-fs) can initialize
// a foreign `this` — class constructors can't be .call()ed.
function _readableInit(self, opts) {
  self.readable = true;
  if (opts) { _validateHWM(opts.highWaterMark, 'highWaterMark'); _validateHWM(opts.readableHighWaterMark, 'readableHighWaterMark'); }
  const _isDuplex = self instanceof Duplex;
  const _rOM = opts ? (opts.readableObjectMode != null ? opts.readableObjectMode : !!opts.objectMode) : false;
  const _rDefaultHWM = _rOM ? _defaultObjectHWM : _defaultHWM;
  let _rHWM = _rDefaultHWM;
  if (opts) {
    if (opts.highWaterMark != null) _rHWM = opts.highWaterMark;
    else if (_isDuplex && opts.readableHighWaterMark != null) _rHWM = opts.readableHighWaterMark;
  }
  self._readableState = {
    readable: true,
    flowing: null, ended: false, buffer: [], length: 0,
    highWaterMark: _rHWM,
    objectMode: _rOM,
    encoding: null,
    pipes: [],
    errorEmitted: false, errored: null,
    reading: false, readingMore: false,
    needReadable: false, emittedReadable: false,
    resumeScheduled: false, readableListening: false,
    awaitDrainWriters: null,
    _destroyed: false,
    autoDestroy: opts && opts.autoDestroy !== undefined ? !!opts.autoDestroy : true,
    endEmitted: false,
  };
  if (opts && opts.encoding) self.setEncoding(opts.encoding);
  if (opts && opts.defaultEncoding !== undefined) {
    if (!Buffer.isEncoding(opts.defaultEncoding)) throw _ERR_UNKNOWN_ENCODING(opts.defaultEncoding);
    self._readableState.defaultEncoding = opts.defaultEncoding;
  }
  if (opts && opts.read) self._read = opts.read;
  if (opts && opts.destroy) self._destroy = opts.destroy;
  if (opts && opts.signal) {
    const signal = opts.signal;
    if (signal.aborted) self.destroy(new DOMException('The operation was aborted', 'AbortError'));
    else signal.addEventListener('abort', () => self.destroy(new DOMException('The operation was aborted', 'AbortError')), { once: true });
  }
}

class Readable extends Stream {
  constructor(opts) {
    super();
    _readableInit(this, opts);
  }

  _read(_size) {
    const err = new Error('The _read() method is not implemented');
    err.code = 'ERR_METHOD_NOT_IMPLEMENTED';
    this.destroy(err);
  }

  read(size) {
    const state = this._readableState;
    if (state._destroyed) return null;
    if (size !== undefined) {
      size = parseInt(size, 10);
      if (size > 0x40000000) {
        const e = new RangeError('The value of "size" is out of range. It must be <= 1GiB. Received ' + size);
        e.code = 'ERR_OUT_OF_RANGE'; throw e;
      }
      if (size > state.highWaterMark) state.highWaterMark = size;
    }
    if (state.buffer.length === 0) {
      if (state.ended) {
        state.reading = false;
        if (!state.endEmitted) { state.endEmitted = true; process.nextTick(() => { this.readable = false; this.emit('end'); if (state.autoDestroy && (!this._writableState || this._writableState.finished)) this.destroy(); }); }
        return null;
      }
      if (size === undefined) {
        if (state.length >= state.highWaterMark) { state.needReadable = true; return null; }
      }
      state.reading = true;
      state.needReadable = true;
      this._read(state.highWaterMark);
      state.reading = false;
      if (state.buffer.length === 0) {
        if (state.ended && !state.endEmitted) { state.endEmitted = true; process.nextTick(() => { this.readable = false; this.emit('end'); if (state.autoDestroy && (!this._writableState || this._writableState.finished)) this.destroy(); }); }
        return null;
      }
    }
    state.emittedReadable = false;
    let ret;
    if (state.objectMode) {
      ret = state.buffer.shift();
      state.length = state.buffer.length;
    } else if (!size || size >= state.length) {
      if (state.buffer.length === 1) {
        ret = state.buffer.shift();
      } else if (state.encoding || (state.buffer.length > 0 && typeof state.buffer[0] === 'string')) {
        ret = state.buffer.join('');
      } else {
        ret = Buffer.concat(state.buffer);
      }
      state.buffer = [];
      state.length = 0;
    } else {
      ret = state.buffer.shift();
      state.length -= ret.length || 1;
    }
    // Draining the last buffered chunk while already at EOF must schedule 'end';
    // otherwise a read() inside a 'readable' handler consumes the tail and the
    // stream never ends.
    if (state.length === 0 && state.ended && !state.endEmitted && !state._destroyed) {
      state.endEmitted = true;
      process.nextTick(() => { this.readable = false; this.emit('end'); if (state.autoDestroy && (!this._writableState || this._writableState.finished)) this.destroy(); });
    }
    if (state.length === 0 && !state.ended) {
      state.needReadable = true;
      if (!state.reading && !state._readScheduled) {
        state._readScheduled = true;
        process.nextTick(() => {
          state._readScheduled = false;
          if (!state.reading && state.length < state.highWaterMark && !state.ended) {
            state.reading = true;
            this._read(state.highWaterMark);
            state.reading = false;
          }
        });
      }
    }
    return ret;
  }

  push(chunk, encoding) {
    const state = this._readableState;
    this._didPush = true;
    if (state._destroyed) return false;
    if (chunk === undefined && !state.objectMode) return state.length <= state.highWaterMark;
    if (chunk === null) {
      // EOF: flush the decoder's buffered tail as a final data chunk first
      if (state.decoder && !state._decoderFlushed) {
        state._decoderFlushed = true;
        const tail = state.decoder.end();
        if (tail) {
          if (state.flowing) this.emit('data', tail);
          else { state.buffer.push(tail); state.length += tail.length; }
        }
      }
      state.ended = true;
      if (state.readableListening && !state._readableEmitScheduled) {
        state._readableEmitScheduled = true;
        process.nextTick(() => { state._readableEmitScheduled = false; this.emit('readable'); });
      }
      if (state.flowing || state.buffer.length === 0) {
        process.nextTick(() => {
          if (!state.endEmitted && !state._destroyed) { state.endEmitted = true; this.readable = false; this.emit('end'); if (state.autoDestroy && (!this._writableState || this._writableState.finished)) this.destroy(); }
          if (this.allowHalfOpen === false && this._writableState && !this._writableState.ended) this.end();
          if (this._writableState && this._writableState.autoDestroy && this._writableState.finished) process.nextTick(() => { if (!this.destroyed) this.destroy(); });
        });
      }
      return false;
    }
    if (state.ended) {
      const err = new Error('stream.push() after EOF');
      err.code = 'ERR_STREAM_PUSH_AFTER_EOF';
      state.errored = err;
      // emit 'error' only once: after the first push-after-EOF the stream is
      // errored, so repeat pushes must not re-fire (matches node's once semantics).
      if (!state.errorEmitted) { state.errorEmitted = true; process.nextTick(() => this.emit('error', err)); }
      return false;
    }
    if (!state.objectMode) {
      if (typeof chunk === 'string') { chunk = Buffer.from(chunk, encoding || state.defaultEncoding); }
      else if (!(chunk instanceof Buffer || chunk instanceof Uint8Array)) {
        const err = new TypeError(`The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received ${typeof chunk === 'object' ? 'an instance of ' + (chunk.constructor ? chunk.constructor.name : 'Object') : typeof chunk + ' (' + chunk + ')'}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        state.errored = err;
        process.nextTick(() => this.emit('error', err));
        return false;
      }
    }
    if (state.encoding && Buffer.isBuffer(chunk)) {
      chunk = state.decoder ? state.decoder.write(chunk) : chunk.toString(state.encoding);
      // a chunk that's entirely a partial multibyte/base64 group decodes to ''.
      // Emit/buffer nothing (empty chunks break flow-control), but keep the
      // read loop alive so the rest of the group arrives.
      if (chunk === '') {
        if (state.flowing && state.length <= state.highWaterMark && !state.ended && !state.reading) {
          state.reading = true;
          process.nextTick(() => { state.reading = false; if (state.flowing && !state.ended) this._flow(); });
        }
        return state.length < state.highWaterMark;
      }
    }
    if (state.flowing) {
      this.emit('data', chunk);
      if (state.readableListening && !state._readableEmitScheduled) {
        state._readableEmitScheduled = true;
        process.nextTick(() => { state._readableEmitScheduled = false; state.emittedReadable = true; this.emit('readable'); });
      }
      if (state.length <= state.highWaterMark && !state.ended && !state.reading) {
        state.reading = true;
        process.nextTick(() => { state.reading = false; if (state.flowing && !state.ended) this._flow(); });
      }
    } else {
      state.buffer.push(chunk);
      state.length += chunk.length || 1;
      if (!state._readableEmitScheduled && this.listenerCount('readable') > 0) {
        state._readableEmitScheduled = true;
        state.needReadable = false;
        process.nextTick(() => { state._readableEmitScheduled = false; state.emittedReadable = true; this.emit('readable'); });
      }
    }
    return state.length < state.highWaterMark;
  }

  on(ev, fn) {
    super.on(ev, fn);
    if (ev === 'data') {
      this._readableState.readingMore = true;
      if (this._readableState.flowing !== false) this.resume();
    } else if (ev === 'readable') {
      const state = this._readableState;
      state.readableListening = true;
      state.flowing = false;
      if (state.length > 0 || state.ended) {
        process.nextTick(() => this.emit('readable'));
      } else if (!state._readScheduled) {
        state.needReadable = true;
        state._readScheduled = true;
        process.nextTick(() => {
          state._readScheduled = false;
          if (!state.reading && !state.ended && state.length <= state.highWaterMark) {
            state.reading = true;
            this._read(state.highWaterMark);
            state.reading = false;
            if (state.length > 0 || state.ended) {
              state.needReadable = false;
              if (!state._readableEmitScheduled) {
                state._readableEmitScheduled = true;
                process.nextTick(() => { state._readableEmitScheduled = false; this.emit('readable'); });
              }
            }
          }
        });
      }
    }
    return this;
  }

  addListener(ev, fn) { return this.on(ev, fn); }

  removeListener(ev, fn) {
    super.removeListener(ev, fn);
    if (ev === 'readable' && this.listenerCount('readable') === 0) {
      this._readableState.readableListening = false;
      if (!this._readableState.flowing) this._readableState.flowing = null;
    }
    return this;
  }

  setEncoding(enc) {
    enc = enc || 'utf8';
    if (!Buffer.isEncoding(enc)) throw _ERR_UNKNOWN_ENCODING(enc);
    const state = this._readableState;
    // StringDecoder buffers partial multibyte/base64 groups across chunk
    // boundaries — per-chunk toString() corrupts them (see read-stream-encoding)
    const { StringDecoder } = require('string_decoder');
    state.decoder = new StringDecoder(enc);
    state.encoding = enc;
    // re-decode anything already buffered through the new decoder (Node semantics)
    if (state.buffer.length > 0) {
      let content = '';
      for (const c of state.buffer) content += state.decoder.write(Buffer.isBuffer(c) ? c : Buffer.from(c));
      state.buffer = content.length ? [content] : [];
      state.length = content.length;
    }
    return this;
  }
  resume() {
    const state = this._readableState;
    if (!state.flowing) {
      state.flowing = true;
      state.resumeScheduled = true;
      process.nextTick(() => {
        state.resumeScheduled = false;
        if (state.flowing) {
          this.emit('resume');
          this._flow();
        }
      });
    }
    return this;
  }

  _flow() {
    const state = this._readableState;
    if (!state.flowing || state._destroyed) return;
    // Drain buffered data first, even if stream is already ended
    while (state.buffer.length > 0 && state.flowing) {
      const chunk = state.buffer.shift();
      state.length -= chunk.length || 1;
      this.emit('data', chunk);
    }
    while (state.flowing && !state.ended) {
      this._didPush = false;
      this._read(state.highWaterMark);
      if (!this._didPush) break;
      while (state.buffer.length > 0 && state.flowing) {
        const chunk = state.buffer.shift();
        state.length -= chunk.length || 1;
        this.emit('data', chunk);
      }
    }
    if (state.ended && state.buffer.length === 0 && !state.endEmitted && !state._destroyed) { state.endEmitted = true; this.readable = false; this.emit('end'); if (state.autoDestroy && (!this._writableState || this._writableState.finished)) this.destroy(); }
  }
  pause() { if (this._readableState.flowing !== false) { this._readableState.flowing = false; this.emit('pause'); } return this; }
  isPaused() { return this._readableState.flowing === false; }
  unshift(chunk, encoding) {
    const state = this._readableState;
    if (state._destroyed) return;
    if (!state.objectMode) {
      if (typeof chunk === 'string') { chunk = Buffer.from(chunk, encoding); }
      else if (chunk !== null && chunk !== undefined && !(chunk instanceof Buffer || chunk instanceof Uint8Array)) {
        const err = new TypeError(`The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received ${typeof chunk === 'object' ? 'an instance of ' + (chunk.constructor ? chunk.constructor.name : 'Object') : typeof chunk + ' (' + chunk + ')'}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        state.errored = err;
        process.nextTick(() => this.emit('error', err));
        return;
      }
    }
    if (state.encoding && Buffer.isBuffer(chunk)) chunk = chunk.toString(state.encoding);
    if (chunk !== null && chunk !== undefined) {
      const len = state.objectMode ? 1 : (chunk.length || 0);
      if (len === 0) return;
      state.buffer.unshift(chunk);
      state.length += len;
      if (state.needReadable && !state._readableEmitScheduled) {
        state._readableEmitScheduled = true;
        process.nextTick(() => { state._readableEmitScheduled = false; this.emit('readable'); });
      }
    }
  }
  destroy(err, cb) {
    if (this._readableState._destroyed) { if (cb) cb(); return this; }
    this._readableState._destroyed = true;
    this.readable = false;
    if (err) this._readableState.errored = err;
    const onDestroy = (err2) => {
      const s = this._readableState;
      const emitErr = err2 != null ? err2 : null;
      if (emitErr) s.errored = emitErr;
      process.nextTick(() => {
        if (emitErr && !s.errorEmitted) { s.errorEmitted = true; this.emit('error', emitErr); }
        this.emit('close');
      });
      if (cb) cb(err2);
    };
    this._destroy(err || null, onDestroy);
    return this;
  }
  _destroy(err, cb) { cb(err); }

  get destroyed() { return !!(this._readableState && this._readableState._destroyed); }
  set destroyed(v) { if (this._readableState) this._readableState._destroyed = v; }
  get errored() { return this._readableState.errored || null; }
  // readableEnded is true only after the 'end' event has fired (EOF consumed),
  // NOT merely when push(null) set state.ended.
  get readableEnded() { return this._readableState.endEmitted; }
  get readableFlowing() { return this._readableState.flowing; }
  get readableBuffer() { return this._readableState.buffer; }
  get readableHighWaterMark() { return this._readableState.highWaterMark; }
  get readableLength() { return this._readableState.length; }
  get readableObjectMode() { return this._readableState.objectMode; }
  get readableEncoding() { return this._readableState.encoding; }
  get readableDidRead() { return !!this._didPush; }
  get readableAborted() {
    const state = this._readableState;
    return !!(
      state.readable !== false &&
      (state._destroyed || state.errored) &&
      !state.endEmitted
    );
  }

  wrap(stream) {
    stream.on('data', (chunk) => { this.push(chunk); });
    stream.on('end', () => { this.push(null); });
    stream.on('error', (err) => { this.destroy(err); });
    this._read = () => { if (stream.resume) stream.resume(); };
    return this;
  }

  [Symbol.asyncIterator]() {
    const self = this;
    let active = true;
    if (globalThis.__ref) globalThis.__ref();
    const done = (val) => {
      if (active) { active = false; if (globalThis.__unref) globalThis.__unref(); }
      return val;
    };
    return {
      next() {
        return new Promise((resolve, reject) => {
          const err = self._readableState && self._readableState.errored;
          if (err !== undefined && err !== null) return reject(done(err));
          const chunk = self.read();
          if (chunk !== null) return resolve({ value: chunk, done: false });
          if (self._readableState.ended) return resolve(done({ done: true }));
          const cleanup = () => { self.removeListener('readable', onReadable); self.removeListener('end', onEnd); self.removeListener('error', onError); };
          const onReadable = () => { cleanup(); const c = self.read(); resolve(c !== null ? { value: c, done: false } : done({ done: true })); };
          const onEnd = () => { cleanup(); resolve(done({ done: true })); };
          // A stream error must reject the consumer's for-await, not surface as an
          // unhandled 'error' event.
          const onError = (e) => { cleanup(); done(); reject(e); };
          self.once('readable', onReadable);
          self.once('end', onEnd);
          self.once('error', onError);
        });
      },
      return() {
        return Promise.resolve(done({ done: true }));
      }
    };
  }
}

Readable.prototype.toArray = function() {
  return new Promise((resolve, reject) => {
    const arr = [];
    this.on('data', (chunk) => arr.push(chunk));
    this.on('end', () => resolve(arr));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

// Shared argument validation for the async iterator helpers (map/filter/...).
function _validateIterHelper(fn, options) {
  if (typeof fn !== 'function') {
    const e = new TypeError('The "fn" argument must be of type function. Received ' + (fn === null ? 'null' : 'type ' + typeof fn));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (options != null) {
    if (typeof options !== 'object') {
      const e = new TypeError('The "options" argument must be of type object. Received ' + (typeof options) + ' (' + options + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (options.concurrency != null) {
      const c = options.concurrency;
      if (typeof c !== 'number' || !Number.isInteger(c) || c < 1) {
        const e = new RangeError('The value of "concurrency" is out of range. It must be >= 1. Received ' + (typeof c === 'number' ? c : JSON.stringify(c)));
        e.code = 'ERR_OUT_OF_RANGE'; throw e;
      }
    }
    if (options.signal != null && !(typeof options.signal === 'object' && 'aborted' in options.signal)) {
      const e = new TypeError('The "options.signal" argument must be an instance of AbortSignal. Received ' + (typeof options.signal));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
  }
}

Readable.prototype.map = function(fn, options) {
  _validateIterHelper(fn, options);
  const dest = new Readable({ objectMode: true, read() {} });
  this.on('data', (chunk) => dest.push(fn(chunk)));
  this.on('end', () => dest.push(null));
  if (this._readableState.flowing === null) this.resume();
  return dest;
};

Readable.prototype.filter = function(fn, options) {
  _validateIterHelper(fn, options);
  const dest = new Readable({ objectMode: true, read() {} });
  this.on('data', (chunk) => { if (fn(chunk)) dest.push(chunk); });
  this.on('end', () => dest.push(null));
  if (this._readableState.flowing === null) this.resume();
  return dest;
};

Readable.prototype.reduce = function(fn, initial) {
  return new Promise((resolve, reject) => {
    let acc = initial;
    let first = acc === undefined;
    this.on('data', (chunk) => {
      if (first) { acc = chunk; first = false; }
      else acc = fn(acc, chunk);
    });
    this.on('end', () => resolve(acc));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

// drop()/take() take a numeric limit + options instead of a fn.
function _validateLimit(number, options) {
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0) {
    const e = new RangeError('The value of "number" is out of range. It must be >= 0. Received ' + (typeof number === 'number' ? number : JSON.stringify(number)));
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  if (options != null) {
    if (typeof options !== 'object') { const e = new TypeError('The "options" argument must be of type object. Received ' + typeof options + ' (' + options + ')'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (options.signal != null && !(typeof options.signal === 'object' && 'aborted' in options.signal)) { const e = new TypeError('The "options.signal" argument must be an instance of AbortSignal. Received ' + typeof options.signal); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
  }
}

Readable.prototype.forEach = function(fn, options) {
  _validateIterHelper(fn, options);
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => fn(chunk));
    this.on('end', () => resolve());
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.some = function(fn, options) {
  _validateIterHelper(fn, options);
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => { if (fn(chunk)) { resolve(true); this.destroy(); } });
    this.on('end', () => resolve(false));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.every = function(fn, options) {
  _validateIterHelper(fn, options);
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => { if (!fn(chunk)) { resolve(false); this.destroy(); } });
    this.on('end', () => resolve(true));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.find = function(fn, options) {
  _validateIterHelper(fn, options);
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => { if (fn(chunk)) { resolve(chunk); this.destroy(); } });
    this.on('end', () => resolve(undefined));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.flatMap = function(fn, options) {
  _validateIterHelper(fn, options);
  const dest = new Readable({ objectMode: true, read() {} });
  this.on('data', (chunk) => {
    const mapped = fn(chunk);
    if (mapped && typeof mapped[Symbol.iterator] === 'function') {
      for (const item of mapped) dest.push(item);
    } else {
      dest.push(mapped);
    }
  });
  this.on('end', () => dest.push(null));
  if (this._readableState.flowing === null) this.resume();
  return dest;
};

Readable.prototype.take = function(limit, options) {
  _validateLimit(limit, options);
  const dest = new Readable({ objectMode: true, read() {} });
  let count = 0;
  this.on('data', (chunk) => {
    if (count < limit) { dest.push(chunk); count++; }
    if (count >= limit) { dest.push(null); this.destroy(); }
  });
  this.on('end', () => { if (count < limit) dest.push(null); });
  if (this._readableState.flowing === null) this.resume();
  return dest;
};

Readable.prototype.drop = function(limit, options) {
  _validateLimit(limit, options);
  const dest = new Readable({ objectMode: true, read() {} });
  let count = 0;
  this.on('data', (chunk) => {
    if (count >= limit) dest.push(chunk);
    count++;
  });
  this.on('end', () => dest.push(null));
  if (this._readableState.flowing === null) this.resume();
  return dest;
};

Readable.prototype.compose = function(stream) {
  if (typeof stream === 'function') {
    const fn = stream;
    const transform = new Transform({
      objectMode: true,
      transform(chunk, enc, cb) { cb(null, chunk); }
    });
    this.pipe(transform);
    const result = fn(transform);
    if (result && typeof result[Symbol.asyncIterator] === 'function') {
      return Readable.from(result);
    }
    return result;
  }
  this.pipe(stream);
  return stream;
};

Readable.prototype.asIndexedPairs = function(options) {
  let index = 0;
  return this.map((val) => [index++, val], options);
};

Readable.prototype[Symbol.asyncDispose] = function() {
  if (!this.destroyed) {
    return new Promise((resolve) => {
      this.once('close', resolve);
      this.destroy(new DOMException('The operation was aborted', 'AbortError'));
    });
  }
  return Promise.resolve();
};

Readable.from = function(iterable, opts) {
  // Validate up front (sync throw) — must be iterable/async-iterable or a string.
  if (iterable == null || (typeof iterable !== 'string' &&
      typeof iterable[Symbol.asyncIterator] !== 'function' &&
      typeof iterable[Symbol.iterator] !== 'function')) {
    const e = new TypeError('The "iterable" argument must be an instance of Iterable. Received ' +
      (iterable === null ? 'null' : 'type ' + typeof iterable));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  const r = new Readable({ objectMode: true, highWaterMark: 16, ...opts });
  r._read = () => {};
  (async () => {
    try {
      for await (const chunk of iterable) {
        if (chunk === null) {
          const err = new TypeError('May not write null values to stream');
          err.code = 'ERR_STREAM_NULL_VALUES';
          r.destroy(err);
          return;
        }
        r.push(chunk);
      }
      r.push(null);
    } catch (e) { r.destroy(e); }
  })();
  return r;
};

Readable.fromWeb = function(readableStream, opts) {
  const r = new Readable({ ...opts });
  const reader = readableStream.getReader();
  r._read = async () => {
    try {
      const { value, done } = await reader.read();
      if (done) r.push(null);
      else r.push(value);
    } catch (e) { r.destroy(e); }
  };
  return r;
};

Readable.toWeb = function(readable) {
  return new ReadableStream({
    start(controller) {
      readable.on('data', (chunk) => controller.enqueue(chunk));
      readable.on('end', () => controller.close());
      readable.on('error', (err) => controller.error(err));
    },
    cancel() { readable.destroy(); }
  });
};

// see _readableInit — same ES5-inheritance escape hatch for the writable side
function _writableInit(self, opts) {
  self.writable = true;
  if (opts) { _validateHWM(opts.highWaterMark, 'highWaterMark'); _validateHWM(opts.writableHighWaterMark, 'writableHighWaterMark'); }
  const _wOM2 = !!(opts && opts.objectMode);
  const _wDefaultHWM2 = _wOM2 ? _defaultObjectHWM : _defaultHWM;
  const _wHWM2 = (opts && opts.highWaterMark != null) ? opts.highWaterMark : _wDefaultHWM2;
  self._writableState = { ended: false, ending: false, finished: false, corked: 0, buffered: [], bufferedRequestCount: 0, objectMode: _wOM2, needDrain: false, writing: false, length: 0, highWaterMark: _wHWM2, errorEmitted: false, errored: null, autoDestroy: opts && opts.autoDestroy !== undefined ? !!opts.autoDestroy : true, _destroyed: false, getBuffer() { return this.buffered.slice(); } };
  if (opts && opts.write) self._write = opts.write;
  if (opts && opts.writev) self._writev = opts.writev;
  if (opts && opts.destroy) self._destroy = opts.destroy;
  if (opts && opts.final) self._final = opts.final;
  if (opts && opts.defaultEncoding !== undefined) {
    if (opts.defaultEncoding === null) self._defaultEncoding = 'utf8';
    else if (!Buffer.isEncoding(opts.defaultEncoding)) throw _ERR_UNKNOWN_ENCODING(opts.defaultEncoding);
    else self._defaultEncoding = opts.defaultEncoding;
  }
  if (opts && opts.decodeStrings === false) self._decodeStrings = false;
  if (opts && opts.objectMode) self._writableState.objectMode = true;
  if (opts && opts.signal) {
    const signal = opts.signal;
    if (signal.aborted) self.destroy(new DOMException('The operation was aborted', 'AbortError'));
    else signal.addEventListener('abort', () => self.destroy(new DOMException('The operation was aborted', 'AbortError')), { once: true });
  }
}

class Writable extends Stream {
  constructor(opts) {
    super();
    _writableInit(this, opts);
  }

  pipe() { this.emit('error', new Error('Cannot pipe, not readable')); }

  _write(chunk, encoding, cb) { throw _ERR_METHOD_NOT_IMPLEMENTED('_write()'); }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (!encoding) encoding = this._defaultEncoding || 'utf8';
    if (this._writableState._destroyed || this._writableState.errored) {
      const err = this._writableState.errored || new Error('Cannot call write after a stream was destroyed');
      if (!err.code) err.code = 'ERR_STREAM_DESTROYED';
      if (cb) process.nextTick(cb, err);
      return false;
    }
    if (this._writableState.ended) {
      const err = new Error('write after end');
      err.code = 'ERR_STREAM_WRITE_AFTER_END';
      if (cb) process.nextTick(cb, err);
      // emit 'error' only once across repeated write-after-end calls.
      if (!this._writableState.errorEmitted) { this._writableState.errorEmitted = true; this._writableState.errored = err; process.nextTick(() => this.emit('error', err)); }
      return false;
    }
    if (chunk === null) {
      const err = new TypeError('May not write null values to stream');
      err.code = 'ERR_STREAM_NULL_VALUES';
      throw err;
    }
    if (!this._writableState.objectMode && typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !ArrayBuffer.isView(chunk)) {
      const v = chunk === null ? 'null' : chunk === undefined ? 'undefined'
        : typeof chunk === 'object' ? 'an instance of ' + (chunk.constructor?.name || 'Object')
        : 'type ' + typeof chunk + ' (' + String(chunk) + ')';
      const err = new TypeError('The "chunk" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ' + v);
      err.code = 'ERR_INVALID_ARG_TYPE';
      throw err;
    }
    if (typeof chunk === 'string') {
      if (encoding && !Buffer.isEncoding(encoding)) throw _ERR_UNKNOWN_ENCODING(encoding);
      if (this._decodeStrings !== false) { chunk = Buffer.from(chunk, encoding); encoding = 'buffer'; }
    } else if (!this._writableState.objectMode && !Buffer.isBuffer(chunk) && ArrayBuffer.isView(chunk)) {
      chunk = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength); encoding = 'buffer';
    }
    this._writableState.length += (this._writableState.objectMode ? 1 : (chunk.length || 0));
    if (this._writableState.corked > 0 || this._writableState.writing || (this._writev && this._write === Writable.prototype._write)) {
      this._writableState.buffered.push({ chunk, encoding: encoding || 'buffer', cb });
      this._writableState.bufferedRequestCount++;
      if (!this._writableState.corked && !this._writableState.writing) this._flushBuffered();
    } else {
      this._writableState.writing = true;
      this._doWrite(chunk, encoding || 'buffer', cb);
    }
    // Node computes the return value AFTER dispatching the write (writeOrBuffer):
    // a synchronously-completing _write has already drained state.length, so
    // write() returns true and no 'drain' round-trip is needed. Computing it
    // before dispatch made big writes to sync writables (zlib) return false
    // with the matching 'drain' already emitted — producers doing
    // `if (!write()) once('drain')` then stall forever (trpc + compression).
    const hwm = this._writableState.highWaterMark != null ? this._writableState.highWaterMark : _defaultHWM;
    const ret = this._writableState.length < hwm;
    if (!ret) this._writableState.needDrain = true;
    return ret && !this._writableState.errored;
  }

  _doWrite(chunk, encoding, cb) {
    let called = false;
    this._write(chunk, encoding, (err) => {
      if (called) { const e = new Error('Callback called multiple times'); e.code = 'ERR_MULTIPLE_CALLBACK'; process.nextTick(() => this.emit('error', e)); return; }
      called = true;
      const state = this._writableState;
      state.writing = false;
      state.length -= (state.objectMode ? 1 : (chunk.length || 0));
      if (state._destroyed) {
        if (cb) cb(err);
        return;
      }
      if (err) {
        state.errored = err;
        this.writable = false;
        if (cb) cb(err);
        // errorOrDestroy: destroy first (closes fds etc), 'error' emits after
        // _destroy completes — handlers must observe the closed state (fd null)
        if (state.autoDestroy) this.destroy(err);
        else process.nextTick(() => this.emit('error', err));
      } else {
        if (cb) cb(err);
      }
      this._flushBuffered();
      if (!state.writing && !err && state.needDrain) this._emitDrainTick();
      if (state.ending && state._tryFinish) state._tryFinish();
    });
  }

  // 'drain' must never fire synchronously inside a write() call — a producer
  // that sees write()===false and THEN attaches once('drain') would miss it
  // and stall (node defers afterWrite to a tick for sync writes).
  _emitDrainTick() {
    const state = this._writableState;
    if (state._drainScheduled) return;
    state._drainScheduled = true;
    process.nextTick(() => {
      state._drainScheduled = false;
      if (state._destroyed || state.errored || state.writing || !state.needDrain) return;
      const hwm = state.highWaterMark != null ? state.highWaterMark : _defaultHWM;
      if (state.length < hwm || state.length === 0) {
        state.needDrain = false;
        this.emit('drain');
      }
    });
  }

  _flushBuffered() {
    const state = this._writableState;
    if (state.buffered.length === 0 || state.corked > 0 || state.writing) return;
    const hasOwnWrite = this._write !== Writable.prototype._write;
    if (this._writev && (state.buffered.length > 1 || !hasOwnWrite)) {
      const entries = state.buffered.splice(0);
      state.bufferedRequestCount = 0;
      state.writing = true;
      const chunks = entries.map(e => ({ chunk: e.chunk, encoding: e.encoding }));
      let totalLen = 0;
      for (const e of entries) totalLen += state.objectMode ? 1 : (e.chunk.length || 0);
      let called = false;
      this._writev(chunks, (err) => {
        if (called) { const e = new Error('Callback called multiple times'); e.code = 'ERR_MULTIPLE_CALLBACK'; process.nextTick(() => this.emit('error', e)); return; }
        called = true;
        state.writing = false;
        state.length -= totalLen;
        if (err) {
          state.errored = err;
          for (const e of entries) { if (e.cb) e.cb(err); }
          // see _doWrite — errorOrDestroy ordering
          if (state.autoDestroy) this.destroy(err);
          else process.nextTick(() => this.emit('error', err));
        } else {
          for (const e of entries) { if (e.cb) e.cb(null); }
        }
        this._flushBuffered();
        if (!state.writing && !err && state.needDrain) this._emitDrainTick();
        if (state.ending && state._tryFinish) state._tryFinish();
      });
      return;
    }
    while (state.buffered.length > 0 && state.corked === 0 && !state.writing) {
      const entry = state.buffered.shift();
      state.bufferedRequestCount--;
      state.writing = true;
      this._doWrite(entry.chunk, entry.encoding, entry.cb);
      break;
    }
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    if (this._writableState.ending || this._writableState._destroyed) {
      if (cb) {
        const err = this._writableState.errored;
        if (err) {
          process.nextTick(cb, err);
        } else if (this._writableState._endCbs) {
          this._writableState._endCbs.push(cb);
        } else {
          const e = new Error('write after end');
          e.code = 'ERR_STREAM_WRITE_AFTER_END';
          process.nextTick(cb, e);
        }
      }
      if (chunk != null && !this._writableState._destroyed) {
        const e = new Error('write after end');
        e.code = 'ERR_STREAM_WRITE_AFTER_END';
        this.destroy(e);
      }
      return this;
    }
    if (chunk != null) this.write(chunk, encoding);
    this._writableState.corked = 0;
    this._flushBuffered();
    this._writableState.ending = true;
    this._writableState.ended = true;
    this.writable = false;
    if (!this._writableState._endCbs) this._writableState._endCbs = [];
    if (cb) this._writableState._endCbs.push(cb);
    const prefinish = () => {
      if (this._writableState._prefinished) return;
      this._writableState._prefinished = true;
      this._writableState.finished = true;
      this.emit('prefinish');
    };
    const finish = (err) => {
      const cbs = this._writableState._endCbs || [];
      this._writableState._endCbs = [];
      if (err) {
        for (const c of cbs) c(err);
        this.destroy(err);
        return;
      }
      prefinish();
      for (const c of cbs) c(null);
      this.emit('finish');
      if (this._writableState.autoDestroy) {
        const rState = this._readableState;
        if (!rState || rState.ended) process.nextTick(() => { if (!this.destroyed) this.destroy(); });
      }
    };
    // Event-driven finish: re-checked from each write/writev completion.
    // Never poll — a user _write that drops its callback must leave the
    // process free to exit (e.g. read-stream-encoding's assert-only writable),
    // not spin setImmediate forever.
    const tryFinish = () => {
      const s = this._writableState;
      if (s._finishing) return;
      if (s._destroyed || s.errored) {
        const cbs = s._endCbs || [];
        s._endCbs = [];
        const e = s.errored;
        for (const c of cbs) c(e);
        return;
      }
      if (s.buffered.length > 0 || s.writing) return;
      s._finishing = true;
      if (this._final) {
        prefinish();
        let called = false;
        this._final((err) => {
          if (called) { const e = new Error('Callback called multiple times'); e.code = 'ERR_MULTIPLE_CALLBACK'; process.nextTick(() => this.emit('error', e)); return; }
          called = true;
          finish(err);
        });
      } else {
        prefinish();
        process.nextTick(finish);
      }
    };
    this._writableState._tryFinish = tryFinish;
    this._flushBuffered();
    tryFinish();
    return this;
  }

  cork() { this._writableState.corked++; }
  uncork() { this._writableState.corked = Math.max(0, this._writableState.corked - 1); this._flushBuffered(); }
  destroy(err, cb) {
    if (this._writableState._destroyed) { if (cb) cb(); return this; }
    this._writableState._destroyed = true;
    this.writable = false;
    if (err) this._writableState.errored = err;
    const s = this._writableState;
    // a pending end() must settle its callbacks now that the stream is dead
    if (s.ending && s._tryFinish) s._tryFinish();
    while (s.buffered.length > 0) {
      const entry = s.buffered.shift();
      if (entry.cb) {
        const e = new Error('Cannot call write after a stream was destroyed'); e.code = 'ERR_STREAM_DESTROYED';
        process.nextTick(entry.cb, e);
      }
    }
    const onDestroy = (err2) => {
      const emitErr = err2 != null ? err2 : null;
      if (emitErr) s.errored = emitErr;
      process.nextTick(() => {
        if (emitErr && !s.errorEmitted) { s.errorEmitted = true; this.emit('error', emitErr); }
        this.emit('close');
      });
      if (cb) cb(err2);
    };
    this._destroy(err || null, onDestroy);
    return this;
  }
  _destroy(err, cb) { cb(err); }
  get errored() { return this._writableState.errored || null; }
  setDefaultEncoding(enc) {
    const normalized = typeof enc === 'string' ? enc.toLowerCase() : String(enc);
    if (!Buffer.isEncoding(normalized)) {
      const label = typeof enc === 'object' ? '{}' : enc;
      const err = new TypeError('Unknown encoding: ' + label);
      err.code = 'ERR_UNKNOWN_ENCODING';
      throw err;
    }
    this._defaultEncoding = normalized;
    return this;
  }

  _undestroy() {
    const s = this._writableState;
    s._destroyed = false; s.ended = false; s.ending = false; s.finished = false; s.errorEmitted = false; s.errored = undefined;
  }
  get destroyed() { return !!(this._writableState && this._writableState._destroyed); }
  set destroyed(v) { if (this._writableState) this._writableState._destroyed = v; }
  get writableEnded() { return this._writableState.ended; }
  get writableFinished() { return this._writableState.finished; }
  get writableHighWaterMark() { return this._writableState && this._writableState.highWaterMark != null ? this._writableState.highWaterMark : _defaultHWM; }
  get writableLength() { return (this._writableState && this._writableState.length) || 0; }
  get writableObjectMode() { return !!(this._writableState && this._writableState.objectMode); }
  get writableCorked() { return (this._writableState && this._writableState.corked) || 0; }
  get writableNeedDrain() { return !!(this._writableState && this._writableState.needDrain); }
  [Symbol.asyncDispose]() {
    if (!this.destroyed) {
      return new Promise((resolve) => {
        this.once('close', resolve);
        this.destroy(new DOMException('The operation was aborted', 'AbortError'));
      });
    }
    return Promise.resolve();
  }
}

// see _readableInit — duplex's writable-side setup, callable on a foreign `this`
function _duplexInit(self, opts) {
  self.writable = true;
  if (opts && opts.readable === false) { self.readable = false; self._readableState.readable = false; }
  if (opts && opts.writable === false) self.writable = false;
  if (opts) _validateHWM(opts.writableHighWaterMark, 'writableHighWaterMark');
  self.allowHalfOpen = opts && opts.allowHalfOpen !== undefined ? opts.allowHalfOpen : true;
  const _wOM = opts ? (opts.writableObjectMode != null ? opts.writableObjectMode : !!opts.objectMode) : false;
  const _wDefaultHWM = _wOM ? _defaultObjectHWM : _defaultHWM;
  let _wHWM = _wDefaultHWM;
  if (opts) {
    if (opts.highWaterMark != null) _wHWM = opts.highWaterMark;
    else if (opts.writableHighWaterMark != null) _wHWM = opts.writableHighWaterMark;
  }
  self._writableState = { ended: false, ending: false, finished: false, corked: 0, buffered: [], objectMode: _wOM, needDrain: false, writing: false, length: 0, highWaterMark: _wHWM, errorEmitted: false, errored: null, autoDestroy: opts && opts.autoDestroy !== undefined ? !!opts.autoDestroy : true, getBuffer() { return this.buffered.slice(); } };
  if (opts && opts.write) self._write = opts.write;
  if (opts && opts.writev) self._writev = opts.writev;
  if (opts && opts.destroy) self._destroy = opts.destroy;
  if (opts && opts.final) self._final = opts.final;
  if (opts && opts.defaultEncoding) self._defaultEncoding = opts.defaultEncoding;
  if (opts && opts.decodeStrings === false) self._decodeStrings = false;
}

class Duplex extends Readable {
  constructor(opts) {
    super(opts);
    _duplexInit(this, opts);
  }

  get destroyed() { return !!((this._readableState && this._readableState._destroyed) || (this._writableState && this._writableState._destroyed)); }
  set destroyed(v) { if (this._readableState) this._readableState._destroyed = v; if (this._writableState) this._writableState._destroyed = v; }
  get writableEnded() { return this._writableState.ended; }
  get writableFinished() { return this._writableState.finished; }
  get writableHighWaterMark() { return this._writableState && this._writableState.highWaterMark != null ? this._writableState.highWaterMark : _defaultHWM; }
  get writableLength() { return (this._writableState && this._writableState.length) || 0; }
  get writableObjectMode() { return !!(this._writableState && this._writableState.objectMode); }
  get writableCorked() { return (this._writableState && this._writableState.corked) || 0; }
  get writableNeedDrain() { return !!(this._writableState && this._writableState.needDrain); }
  _read() {}

  destroy(err, cb) {
    if (this._readableState._destroyed && this._writableState._destroyed) { if (cb) cb(); return this; }
    this._readableState._destroyed = true;
    this._writableState._destroyed = true;
    this.readable = false;
    this.writable = false;
    if (err) { this._readableState.errored = err; this._writableState.errored = err; }
    const ws = this._writableState;
    while (ws.buffered.length > 0) {
      const entry = ws.buffered.shift();
      if (entry.cb) {
        const e = new Error('Cannot call write after a stream was destroyed'); e.code = 'ERR_STREAM_DESTROYED';
        process.nextTick(entry.cb, e);
      }
    }
    const onDestroy = (err2) => {
      const rs = this._readableState; const ws = this._writableState;
      const emitErr = err2 != null ? err2 : null;
      if (emitErr) { rs.errored = emitErr; ws.errored = emitErr; }
      process.nextTick(() => {
        if (emitErr && !ws.errorEmitted) { ws.errorEmitted = true; rs.errorEmitted = true; this.emit('error', emitErr); }
        this.emit('close');
      });
      if (cb) cb(err2);
    };
    this._destroy(err || null, onDestroy);
    return this;
  }
}
Object.getOwnPropertyNames(Writable.prototype).forEach(method => {
  if (method === 'constructor' || method === 'destroyed' || method === 'destroy' || method === 'pipe') return;
  if (!Object.getOwnPropertyDescriptor(Duplex.prototype, method)) {
    const desc = Object.getOwnPropertyDescriptor(Writable.prototype, method);
    if (desc) Object.defineProperty(Duplex.prototype, method, desc);
  }
});

// see _readableInit — transform state setup, callable on a foreign `this`
function _transformInit(self, opts) {
  // Couple readable backpressure to the writable side (Node's algorithm):
  // hold the write callback until the readable side is read, so a full
  // readable buffer makes write() return false instead of accepting forever.
  self._transformState = { transforming: false, writechunk: null, writeencoding: null, writecb: null, needTransform: false };
  if (opts && opts.transform) self._transform = opts.transform;
  if (opts && typeof opts.flush === 'function') self._flush = opts.flush;
  if (opts && typeof opts.final === 'function') self._final = opts.final;
  self.on('prefinish', () => {
    if (typeof self._flush === 'function' && !self.destroyed) {
      self._flush((err, data) => {
        if (data != null) self.push(data);
        if (!err) self.push(null);
      });
    } else {
      self.push(null);
    }
  });
}

class Transform extends Duplex {
  constructor(opts) {
    super(opts);
    _transformInit(this, opts);
  }

  _transform(chunk, encoding, cb) { throw _ERR_METHOD_NOT_IMPLEMENTED('_transform()'); }

  _afterTransform(err, data) {
    const ts = this._transformState;
    ts.transforming = false;
    const cb = ts.writecb;
    if (cb === null) {
      const e = new Error('Callback called multiple times');
      e.code = 'ERR_MULTIPLE_CALLBACK';
      this.emit('error', e);
      return;
    }
    ts.writechunk = null;
    ts.writecb = null;
    if (data != null) this.push(data);
    cb(err);
    const rs = this._readableState;
    rs.reading = false;
    if (rs.needReadable || rs.length < rs.highWaterMark) {
      this._read(rs.highWaterMark);
    }
  }

  _read(n) {
    const ts = this._transformState;
    if (ts.writechunk !== null && !ts.transforming) {
      ts.needTransform = false; // consuming the pending chunk; clear the read-demand flag
      ts.transforming = true;
      this._transform(ts.writechunk, ts.writeencoding, (err, data) => this._afterTransform(err, data));
    } else {
      ts.needTransform = true;
    }
  }

  _write(chunk, encoding, cb) {
    const ts = this._transformState;
    ts.writecb = cb;
    ts.writechunk = chunk;
    ts.writeencoding = encoding;
    if (!ts.transforming) {
      const rs = this._readableState;
      if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) {
        this._read(rs.highWaterMark);
      }
    }
  }
}

class PassThrough extends Transform {
  _transform(chunk, encoding, cb) { cb(null, chunk); }
}

function pipeline(...streams) {
  const cb = typeof streams[streams.length - 1] === 'function' ? streams.pop() : null;
  for (let i = 0; i < streams.length - 1; i++) streams[i].pipe(streams[i + 1]);
  const last = streams[streams.length - 1];
  if (cb) {
    last.on('finish', () => cb(null));
    last.on('error', cb);
    streams[0].on('error', cb);
  }
  return last;
}

function finished(stream, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  opts = opts || {};
  if (!stream || (typeof stream !== 'object' && typeof stream !== 'function') || typeof stream.on !== 'function') {
    const e = new TypeError('The "stream" argument must be an instance of Stream. Received ' + (stream === null ? 'null' : typeof stream === 'object' ? 'an instance of ' + (stream.constructor?.name || 'Object') : 'type ' + typeof stream));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  let called = false;
  const done = (err) => { if (called) return; called = true; cleanup(); cb(err || null); };
  const onFinish = () => done();
  const onEnd = () => done();
  const onClose = () => done();
  const onError = (err) => done(err);
  stream.on('finish', onFinish);
  stream.on('end', onEnd);
  stream.on('close', onClose);
  stream.on('error', onError);
  function cleanup() {
    stream.removeListener('finish', onFinish); stream.removeListener('end', onEnd);
    stream.removeListener('close', onClose); stream.removeListener('error', onError);
  }
  // Handle already-finished/ended streams
  if (stream._writableState && stream._writableState.finished) process.nextTick(done);
  else if (stream._readableState && stream._readableState.endEmitted) process.nextTick(done);
  else if (stream.destroyed) process.nextTick(done);
}

function compose(...streams) {
  if (streams.length === 0) throw new Error('compose requires at least one stream');
  if (streams.length === 1) return streams[0];
  const first = streams[0];
  for (let i = 0; i < streams.length - 1; i++) streams[i].pipe(streams[i + 1]);
  const last = streams[streams.length - 1];
  const composed = new Duplex({
    write(chunk, enc, cb) { first.write(chunk, enc, cb); },
    final(cb) { first.end(); last.once('end', cb); },
    read() {},
  });
  last.on('data', (chunk) => composed.push(chunk));
  last.on('end', () => composed.push(null));
  return composed;
}

const promises = {
  pipeline: (...streams) => new Promise((resolve, reject) => pipeline(...streams, (err) => err ? reject(err) : resolve())),
  finished: (stream, opts) => new Promise((resolve, reject) => finished(stream, opts, (err) => err ? reject(err) : resolve())),
};

// Allow calling stream classes without new (Node.js compat)
// Calling a stream class as a function either constructs (legacy `Readable(opts)`)
// or, when `this` is already an instance (ES5 inheritance: util.inherits +
// `Readable.call(this, opts)`, e.g. graceful-fs, readable-stream consumers),
// initializes that instance in place via the extracted init fns.
function _proxyClass(Cls, initInPlace) {
  return new Proxy(Cls, { apply(target, thisArg, args) {
    if (initInPlace && thisArg instanceof target) { initInPlace(thisArg, args[0]); return thisArg; }
    return new target(...args);
  } });
}
const _initR = (s, o) => { Stream.call(s); _readableInit(s, o); };
const _initW = (s, o) => { Stream.call(s); _writableInit(s, o); };
const _initD = (s, o) => { Stream.call(s); _readableInit(s, o); _duplexInit(s, o); };
const _initT = (s, o) => { _initD(s, o); _transformInit(s, o); };
const _Readable = _proxyClass(Readable, _initR);
const _Writable = _proxyClass(Writable, _initW);
const _Duplex = _proxyClass(Duplex, _initD);
const _Transform = _proxyClass(Transform, _initT);
const _PassThrough = _proxyClass(PassThrough, _initT);

module.exports = Stream;
module.exports.Stream = Stream;
// internal: lets fs.js build ES5-style ReadStream/WriteStream (overridable
// prototype.open, graceful-fs compat) on top of the class-based internals
module.exports._readableInit = _initR;
module.exports._writableInit = _initW;
module.exports.Readable = _Readable;
module.exports.Writable = _Writable;
module.exports.Duplex = _Duplex;
module.exports.Transform = _Transform;
module.exports.PassThrough = _PassThrough;
module.exports.duplexPair = function duplexPair() {
  const a = new Duplex({ read() {}, write(chunk, enc, cb) { b.push(chunk); cb(); } });
  const b = new Duplex({ read() {}, write(chunk, enc, cb) { a.push(chunk); cb(); } });
  return [a, b];
};
module.exports.pipeline = pipeline;
module.exports.finished = finished;
module.exports.isDisturbed = function isDisturbed(stream) { return !!(stream && (stream._didPush || stream._readableState && stream._readableState.endEmitted)); };
module.exports.isReadable = function isReadable(stream) { return !!(stream && stream.readable && !stream.destroyed && !stream._readableState.ended); };
module.exports.isErrored = function isErrored(stream) { return !!(stream && stream._readableState && stream._readableState.errored || stream && stream._writableState && stream._writableState.errored); };
module.exports.destroy = function destroy(stream, err) {
  if (!err) { const a = new DOMException('The operation was aborted', 'AbortError'); a.name = 'AbortError'; err = a; }
  stream.destroy(err);
};
module.exports.compose = compose;
module.exports.addAbortSignal = function addAbortSignal(signal, stream) {
  if (signal.aborted) { stream.destroy(new DOMException('The operation was aborted', 'AbortError')); }
  else { signal.addEventListener('abort', () => stream.destroy(new DOMException('The operation was aborted', 'AbortError')), { once: true }); }
  return stream;
};
module.exports.promises = promises;
module.exports.consumers = { arrayBuffer: async (s) => { const c = []; for await (const ch of s) c.push(ch); return Buffer.concat(c).buffer; }, text: async (s) => { const c = []; for await (const ch of s) c.push(ch); return Buffer.concat(c).toString(); }, json: async (s) => JSON.parse(await module.exports.consumers.text(s)), blob: async (s) => { const c = []; for await (const ch of s) c.push(ch); return new Blob([Buffer.concat(c)]); }, buffer: async (s) => { const c = []; for await (const ch of s) c.push(ch); return Buffer.concat(c); }, bytes: async (s) => { const c = []; for await (const ch of s) c.push(ch); return new Uint8Array(Buffer.concat(c)); } };
module.exports.web = {
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
  ByteLengthQueuingStrategy: globalThis.ByteLengthQueuingStrategy,
  CountQueuingStrategy: globalThis.CountQueuingStrategy,
  ReadableStreamDefaultReader: globalThis.ReadableStream ? class ReadableStreamDefaultReader { constructor(stream) { return stream.getReader(); } } : undefined,
  ReadableByteStreamController: undefined,
  ReadableStreamBYOBReader: undefined,
  ReadableStreamBYOBRequest: undefined,
  ReadableStreamDefaultController: undefined,
  TransformStreamDefaultController: undefined,
  WritableStreamDefaultController: undefined,
  WritableStreamDefaultWriter: globalThis.WritableStream ? class WritableStreamDefaultWriter { constructor(stream) { return stream.getWriter(); } } : undefined,
};

module.exports.getDefaultHighWaterMark = function(objectMode) { return objectMode ? _defaultObjectHWM : _defaultHWM; };
module.exports.setDefaultHighWaterMark = function(objectMode, value) { if (objectMode) _defaultObjectHWM = value; else _defaultHWM = value; };
