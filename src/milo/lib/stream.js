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

// Function-based so old-style util.inherits + .call() works
function Stream() { EventEmitter.call(this); }
Object.setPrototypeOf(Stream.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Stream, EventEmitter);
Stream.prototype.pipe = function pipe(dest, opts) {
  if (this._readableState && this._readableState.pipes) {
    this._readableState.pipes.push(dest);
  }
  if (!this._pipeListeners) this._pipeListeners = [];
  const src = this;
  const ondata = (chunk) => {
    if (dest.writable !== false) {
      const canContinue = dest.write(chunk);
      if (canContinue === false && src.pause) src.pause();
    }
  };
  this.on('data', ondata);
  const onend = () => { if (!opts || opts.end !== false) dest.end(); };
  this.on('end', onend);
  const ondrain = () => { if (src.resume) src.resume(); };
  dest.on('drain', ondrain);
  const onclose = () => { src.unpipe(dest); };
  dest.on('close', onclose);
  const onfinish = () => { src.unpipe(dest); };
  dest.on('finish', onfinish);
  const onerror = (err) => { src.unpipe(dest); };
  dest.on('error', onerror);
  this._pipeListeners.push({ dest, ondata, onend, ondrain, onclose, onfinish, onerror });
  dest.emit('pipe', this);
  if (this.resume) this.resume();
  return dest;
};

Stream.prototype.unpipe = function unpipe(dest) {
  if (this._readableState && this._readableState.pipes) {
    if (!dest) {
      const pipes = this._readableState.pipes.slice();
      this._readableState.pipes = [];
      if (this._pipeListeners) {
        for (const entry of this._pipeListeners) {
          this.removeListener('data', entry.ondata);
          this.removeListener('end', entry.onend);
          entry.dest.removeListener('drain', entry.ondrain);
          if (entry.onclose) entry.dest.removeListener('close', entry.onclose);
          if (entry.onfinish) entry.dest.removeListener('finish', entry.onfinish);
          if (entry.onerror) entry.dest.removeListener('error', entry.onerror);
        }
        this._pipeListeners = [];
      }
      this._readableState.flowing = false;
      this.emit('pause');
      for (const d of pipes) d.emit('unpipe', this);
    } else {
      const idx = this._readableState.pipes.indexOf(dest);
      if (idx >= 0) {
        this._readableState.pipes.splice(idx, 1);
        if (this._pipeListeners) {
          const li = this._pipeListeners.findIndex(e => e.dest === dest);
          if (li >= 0) {
            const entry = this._pipeListeners[li];
            this.removeListener('data', entry.ondata);
            this.removeListener('end', entry.onend);
            dest.removeListener('drain', entry.ondrain);
            if (entry.onclose) dest.removeListener('close', entry.onclose);
            if (entry.onfinish) dest.removeListener('finish', entry.onfinish);
            if (entry.onerror) dest.removeListener('error', entry.onerror);
            this._pipeListeners.splice(li, 1);
          }
        }
        if (this._readableState.pipes.length === 0) {
          this._readableState.flowing = false;
          this.emit('pause');
        }
        dest.emit('unpipe', this);
      }
    }
  }
  return this;
};

