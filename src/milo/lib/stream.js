// stream module — Readable, Writable, Duplex, Transform, PassThrough
'use strict';

const EventEmitter = require('events');

// Function-based so old-style util.inherits + .call() works
function Stream() { EventEmitter.call(this); }
Object.setPrototypeOf(Stream.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Stream, EventEmitter);
Stream.prototype.pipe = function pipe(dest, opts) {
  this.on('data', (chunk) => {
    if (dest.writable !== false) {
      const canContinue = dest.write(chunk);
      if (canContinue === false && this.pause) this.pause();
    }
  });
  this.on('end', () => { if (!opts || opts.end !== false) dest.end(); });
  dest.on('drain', () => { if (this.resume) this.resume(); });
  dest.emit('pipe', this);
  if (this.resume) this.resume();
  return dest;
};

class Readable extends Stream {
  constructor(opts) {
    super();
    this.readable = true;
    this._readableState = {
      flowing: null, ended: false, buffer: [], length: 0,
      highWaterMark: (opts && opts.highWaterMark) || 16384,
      objectMode: !!(opts && opts.objectMode),
      encoding: null,
    };
    if (opts && opts.read) this._read = opts.read;
  }

  _read(_size) {}

  read(size) {
    const state = this._readableState;
    if (state.buffer.length === 0) {
      if (state.ended) return null;
      this._read(state.highWaterMark);
      if (state.buffer.length === 0) return state.ended ? null : null;
    }
    if (state.objectMode) return state.buffer.shift();
    if (!size || size >= state.length) {
      const buf = state.objectMode ? state.buffer.shift() : (state.buffer.length === 1 ? state.buffer.shift() : Buffer.concat(state.buffer));
      state.buffer = [];
      state.length = 0;
      return buf;
    }
    return state.buffer.shift();
  }

  push(chunk, encoding) {
    const state = this._readableState;
    this._didPush = true;
    if (chunk === null) {
      state.ended = true;
      if (state.flowing) process.nextTick(() => { if (!state.endEmitted) { state.endEmitted = true; this.emit('end'); } });
      return false;
    }
    if (!state.objectMode && typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);
    if (state.flowing) {
      this.emit('data', chunk);
    } else {
      state.buffer.push(chunk);
      state.length += chunk.length || 1;
      if (!state._readableEmitScheduled && this.listenerCount('readable') > 0) {
        state._readableEmitScheduled = true;
        process.nextTick(() => { state._readableEmitScheduled = false; this.emit('readable'); });
      }
    }
    return state.length < state.highWaterMark;
  }

  on(ev, fn) {
    super.on(ev, fn);
    if (ev === 'data') {
      if (this._readableState.flowing !== false) this.resume();
    } else if (ev === 'readable') {
      this._readableState.flowing = false;
    }
    return this;
  }

  addListener(ev, fn) { return this.on(ev, fn); }

  setEncoding(enc) { this._readableState.encoding = enc; return this; }
  resume() {
    const state = this._readableState;
    if (!state.flowing) {
      state.flowing = true;
      // Defer read to next tick so all listeners can be attached first
      process.nextTick(() => this._flow());
    }
    return this;
  }

  _flow() {
    const state = this._readableState;
    if (!state.flowing) return;
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
    if (state.ended && state.buffer.length === 0 && !state.endEmitted) { state.endEmitted = true; this.emit('end'); }
  }
  pause() { this._readableState.flowing = false; return this; }
  isPaused() { return this._readableState.flowing === false; }
  unshift(chunk) { this._readableState.buffer.unshift(chunk); }
  destroy(err) { if (err) this.emit('error', err); this.emit('close'); return this; }

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
    for await (const chunk of iterable) r.push(chunk);
    r.push(null);
  })();
  return r;
};

class Writable extends Stream {
  constructor(opts) {
    super();
    this.writable = true;
    this._writableState = { ended: false, finished: false, corked: 0, buffered: [] };
    if (opts && opts.write) this._write = opts.write;
    if (opts && opts.final) this._final = opts.final;
  }

  _write(chunk, encoding, cb) { cb(); }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = 'utf8'; }
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);
    this._write(chunk, encoding || 'utf8', (err) => {
      if (err) this.emit('error', err);
      else this.emit('drain');
      if (cb) cb(err);
    });
    return true;
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    if (chunk != null) this.write(chunk, encoding);
    this._writableState.ended = true;
    const done = () => { this._writableState.finished = true; process.nextTick(() => { this.emit('finish'); if (cb) cb(); }); };
    if (this._final) this._final(done);
    else done();
    return this;
  }

  cork() { this._writableState.corked++; }
  uncork() { this._writableState.corked = Math.max(0, this._writableState.corked - 1); }
  destroy(err) { if (err) this.emit('error', err); this.emit('close'); return this; }
  setDefaultEncoding(enc) { this._defaultEncoding = enc; return this; }
}

class Duplex extends Readable {
  constructor(opts) {
    super(opts);
    this.writable = true;
    this._writableState = { ended: false, finished: false, corked: 0, buffered: [] };
    if (opts && opts.write) this._write = opts.write;
    if (opts && opts.final) this._final = opts.final;
  }
}
Object.getOwnPropertyNames(Writable.prototype).forEach(method => {
  if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
});

class Transform extends Duplex {
  constructor(opts) {
    super(opts);
    if (opts && opts.transform) this._transform = opts.transform;
    if (opts && opts.flush) this._flush = opts.flush;
  }

  _transform(chunk, encoding, cb) { cb(null, chunk); }

  _write(chunk, encoding, cb) {
    this._transform(chunk, encoding, (err, data) => {
      if (data != null) this.push(data);
      cb(err);
    });
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    if (chunk != null) this.write(chunk, encoding);
    const done = (err) => { this._writableState.ended = true; this._writableState.finished = true; process.nextTick(() => { this.emit('finish'); if (cb) cb(err); }); };
    if (this._flush) this._flush((err, data) => {
      if (data != null) this.push(data);
      this.push(null);
      done(err);
    });
    else { this.push(null); done(); }
    return this;
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
  const onFinish = () => { cleanup(); cb(null); };
  const onEnd = () => { cleanup(); cb(null); };
  const onError = (err) => { cleanup(); cb(err); };
  stream.on('finish', onFinish);
  stream.on('end', onEnd);
  stream.on('error', onError);
  function cleanup() { stream.removeListener('finish', onFinish); stream.removeListener('end', onEnd); stream.removeListener('error', onError); }
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

module.exports = Stream;
module.exports.Stream = Stream;
module.exports.Readable = Readable;
module.exports.Writable = Writable;
module.exports.Duplex = Duplex;
module.exports.Transform = Transform;
module.exports.PassThrough = PassThrough;
module.exports.pipeline = pipeline;
module.exports.finished = finished;
module.exports.compose = compose;
module.exports.addAbortSignal = function addAbortSignal(signal, stream) {
  if (signal.aborted) { stream.destroy(new DOMException('The operation was aborted', 'AbortError')); }
  else { signal.addEventListener('abort', () => stream.destroy(new DOMException('The operation was aborted', 'AbortError')), { once: true }); }
  return stream;
};
module.exports.promises = promises;
