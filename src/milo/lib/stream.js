// stream module — Readable, Writable, Duplex, Transform, PassThrough
'use strict';

const EventEmitter = require('events');

class Stream extends EventEmitter {
  pipe(dest, opts) {
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
  }
}

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
    if (chunk === null) { state.ended = true; return false; }
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);
    state.buffer.push(chunk);
    state.length += chunk.length || 1;
    return state.length < state.highWaterMark;
  }

  setEncoding(enc) { this._readableState.encoding = enc; return this; }
  resume() {
    const state = this._readableState;
    if (!state.flowing) {
      state.flowing = true;
      // Flush buffered chunks first
      while (state.buffer.length > 0) {
        const chunk = state.buffer.shift();
        state.length -= chunk.length || 1;
        this.emit('data', chunk);
      }
      // Then pull new data
      if (!state.ended) this._read(state.highWaterMark);
      // Flush anything _read pushed
      while (state.buffer.length > 0) {
        const chunk = state.buffer.shift();
        state.length -= chunk.length || 1;
        this.emit('data', chunk);
      }
      if (state.ended) this.emit('end');
    }
    return this;
  }
  pause() { this._readableState.flowing = false; return this; }
  isPaused() { return this._readableState.flowing === false; }
  unshift(chunk) { this._readableState.buffer.unshift(chunk); }
  destroy(err) { if (err) this.emit('error', err); this.emit('close'); return this; }

  [Symbol.asyncIterator]() {
    const self = this;
    return {
      next() {
        return new Promise((resolve) => {
          const chunk = self.read();
          if (chunk !== null) return resolve({ value: chunk, done: false });
          if (self._readableState.ended) return resolve({ done: true });
          self.once('readable', () => {
            const c = self.read();
            resolve(c !== null ? { value: c, done: false } : { done: true });
          });
          self.once('end', () => resolve({ done: true }));
        });
      }
    };
  }
}

Readable.from = function(iterable, opts) {
  const r = new Readable(opts);
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
    if (this._final) this._final(() => { this._writableState.finished = true; this.emit('finish'); if (cb) cb(); });
    else { this._writableState.finished = true; this.emit('finish'); if (cb) cb(); }
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
    Writable.call(this, opts);
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
    if (this._flush) this._flush((err, data) => {
      if (data != null) this.push(data);
      this.push(null);
      this._writableState.ended = true;
      this._writableState.finished = true;
      this.emit('finish');
      if (cb) cb(err);
    });
    else { this.push(null); this._writableState.ended = true; this._writableState.finished = true; this.emit('finish'); if (cb) cb(); }
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
module.exports.promises = promises;