class Readable extends Stream {
  constructor(opts) {
    super();
    this.readable = true;
    if (opts) { _validateHWM(opts.highWaterMark, 'highWaterMark'); _validateHWM(opts.readableHighWaterMark, 'readableHighWaterMark'); }
    const _isDuplex = this instanceof Duplex;
    const _rOM = opts ? (opts.readableObjectMode != null ? opts.readableObjectMode : !!opts.objectMode) : false;
    const _rDefaultHWM = _rOM ? 16 : 65536;
    let _rHWM = _rDefaultHWM;
    if (opts) {
      if (opts.highWaterMark != null) _rHWM = opts.highWaterMark;
      else if (_isDuplex && opts.readableHighWaterMark != null) _rHWM = opts.readableHighWaterMark;
    }
    this._readableState = {
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
    if (opts && opts.encoding) this.setEncoding(opts.encoding);
    if (opts && opts.defaultEncoding !== undefined) {
      if (!Buffer.isEncoding(opts.defaultEncoding)) throw _ERR_UNKNOWN_ENCODING(opts.defaultEncoding);
      this._readableState.defaultEncoding = opts.defaultEncoding;
    }
    if (opts && opts.read) this._read = opts.read;
    if (opts && opts.destroy) this._destroy = opts.destroy;
    if (opts && opts.signal) {
      const signal = opts.signal;
      if (signal.aborted) this.destroy(new DOMException('The operation was aborted', 'AbortError'));
      else signal.addEventListener('abort', () => this.destroy(new DOMException('The operation was aborted', 'AbortError')), { once: true });
    }
  }

  _read(_size) {
    const err = new Error('The _read() method is not implemented');
    err.code = 'ERR_METHOD_NOT_IMPLEMENTED';
    this.destroy(err);
  }

  read(size) {
    const state = this._readableState;
    if (state._destroyed) return null;
    if (state.buffer.length === 0) {
      if (state.ended) {
        state.reading = false;
        if (!state.endEmitted) { state.endEmitted = true; process.nextTick(() => { this.readable = false; this.emit('end'); if (state.autoDestroy && (!this._writableState || this._writableState.finished)) this.destroy(); }); }
        return null;
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
    if (chunk === undefined) return state.length < state.highWaterMark;
    if (chunk === null) {
      state.ended = true;
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
      process.nextTick(() => this.emit('error', err));
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
    if (state.encoding && Buffer.isBuffer(chunk)) chunk = chunk.toString(state.encoding);
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
          if (!state.reading && !state.ended && state.length < state.highWaterMark) {
            state.reading = true;
            this._read(state.highWaterMark);
            state.reading = false;
            if (state.length > 0) {
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

  setEncoding(enc) { this._readableState.encoding = enc || 'utf8'; return this; }
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
  get readableEnded() { return this._readableState.ended; }
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
        return new Promise((resolve) => {
          const chunk = self.read();
          if (chunk !== null) return resolve({ value: chunk, done: false });
          if (self._readableState.ended) return resolve(done({ done: true }));
          self.once('readable', () => {
            const c = self.read();
            resolve(c !== null ? { value: c, done: false } : done({ done: true }));
          });
          self.once('end', () => resolve(done({ done: true })));
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

Readable.prototype.map = function(fn, options) {
  const dest = new Readable({ objectMode: true, read() {} });
  this.on('data', (chunk) => dest.push(fn(chunk)));
  this.on('end', () => dest.push(null));
  if (this._readableState.flowing === null) this.resume();
  return dest;
};

Readable.prototype.filter = function(fn, options) {
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

Readable.prototype.forEach = function(fn) {
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => fn(chunk));
    this.on('end', () => resolve());
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.some = function(fn) {
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => { if (fn(chunk)) { resolve(true); this.destroy(); } });
    this.on('end', () => resolve(false));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.every = function(fn) {
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => { if (!fn(chunk)) { resolve(false); this.destroy(); } });
    this.on('end', () => resolve(true));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.find = function(fn) {
  return new Promise((resolve, reject) => {
    this.on('data', (chunk) => { if (fn(chunk)) { resolve(chunk); this.destroy(); } });
    this.on('end', () => resolve(undefined));
    this.on('error', reject);
    if (this._readableState.flowing === null) this.resume();
  });
};

Readable.prototype.flatMap = function(fn, options) {
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

Readable.prototype.take = function(limit) {
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

Readable.prototype.drop = function(limit) {
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

Readable.from = function(iterable, opts) {
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

class Writable extends Stream {
  constructor(opts) {
    super();
    this.writable = true;
    if (opts) { _validateHWM(opts.highWaterMark, 'highWaterMark'); _validateHWM(opts.writableHighWaterMark, 'writableHighWaterMark'); }
    const _wOM2 = !!(opts && opts.objectMode);
    const _wDefaultHWM2 = _wOM2 ? 16 : 65536;
    const _wHWM2 = (opts && opts.highWaterMark != null) ? opts.highWaterMark : _wDefaultHWM2;
    this._writableState = { ended: false, ending: false, finished: false, corked: 0, buffered: [], bufferedRequestCount: 0, objectMode: _wOM2, needDrain: false, writing: false, length: 0, highWaterMark: _wHWM2, errorEmitted: false, errored: null, autoDestroy: opts && opts.autoDestroy !== undefined ? !!opts.autoDestroy : true, _destroyed: false, writable: true };
    if (opts && opts.write) this._write = opts.write;
    if (opts && opts.writev) this._writev = opts.writev;
    if (opts && opts.destroy) this._destroy = opts.destroy;
    if (opts && opts.final) this._final = opts.final;
    if (opts && opts.defaultEncoding !== undefined) {
      if (opts.defaultEncoding === null) this._defaultEncoding = 'utf8';
      else if (!Buffer.isEncoding(opts.defaultEncoding)) throw _ERR_UNKNOWN_ENCODING(opts.defaultEncoding);
      else this._defaultEncoding = opts.defaultEncoding;
    }
    if (opts && opts.decodeStrings === false) this._decodeStrings = false;
    if (opts && opts.objectMode) this._writableState.objectMode = true;
    if (opts && opts.signal) {
      const signal = opts.signal;
      if (signal.aborted) this.destroy(new DOMException('The operation was aborted', 'AbortError'));
      else signal.addEventListener('abort', () => this.destroy(new DOMException('The operation was aborted', 'AbortError')), { once: true });
    }
  }

  _write(chunk, encoding, cb) { cb(_ERR_METHOD_NOT_IMPLEMENTED('_write()')); }

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
      process.nextTick(() => this.emit('error', err));
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
    }
    this._writableState.length += (this._writableState.objectMode ? 1 : (chunk.length || 0));
    const hwm = this._writableState.highWaterMark != null ? this._writableState.highWaterMark : 65536;
    const ret = this._writableState.length < hwm;
    if (!ret) this._writableState.needDrain = true;
    if (this._writableState.corked > 0 || this._writableState.writing) {
      this._writableState.buffered.push({ chunk, encoding: encoding || 'buffer', cb });
      this._writableState.bufferedRequestCount++;
      return ret;
    }
    this._writableState.writing = true;
    this._doWrite(chunk, encoding || 'buffer', cb);
    return ret && !this._writableState.errored;
  }

  _doWrite(chunk, encoding, cb) {
    let called = false;
    this._write(chunk, encoding, (err) => {
      if (called) { const e = new Error('Callback called multiple times'); e.code = 'ERR_MULTIPLE_CALLBACK'; this.emit('error', e); return; }
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
        if (cb) cb(err);
        process.nextTick(() => this.emit('error', err));
      } else {
        const hwm = state.highWaterMark != null ? state.highWaterMark : 65536;
        if (state.needDrain && state.length < hwm) {
          state.needDrain = false;
          this.emit('drain');
        }
        if (cb) cb(err);
      }
      this._flushBuffered();
    });
  }

  _flushBuffered() {
    while (this._writableState.buffered.length > 0 && this._writableState.corked === 0 && !this._writableState.writing) {
      const entry = this._writableState.buffered.shift();
      this._writableState.bufferedRequestCount--;
      this._writableState.writing = true;
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
    const waitDrain = () => {
      const s = this._writableState;
      if (s._destroyed || s.errored) {
        const cbs = s._endCbs || [];
        s._endCbs = [];
        const e = s.errored;
        for (const c of cbs) c(e);
        return;
      }
      if (s.buffered.length > 0 || s.writing) {
        process.nextTick(waitDrain);
      } else if (this._final) {
        prefinish();
        let called = false;
        this._final((err) => {
          if (called) { const e = new Error('Callback called multiple times'); e.code = 'ERR_MULTIPLE_CALLBACK'; this.emit('error', e); return; }
          called = true;
          finish(err);
        });
      } else {
        prefinish();
        process.nextTick(finish);
      }
    };
    this._flushBuffered();
    waitDrain();
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
  get writableHighWaterMark() { return this._writableState && this._writableState.highWaterMark != null ? this._writableState.highWaterMark : 65536; }
  get writableLength() { return (this._writableState && this._writableState.length) || 0; }
  get writableObjectMode() { return !!(this._writableState && this._writableState.objectMode); }
  get writableCorked() { return (this._writableState && this._writableState.corked) || 0; }
  get writableNeedDrain() { return !!(this._writableState && this._writableState.needDrain); }
}

class Duplex extends Readable {
  constructor(opts) {
    super(opts);
    this.writable = true;
    if (opts && opts.readable === false) { this.readable = false; this._readableState.readable = false; }
    if (opts && opts.writable === false) this.writable = false;
    if (opts) _validateHWM(opts.writableHighWaterMark, 'writableHighWaterMark');
    this.allowHalfOpen = opts && opts.allowHalfOpen !== undefined ? opts.allowHalfOpen : true;
    const _wOM = opts ? (opts.writableObjectMode != null ? opts.writableObjectMode : !!opts.objectMode) : false;
    const _wDefaultHWM = _wOM ? 16 : 65536;
    let _wHWM = _wDefaultHWM;
    if (opts) {
      if (opts.highWaterMark != null) _wHWM = opts.highWaterMark;
      else if (opts.writableHighWaterMark != null) _wHWM = opts.writableHighWaterMark;
    }
    this._writableState = { ended: false, ending: false, finished: false, corked: 0, buffered: [], objectMode: _wOM, needDrain: false, writing: false, length: 0, highWaterMark: _wHWM, errorEmitted: false, errored: null, autoDestroy: opts && opts.autoDestroy !== undefined ? !!opts.autoDestroy : true };
    if (opts && opts.write) this._write = opts.write;
    if (opts && opts.writev) this._writev = opts.writev;
    if (opts && opts.destroy) this._destroy = opts.destroy;
    if (opts && opts.final) this._final = opts.final;
    if (opts && opts.defaultEncoding) this._defaultEncoding = opts.defaultEncoding;
    if (opts && opts.decodeStrings === false) this._decodeStrings = false;
  }

  get destroyed() { return !!((this._readableState && this._readableState._destroyed) || (this._writableState && this._writableState._destroyed)); }
  set destroyed(v) { if (this._readableState) this._readableState._destroyed = v; if (this._writableState) this._writableState._destroyed = v; }
  get writableEnded() { return this._writableState.ended; }
  get writableFinished() { return this._writableState.finished; }
  get writableHighWaterMark() { return this._writableState && this._writableState.highWaterMark != null ? this._writableState.highWaterMark : 65536; }
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
  if (method === 'constructor' || method === 'destroyed' || method === 'destroy') return;
  if (!Object.getOwnPropertyDescriptor(Duplex.prototype, method)) {
    const desc = Object.getOwnPropertyDescriptor(Writable.prototype, method);
    if (desc) Object.defineProperty(Duplex.prototype, method, desc);
  }
});

class Transform extends Duplex {
  constructor(opts) {
    const userFinal = opts && opts.final;
    if (opts) delete opts.final;
    super(opts);
    if (opts && opts.transform) this._transform = opts.transform;
    if (opts && typeof opts.flush === 'function') this._flush = opts.flush;
    if (userFinal) this._userFinal = userFinal;
  }

  _read() {}

  _transform(chunk, encoding, cb) { cb(null, chunk); }

  _write(chunk, encoding, cb) {
    this._transform(chunk, encoding, (err, data) => {
      if (data != null) this.push(data);
      cb(err);
    });
  }

  _final(cb) {
    const doFlush = () => {
      if (this._flush) {
        this._flush((err, data) => {
          if (data != null) this.push(data);
          this.push(null);
          cb(err);
        });
      } else {
        this.push(null);
        cb();
      }
    };
    if (this._userFinal) {
      this._userFinal(doFlush);
    } else {
      doFlush();
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
function _proxyClass(Cls) {
  return new Proxy(Cls, { apply(target, _, args) { return new target(...args); } });
}
const _Readable = _proxyClass(Readable);
const _Writable = _proxyClass(Writable);
const _Duplex = _proxyClass(Duplex);
const _Transform = _proxyClass(Transform);
const _PassThrough = _proxyClass(PassThrough);

module.exports = Stream;
module.exports.Stream = Stream;
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

let _defaultHWM = 65536;
let _defaultObjectHWM = 16;
module.exports.getDefaultHighWaterMark = function(objectMode) { return objectMode ? _defaultObjectHWM : _defaultHWM; };
module.exports.setDefaultHighWaterMark = function(objectMode, value) { if (objectMode) _defaultObjectHWM = value; else _defaultHWM = value; };
